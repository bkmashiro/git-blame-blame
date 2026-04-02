import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBusFactor, calculateFileBusFactor } from '../src/bus-factor.ts';
import type { FileContribution } from '../src/blame.ts';

const fileRows: FileContribution[] = [
  {
    filePath: 'src/core/engine.ts',
    authorEmail: 'alice@example.com',
    authorName: 'alice',
    lines: 80,
    lastModified: '2024-06-10',
    changeType: 'modified',
  },
  {
    filePath: 'src/core/engine.ts',
    authorEmail: 'bob@example.com',
    authorName: 'bob',
    lines: 20,
    lastModified: '2024-06-09',
    changeType: 'modified',
  },
  {
    filePath: 'src/api/routes.ts',
    authorEmail: 'carol@example.com',
    authorName: 'carol',
    lines: 60,
    lastModified: '2024-06-11',
    changeType: 'modified',
  },
  {
    filePath: 'src/api/routes.ts',
    authorEmail: 'alice@example.com',
    authorName: 'alice',
    lines: 40,
    lastModified: '2024-06-10',
    changeType: 'modified',
  },
  {
    filePath: 'src/utils/helpers.ts',
    authorEmail: 'alice@example.com',
    authorName: 'alice',
    lines: 40,
    lastModified: '2024-06-08',
    changeType: 'modified',
  },
  {
    filePath: 'src/utils/helpers.ts',
    authorEmail: 'bob@example.com',
    authorName: 'bob',
    lines: 35,
    lastModified: '2024-06-07',
    changeType: 'modified',
  },
  {
    filePath: 'src/utils/helpers.ts',
    authorEmail: 'carol@example.com',
    authorName: 'carol',
    lines: 25,
    lastModified: '2024-06-06',
    changeType: 'modified',
  },
];

test('calculateFileBusFactor counts only contributors above 20 percent', () => {
  const report = calculateFileBusFactor(
    'src/core/engine.ts',
    fileRows.filter((row) => row.filePath === 'src/core/engine.ts')
  );

  assert.equal(report.totalLines, 100);
  assert.equal(report.busFactor, 1);
  assert.deepEqual(
    report.maintainers.map((author) => ({ name: author.name, percent: author.percent })),
    [{ name: 'alice', percent: 80 }]
  );
});

test('analyzeBusFactor splits files by severity and computes repo recommendation', () => {
  const report = analyzeBusFactor(fileRows);

  assert.equal(report.overallBusFactor, 1);
  assert.deepEqual(report.criticalFiles.map((file) => file.filePath), ['src/core/engine.ts']);
  assert.deepEqual(report.atRiskFiles.map((file) => file.filePath), ['src/api/routes.ts']);
  assert.deepEqual(report.healthyFiles.map((file) => file.filePath), ['src/utils/helpers.ts']);
  assert.equal(report.recommendation, 'alice is the single point of failure for 1 file');
});
