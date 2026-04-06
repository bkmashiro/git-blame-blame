import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blameFile,
  collectFileContributions,
  extractLineNumberFromBlameOutput,
  parseBlamePorcelainOutput,
  parseGitLogOutput,
  parseRecentAuthorsOutput,
  shellQuote,
} from '../src/blame.ts';

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

test('parseGitLogOutput parses a 7-character abbreviated SHA', () => {
  const output = 'abc1234 dev@example.com Dev User 2024-06-10 Fix parser edge case';

  const result = parseGitLogOutput(output);

  assert.equal(result.sha, 'abc1234');
  assert.equal(result.authorEmail, 'dev@example.com');
  assert.equal(result.authorName, 'Dev User');
  assert.equal(result.date, '2024-06-10');
  assert.equal(result.subject, 'Fix parser edge case');
});

test('parseGitLogOutput parses a 12-character abbreviated SHA', () => {
  const output = 'abc123456789 dev@example.com Dev User 2024-06-10 Fix something';

  const result = parseGitLogOutput(output);

  assert.equal(result.sha, 'abc123456789');
});

test('parseGitLogOutput throws when SHA is too short (6 chars)', () => {
  const output = 'abc123 dev@example.com Dev User 2024-06-10 Fix parser edge case';

  assert.throws(() => parseGitLogOutput(output), /Could not parse git log output/);
});

test('parseGitLogOutput throws when no commit line is present', () => {
  assert.throws(() => parseGitLogOutput('fatal: no such path src/missing.ts'), /Could not parse git log output/);
});

test('parseGitLogOutput throws when the commit line has no parseable date', () => {
  const output = 'f'.repeat(40) + ' dev@example.com Dev User not-a-date Fix parser edge case';

  assert.throws(() => parseGitLogOutput(output), /Could not parse date from git log output/);
});

test('shellQuote wraps a simple string in single quotes', () => {
  assert.equal(shellQuote('hello'), "'hello'");
});

test('shellQuote escapes spaces so the path is treated as one argument', () => {
  assert.equal(shellQuote('my file.ts'), "'my file.ts'");
});

test('shellQuote escapes embedded single quotes', () => {
  assert.equal(shellQuote("it's here.ts"), "'it'\\''s here.ts'");
});

test('shellQuote escapes shell metacharacters (dollar, backtick, semicolon)', () => {
  assert.equal(shellQuote('path/$var;`cmd`.ts'), "'path/$var;`cmd`.ts'");
});

