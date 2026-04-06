import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBusFactor, calculateFileBusFactor, groupContributionsByFile } from '../src/bus-factor.ts';
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

test('groupContributionsByFile returns empty map for empty input', () => {
  const result = groupContributionsByFile([]);

  assert.equal(result.size, 0);
});

test('calculateFileBusFactor with single contributor owning 100% returns busFactor 1', () => {
  const sole: FileContribution = {
    filePath: 'src/solo.ts',
    authorEmail: 'solo@example.com',
    authorName: 'solo',
    lines: 50,
    lastModified: '2024-06-01',
    changeType: 'modified',
  };

  const report = calculateFileBusFactor('src/solo.ts', [sole]);

  assert.equal(report.totalLines, 50);
  assert.equal(report.busFactor, 1);
  assert.deepEqual(
    report.maintainers.map((author) => ({ name: author.name, percent: author.percent })),
    [{ name: 'solo', percent: 100 }]
  );
});

test('analyzeBusFactor with no files crossing threshold returns empty atRisk list and correct totals', () => {
  // All three contributors own 33% each — none exceed the default 20% threshold? Actually
  // 33 > 20, so use threshold=50 to ensure no one crosses it.
  const evenRows: FileContribution[] = [
    {
      filePath: 'src/even.ts',
      authorEmail: 'a@example.com',
      authorName: 'a',
      lines: 34,
      lastModified: '2024-06-01',
      changeType: 'modified',
    },
    {
      filePath: 'src/even.ts',
      authorEmail: 'b@example.com',
      authorName: 'b',
      lines: 33,
      lastModified: '2024-06-01',
      changeType: 'modified',
    },
    {
      filePath: 'src/even.ts',
      authorEmail: 'c@example.com',
      authorName: 'c',
      lines: 33,
      lastModified: '2024-06-01',
      changeType: 'modified',
    },
  ];

  const report = analyzeBusFactor(evenRows, 50);

  assert.equal(report.atRiskFiles.length, 0);
  assert.equal(report.criticalFiles.length, 0);
  assert.equal(report.healthyFiles.length, 0);
  assert.equal(report.files.length, 1);
  assert.equal(report.overallBusFactor, 0);
  assert.equal(report.recommendation, null);
});

test('analyzeBusFactor with thresholdPercent=0 treats every contributor as a maintainer', () => {
  const rows = fileRows.filter((row) => row.filePath === 'src/core/engine.ts');
  const report = analyzeBusFactor(rows, 0);

  // Both alice (80%) and bob (20%) exceed threshold of 0, so busFactor=2 → atRisk
  assert.equal(report.atRiskFiles.length, 1);
  assert.equal(report.atRiskFiles[0].busFactor, 2);
});

test('analyzeBusFactor with thresholdPercent=100 treats no contributor as a maintainer', () => {
  const rows = fileRows.filter((row) => row.filePath === 'src/core/engine.ts');
  const report = analyzeBusFactor(rows, 100);

  // No contributor can exceed 100%, so busFactor=0 → not critical, atRisk, or healthy
  assert.equal(report.criticalFiles.length, 0);
  assert.equal(report.atRiskFiles.length, 0);
  assert.equal(report.healthyFiles.length, 0);
  assert.equal(report.overallBusFactor, 0);
});

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
