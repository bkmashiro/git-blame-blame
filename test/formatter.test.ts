import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBusFactorReport,
  formatExportCsv,
  formatExportJson,
  formatJson,
  formatOutput,
  formatSinceReport,
  formatTeamReport,
  type OutputData,
} from '../src/formatter.ts';
import { analyzeBusFactor } from '../src/bus-factor.ts';

const baseData: OutputData = {
  file: 'src/index.ts',
  line: 12,
  blame: {
    sha: '1234567890abcdef1234567890abcdef12345678',
    authorEmail: 'dev@example.com',
    authorName: 'Dev User',
    date: '2024-06-10',
    subject: 'Fix parser edge case',
    lineContent: 'const answer = 42;',
  },
  pr: {
    number: 42,
    title: 'Fix flaky parser behavior',
    html_url: 'https://github.com/acme/git-blame-blame/pull/42',
  },
  approvals: [
    { login: 'alex', email: 'alex@example.com' },
    { login: 'jamie' },
  ],
};

function captureLogs(run: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };

  try {
    run();
  } finally {
    console.log = original;
  }

  return lines.join('\n');
}

test('formatJson includes commit details, PR number, title, and approvers array', () => {
  const output = captureLogs(() => formatJson(baseData));
  const parsed = JSON.parse(output);

  assert.equal(parsed.commit.sha, baseData.blame.sha);
  assert.equal(parsed.commit.authorEmail, baseData.blame.authorEmail);
  assert.equal(parsed.pr.number, 42);
  assert.equal(parsed.pr.title, 'Fix flaky parser behavior');
  assert.deepEqual(parsed.approvals, [
    { login: 'alex', email: 'alex@example.com' },
    { login: 'jamie', email: null },
  ]);
});

test('formatOutput text contains reviewer names', () => {
  const output = captureLogs(() => formatOutput(baseData));

  assert.match(output, /alex/);
  assert.match(output, /jamie/);
});

test('formatOutput text contains the PR number', () => {
  const output = captureLogs(() => formatOutput(baseData));

  assert.match(output, /PR #42/);
});

test('formatOutput handles no approvers gracefully', () => {
  const output = captureLogs(() =>
    formatOutput({
      ...baseData,
      approvals: [],
    })
  );

  assert.match(output, /No approvals found/);
});

test('formatOutput handles results with no associated PR', () => {
  const output = captureLogs(() =>
    formatOutput({
      ...baseData,
      pr: null,
      approvals: [],
    })
  );

  assert.match(output, /\(no associated PR found\)/);
});

test('formatJson emits a null PR when none is associated with the commit', () => {
  const output = captureLogs(() =>
    formatJson({
      ...baseData,
      pr: null,
      approvals: [],
    })
  );
  const parsed = JSON.parse(output);

  assert.equal(parsed.pr, null);
});

test('formatSinceReport shows one row per file using the top matching contributor', () => {
  const output = captureLogs(() =>
    formatSinceReport(
      [
        {
          filePath: 'src/api.ts',
          authorEmail: 'alice@example.com',
          authorName: 'Alice',
          lines: 5,
          changeType: 'added',
        },
        {
          filePath: 'src/api.ts',
          authorEmail: 'bob@example.com',
          authorName: 'Bob',
          lines: 2,
          changeType: 'added',
        },
      ],
      '2024-01-01'
    )
  );

  assert.match(output, /Showing blame for changes since 2024-01-01/);
  assert.match(output, /src\/api\.ts/);
  assert.match(output, /Alice/);
  assert.doesNotMatch(output, /Bob/);
});

test('formatTeamReport renders the contribution table', () => {
  const output = captureLogs(() =>
    formatTeamReport([
      {
        label: 'alice@example.com',
        lines: 12,
        files: 3,
        percent: 60,
        bar: '############',
      },
      {
        label: '[external]',
        lines: 8,
        files: 2,
        percent: 40,
        bar: '########',
      },
    ])
  );

  assert.match(output, /Team contribution report:/);
  assert.match(output, /alice@example.com/);
  assert.match(output, /\[external\]/);
});

test('formatBusFactorReport renders grouped severity sections and recommendation', () => {
  const output = captureLogs(() =>
    formatBusFactorReport(
      analyzeBusFactor([
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
          lastModified: '2024-06-10',
          changeType: 'modified',
        },
        {
          filePath: 'src/api/routes.ts',
          authorEmail: 'alice@example.com',
          authorName: 'alice',
          lines: 40,
          lastModified: '2024-06-09',
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
      ])
    )
  );

  assert.match(output, /Bus Factor Analysis:/);
  assert.match(output, /src\/core\/engine\.ts/);
  assert.match(output, /only alice maintains this \(100 lines\)/);
  assert.match(output, /carol 60% \+ alice 40%/);
  assert.match(output, /alice 40%, bob 35%, carol 25%/);
  assert.match(output, /Overall repo bus factor: 1/);
  assert.match(output, /Recommendation: alice is the single point of failure for 1 file/);
});

test('formatExportJson emits file-level authors and bus factor', () => {
  const output = captureLogs(() =>
    formatExportJson([
      {
        filePath: 'src/api.ts',
        authorEmail: 'alice@example.com',
        authorName: 'Alice',
        lines: 6,
        lastModified: '2024-06-10',
        changeType: 'modified',
      },
      {
        filePath: 'src/api.ts',
        authorEmail: 'bob@example.com',
        authorName: 'Bob',
        lines: 4,
        lastModified: '2024-06-11',
        changeType: 'modified',
      },
    ])
  );
  const parsed = JSON.parse(output);

  assert.deepEqual(parsed, [
    {
      file: 'src/api.ts',
      authors: [
        {
          email: 'alice@example.com',
          name: 'Alice',
          lines: 6,
          percent: 60,
          lastModified: '2024-06-10',
        },
        {
          email: 'bob@example.com',
          name: 'Bob',
          lines: 4,
          percent: 40,
          lastModified: '2024-06-11',
        },
      ],
      busFactor: 2,
    },
  ]);
});

test('formatExportCsv emits one row per file author contribution', () => {
  const output = captureLogs(() =>
    formatExportCsv([
      {
        filePath: 'src/api.ts',
        authorEmail: 'alice@example.com',
        authorName: 'Alice',
        lines: 6,
        lastModified: '2024-06-10',
        changeType: 'modified',
      },
      {
        filePath: 'src/api.ts',
        authorEmail: 'bob@example.com',
        authorName: 'Bob',
        lines: 4,
        lastModified: '2024-06-11',
        changeType: 'modified',
      },
    ])
  );

  assert.equal(
    output,
    [
      'file,author,lines,percent,lastModified',
      'src/api.ts,alice@example.com,6,60,2024-06-10',
      'src/api.ts,bob@example.com,4,40,2024-06-11',
    ].join('\n')
  );
});
