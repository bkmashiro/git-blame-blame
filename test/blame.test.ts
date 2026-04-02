import test from 'node:test';
import assert from 'node:assert/strict';
import { blameFile, extractLineNumberFromBlameOutput, parseGitLogOutput } from '../src/blame.ts';

test('parseGitLogOutput extracts commit hash, author email, and subject', () => {
  const output = [
    'diff --git a/src/index.ts b/src/index.ts',
    'index 1234567..89abcde 100644',
    'f'.repeat(40) + ' dev@example.com Dev User 2024-06-10 Fix parser edge case',
  ].join('\n');

  const result = parseGitLogOutput(output);

  assert.equal(result.sha, 'f'.repeat(40));
  assert.equal(result.authorEmail, 'dev@example.com');
  assert.equal(result.authorName, 'Dev User');
  assert.equal(result.subject, 'Fix parser edge case');
});

test('parseGitLogOutput handles output with multiple hunks', () => {
  const output = [
    'commit hunk header',
    '@@ -10,2 +10,2 @@',
    '-old line',
    '+new line',
    'a'.repeat(40) + ' reviewer@example.com Reviewer Name 2024-07-11 Add multi hunk support',
    '@@ -20,2 +20,2 @@',
    '-old line 2',
    '+new line 2',
  ].join('\n');

  const result = parseGitLogOutput(output);

  assert.equal(result.sha, 'a'.repeat(40));
  assert.equal(result.authorEmail, 'reviewer@example.com');
  assert.equal(result.subject, 'Add multi hunk support');
});

test('parseGitLogOutput throws when no commit line is present', () => {
  assert.throws(() => parseGitLogOutput('fatal: no such path src/missing.ts'), /Could not parse git log output/);
});

test('parseGitLogOutput throws when the commit line has no parseable date', () => {
  const output = 'f'.repeat(40) + ' dev@example.com Dev User not-a-date Fix parser edge case';

  assert.throws(() => parseGitLogOutput(output), /Could not parse date from git log output/);
});

test('blameFile throws when the target file does not exist', () => {
  assert.throws(() => blameFile('/definitely/missing/file.ts', 1), /ENOENT/);
});

test('extractLineNumberFromBlameOutput returns the blamed line number', () => {
  const output = '3b18e512 (Dev User 2024-06-10  27) const answer = 42;';

  assert.equal(extractLineNumberFromBlameOutput(output), 27);
});

test('extractLineNumberFromBlameOutput throws when the blame output is malformed', () => {
  assert.throws(
    () => extractLineNumberFromBlameOutput('malformed blame output'),
    /Could not parse line number from blame output/
  );
});
