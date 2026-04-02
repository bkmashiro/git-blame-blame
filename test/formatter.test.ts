import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJson, formatOutput, type OutputData } from '../src/formatter.ts';

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