test('shellQuote handles paths with multiple spaces and special chars combined', () => {
  assert.equal(shellQuote("my dir/it's a file.ts"), "'my dir/it'\\''s a file.ts'");
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

test('parseRecentAuthorsOutput extracts email and author name pairs', () => {
  const result = parseRecentAuthorsOutput('alice@example.com\tAlice\nbob@example.com\tBob');

  assert.deepEqual(result, [
    { email: 'alice@example.com', name: 'Alice' },
    { email: 'bob@example.com', name: 'Bob' },
  ]);
});

test('parseBlamePorcelainOutput counts blamed lines per author', () => {
  const output = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 1717977600',
    '\tconst one = 1;',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
    'author Bob',
    'author-mail <bob@example.com>',
    'author-time 1718064000',
    '\tconst two = 2;',
    'cccccccccccccccccccccccccccccccccccccccc 3 3 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 1718150400',
    '\tconst three = 3;',
  ].join('\n');

  assert.deepEqual(parseBlamePorcelainOutput(output), [
    { authorEmail: 'alice@example.com', authorName: 'Alice', lines: 2, lastModified: '2024-06-12' },
    { authorEmail: 'bob@example.com', authorName: 'Bob', lines: 1, lastModified: '2024-06-11' },
  ]);
});

test('collectFileContributions quotes file paths with spaces in all git commands', () => {
  const spacedFile = 'src/my component.ts';
  const commands: string[] = [];
  const outputs = new Map<string, string>([
    ["git ls-files -- 'src/'", spacedFile],
    [
      `git blame --line-porcelain --since='2024-01-01' -- 'src/my component.ts'`,
      [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
        'author Alice',
        'author-mail <alice@example.com>',
        'author-time 1717977600',
        '\tconst x = 1;',
      ].join('\n'),
    ],
    [`git log --since='2024-01-01' --diff-filter=AM --format='%ae\t%an' -- 'src/my component.ts'`, 'alice@example.com\tAlice'],
    [`git log --since='2024-01-01' --diff-filter=A --format=%H -1 -- 'src/my component.ts'`, ''],
  ]);

  collectFileContributions('src/', {
    since: '2024-01-01',
    exec: (command) => {
      commands.push(command);
      const output = outputs.get(command);
      if (output === undefined) {
        throw new Error(`Unexpected command: ${command}`);
      }
      return output;
    },
  });

  // Every command referencing the spaced filename must quote it
  const fileCommands = commands.filter((cmd) => cmd.includes('my component'));
  assert.ok(fileCommands.length > 0, 'expected at least one command referencing the file');
  for (const cmd of fileCommands) {
    assert.ok(cmd.includes("'src/my component.ts'"), `file path not quoted in: ${cmd}`);
  }
});

test("collectFileContributions quotes file paths containing single quotes", () => {
  const trickyFile = "src/it's complicated.ts";
  const outputs = new Map<string, string>([
    ["git ls-files -- 'src/'", trickyFile],
    [
      `git blame --line-porcelain --since='2024-01-01' -- 'src/it'\\''s complicated.ts'`,
      [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
        'author Alice',
        'author-mail <alice@example.com>',
        'author-time 1717977600',
        '\tconst x = 1;',
      ].join('\n'),
    ],
    [`git log --since='2024-01-01' --diff-filter=AM --format='%ae\t%an' -- 'src/it'\\''s complicated.ts'`, 'alice@example.com\tAlice'],
    [`git log --since='2024-01-01' --diff-filter=A --format=%H -1 -- 'src/it'\\''s complicated.ts'`, ''],
  ]);

  // Should not throw — all commands must be constructed with proper quoting
  assert.doesNotThrow(() =>
    collectFileContributions('src/', {
      since: '2024-01-01',
      exec: (command) => {
        const output = outputs.get(command);
        if (output === undefined) {
          throw new Error(`Unexpected command: ${command}`);
        }
        return output;
      },
    })
  );
test('parseGitLogOutput handles author name containing a date-like substring (known mis-fire)', () => {
  // Author name "Dev 2099-12-31 User" contains a date-like token. The heuristic
  // treats the *first* date-like token after index 1 as the boundary, so the
  // real date ("2024-06-10") and everything after it become the subject, and the
  // author name is incorrectly truncated to "Dev".
  const output = 'f'.repeat(40) + ' dev@example.com Dev 2099-12-31 User 2024-06-10 Fix something';

  const result = parseGitLogOutput(output);

  // The heuristic misfires: "2099-12-31" is picked as the date, not "2024-06-10".
  assert.equal(result.date, '2099-12-31');
  assert.equal(result.authorName, 'Dev');
  assert.equal(result.subject, 'User 2024-06-10 Fix something');
});

test('parseGitLogOutput extracts single-word author name', () => {
  const output = 'a'.repeat(40) + ' bot@ci.example.com Bot 2024-01-15 chore: bump deps';

  const result = parseGitLogOutput(output);

  assert.equal(result.authorName, 'Bot');
  assert.equal(result.date, '2024-01-15');
  assert.equal(result.subject, 'chore: bump deps');
});

test('parseBlamePorcelainOutput returns empty array for empty input', () => {
  assert.deepEqual(parseBlamePorcelainOutput(''), []);
});

test('parseBlamePorcelainOutput throws when tab line appears before author-mail', () => {
  const output = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
    'author Alice',
    // author-mail deliberately omitted
    'author-time 1717977600',
    '\tconst one = 1;',
  ].join('\n');

  assert.throws(() => parseBlamePorcelainOutput(output), /Could not parse author email/);
});

test('parseBlamePorcelainOutput uses the most recent author-time as lastModified', () => {
  const output = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 1717977600', // 2024-06-10
    '\tline one',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 1718409600', // 2024-06-15 — later
    '\tline two',
  ].join('\n');

  const result = parseBlamePorcelainOutput(output);

  assert.equal(result.length, 1);
  assert.equal(result[0].lastModified, '2024-06-15');
  assert.equal(result[0].lines, 2);
});

test('parseBlamePorcelainOutput sorts by line count descending', () => {
  const output = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
    'author Bob',
    'author-mail <bob@example.com>',
    'author-time 1717977600',
    '\tline one',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 1717977600',
    '\tline two',
    'cccccccccccccccccccccccccccccccccccccccc 3 3 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 1717977600',
    '\tline three',
  ].join('\n');

  const result = parseBlamePorcelainOutput(output);

  assert.equal(result[0].authorEmail, 'alice@example.com');
  assert.equal(result[0].lines, 2);
  assert.equal(result[1].authorEmail, 'bob@example.com');
  assert.equal(result[1].lines, 1);
});

