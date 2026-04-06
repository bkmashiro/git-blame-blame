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

test('calculateFileBusFactor with a single author yields busFactor 1 (critical)', () => {
  const contributions: FileContribution[] = [
    {
      filePath: 'src/solo.ts',
      authorEmail: 'solo@example.com',
      authorName: 'solo',
      lines: 100,
      lastModified: '2024-06-01',
      changeType: 'modified',
    },
  ];

  const report = calculateFileBusFactor('src/solo.ts', contributions);

  assert.equal(report.busFactor, 1);
  assert.equal(report.maintainers.length, 1);
  assert.equal(report.maintainers[0].email, 'solo@example.com');
  assert.equal(report.maintainers[0].percent, 100);
});

test('calculateFileBusFactor with no author above threshold yields busFactor 0 and empty maintainers', () => {
  // Five authors each at exactly 20% — none exceeds the threshold
  const makeContribution = (email: string, name: string): FileContribution => ({
    filePath: 'src/evenly-split.ts',
    authorEmail: email,
    authorName: name,
    lines: 20,
    lastModified: '2024-06-01',
    changeType: 'modified',
  });

  const contributions = [
    makeContribution('a@example.com', 'alpha'),
    makeContribution('b@example.com', 'bravo'),
    makeContribution('c@example.com', 'charlie'),
    makeContribution('d@example.com', 'delta'),
    makeContribution('e@example.com', 'echo'),
  ];

  const report = calculateFileBusFactor('src/evenly-split.ts', contributions);

  assert.equal(report.busFactor, 0);
  assert.equal(report.maintainers.length, 0);
  // Accessing maintainers[0] must be safe (undefined, not a throw)
  assert.equal(report.maintainers[0], undefined);
});

test('analyzeBusFactor with an empty contributions array returns a zero report', () => {
  const report = analyzeBusFactor([]);

  assert.equal(report.overallBusFactor, 0);
  assert.equal(report.files.length, 0);
  assert.equal(report.criticalFiles.length, 0);
  assert.equal(report.atRiskFiles.length, 0);
  assert.equal(report.healthyFiles.length, 0);
  assert.equal(report.recommendation, null);
});

test('analyzeBusFactor classifies severity boundaries correctly', () => {
  // critical: busFactor === 1 (src/solo.ts — one dominant author)
  // at-risk:  busFactor === 2 (src/dual.ts — two dominant authors each >20%)
  // healthy:  busFactor >= 3 (src/trio.ts — three dominant authors each >20%)
  const makeContribution = (
    filePath: string,
    authorEmail: string,
    authorName: string,
    lines: number
  ): FileContribution => ({
    filePath,
    authorEmail,
    authorName,
    lines,
    lastModified: '2024-06-01',
    changeType: 'modified',
  });

  const contributions: FileContribution[] = [
    // solo.ts: alice owns 100% → busFactor 1 → critical
    makeContribution('src/solo.ts', 'alice@example.com', 'alice', 100),

    // dual.ts: two authors each at ~50% → busFactor 2 → at-risk
    makeContribution('src/dual.ts', 'alice@example.com', 'alice', 50),
    makeContribution('src/dual.ts', 'bob@example.com', 'bob', 50),

    // trio.ts: three authors each at ~33% → busFactor 3 → healthy
    makeContribution('src/trio.ts', 'alice@example.com', 'alice', 34),
    makeContribution('src/trio.ts', 'bob@example.com', 'bob', 33),
    makeContribution('src/trio.ts', 'carol@example.com', 'carol', 33),
  ];

  const report = analyzeBusFactor(contributions);

  assert.deepEqual(report.criticalFiles.map((file) => file.filePath), ['src/solo.ts']);
  assert.deepEqual(report.atRiskFiles.map((file) => file.filePath), ['src/dual.ts']);
  assert.deepEqual(report.healthyFiles.map((file) => file.filePath), ['src/trio.ts']);
});