test('parseBlamePorcelainOutput throws when author-time header is missing before a content line', () => {
  const output = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
    'author Alice',
    'author-mail <alice@example.com>',
    '\tconst one = 1;',
  ].join('\n');

  assert.throws(() => parseBlamePorcelainOutput(output), /Could not parse author date from git blame output/);
});

test('collectFileContributions filters blame results to authors active since the requested date', () => {
  const outputs = new Map<string, string>([
    ["git ls-files -- 'src/'", 'src/api.ts\nsrc/auth.ts'],
    [
      "git blame --line-porcelain --since='2024-01-01' -- 'src/api.ts'",
      [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
        'author Alice',
        'author-mail <alice@example.com>',
        'author-time 1717977600',
        '\tconst one = 1;',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
        'author Carol',
        'author-mail <carol@example.com>',
        'author-time 1718064000',
        '\tconst two = 2;',
      ].join('\n'),
    ],
    ["git log --since='2024-01-01' --diff-filter=AM --format='%ae\t%an' -- 'src/api.ts'", 'alice@example.com\tAlice'],
    ["git log --since='2024-01-01' --diff-filter=A --format=%H -1 -- 'src/api.ts'", 'new-sha'],
    [
      "git blame --line-porcelain --since='2024-01-01' -- 'src/auth.ts'",
      [
        'dddddddddddddddddddddddddddddddddddddddd 1 1 1',
        'author Bob',
        'author-mail <bob@example.com>',
        'author-time 1718150400',
        '\tconst auth = true;',
      ].join('\n'),
    ],
    ["git log --since='2024-01-01' --diff-filter=AM --format='%ae\t%an' -- 'src/auth.ts'", 'bob@example.com\tBob'],
    ["git log --since='2024-01-01' --diff-filter=A --format=%H -1 -- 'src/auth.ts'", ''],
  ]);

  const result = collectFileContributions('src/', {
    since: '2024-01-01',
    exec: (command) => {
      const output = outputs.get(command);
      if (output === undefined) {
        throw new Error(`Unexpected command: ${command}`);
      }
      return output;
    },
  });

  assert.deepEqual(result, [
    {
      filePath: 'src/api.ts',
      authorEmail: 'alice@example.com',
      authorName: 'Alice',
      lines: 1,
      lastModified: '2024-06-10',
      changeType: 'added',
    },
    {
      filePath: 'src/auth.ts',
      authorEmail: 'bob@example.com',
      authorName: 'Bob',
      lines: 1,
      lastModified: '2024-06-12',
      changeType: 'modified',
    },
  ]);
});
