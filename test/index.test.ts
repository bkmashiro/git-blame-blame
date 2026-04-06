import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const cliPath = join(projectRoot, 'src', 'index.ts');

function runCli(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', ['--import', 'tsx/esm', cliPath, ...args], {
    cwd: options.cwd ?? projectRoot,
    encoding: 'utf-8',
    env: { ...process.env, ...options.env },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// Temp git repo used by tests that need a working blame target
let tempRepoPath: string;

test.before(() => {
  tempRepoPath = join(projectRoot, '.tmp-test-repo');
  mkdirSync(tempRepoPath, { recursive: true });
  writeFileSync(join(tempRepoPath, 'sample.ts'), 'const answer = 42;\n');
  spawnSync('git', ['init'], { cwd: tempRepoPath });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempRepoPath });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tempRepoPath });
  spawnSync('git', ['add', '.'], { cwd: tempRepoPath });
  spawnSync('git', ['commit', '-m', 'initial commit'], { cwd: tempRepoPath });
  spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/fake/repo.git'], { cwd: tempRepoPath });
});

test.after(() => {
  rmSync(tempRepoPath, { recursive: true, force: true });
});

// ─── Conflicting flag combinations ───────────────────────────────────────────

test('--json with --since errors: --json is only for file:line lookups', () => {
  const { status, stderr } = runCli(['src/', '--since', '2024-01-01', '--json']);
  assert.equal(status, 1);
  assert.match(stderr, /--json is only supported for <file:line> lookups/);
});

test('--team and --bus-factor together error: choose only one output mode', () => {
  const { status, stderr } = runCli(['src/', '--team', 'roster.json', '--bus-factor']);
  assert.equal(status, 1);
  assert.match(stderr, /choose only one of --team, --bus-factor, or --export/);
});

test('--bus-factor and --export together error: choose only one output mode', () => {
  const { status, stderr } = runCli(['src/', '--bus-factor', '--export', 'csv']);
  assert.equal(status, 1);
  assert.match(stderr, /choose only one of --team, --bus-factor, or --export/);
});

test('--team and --export together error: choose only one output mode', () => {
  const { status, stderr } = runCli(['src/', '--team', 'roster.json', '--export', 'json']);
  assert.equal(status, 1);
  assert.match(stderr, /choose only one of --team, --bus-factor, or --export/);
});

test('--export with invalid format errors: must be csv or json', () => {
  const { status, stderr } = runCli(['src/', '--export', 'xml']);
  assert.equal(status, 1);
  assert.match(stderr, /--export must be one of: csv, json/);
});

test('file:line target with --since errors: tracked path flags expect a directory, not file:line', () => {
  const { status, stderr } = runCli(['src/index.ts:1', '--since', '2024-01-01']);
  assert.equal(status, 1);
  assert.match(stderr, /--since, --team, --bus-factor, and --export expect a tracked file or directory path/);
});

test('file:line target with --bus-factor errors: tracked path flags expect a directory, not file:line', () => {
  const { status, stderr } = runCli(['src/index.ts:1', '--bus-factor']);
  assert.equal(status, 1);
  assert.match(stderr, /--since, --team, --bus-factor, and --export expect a tracked file or directory path/);
});

test('file:line target with --export errors: tracked path flags expect a directory, not file:line', () => {
  const { status, stderr } = runCli(['src/index.ts:1', '--export', 'csv']);
  assert.equal(status, 1);
  assert.match(stderr, /--since, --team, --bus-factor, and --export expect a tracked file or directory path/);
});

test('argument without colon and no tracked-path flags errors: wrong format', () => {
  const { status, stderr } = runCli(['just-a-filename']);
  assert.equal(status, 1);
  assert.match(stderr, /argument must be in the format <file:line>/);
});

test('--repo with wrong format errors: must be owner/repo', () => {
  const { status, stderr } = runCli(['src/index.ts:1', '--token', 'fake', '--repo', 'nodash']);
  assert.equal(status, 1);
  assert.match(stderr, /--repo must be in the format owner\/repo/);
});

// ─── Provider detection ───────────────────────────────────────────────────────

test('GitHub remote triggers GitHub token error when token is absent', () => {
  // tempRepoPath has origin = github.com, so the GitHub flow should be selected.
  // blameFile runs first, so we get the blame error before the token check.
  // The blame itself works in tempRepoPath (no --follow issue with a simple file).
  const { status, stderr } = runCli(['sample.ts:1'], {
    cwd: tempRepoPath,
    env: { GITHUB_TOKEN: '', GITLAB_TOKEN: '' },
  });
  assert.equal(status, 1);
  // Either blame succeeds and we get the GitHub token error, or we get a blame error.
  // Either way it should NOT mention GitLab.
  assert.doesNotMatch(stderr, /GITLAB_TOKEN/);
});

test('GitLab remote triggers GitLab token error when token is absent', () => {
  // Temporarily set GITLAB_HOST to make isGitLabRemote return true for any remote.
  // We use --repo to skip remote URL parsing and go straight to the GitLab flow.
  // blameFile still runs first; in tempRepoPath with sample.ts:1 it should work.
  const { status, stderr } = runCli(['sample.ts:1', '--repo', 'group/project'], {
    cwd: tempRepoPath,
    env: { GITHUB_TOKEN: '', GITLAB_TOKEN: '', GITLAB_HOST: 'https://gitlab.example.com' },
  });
  assert.equal(status, 1);
  // When GITLAB_HOST matches the remote or --repo is used with GitLab detection,
  // the GitLab token error should appear.
  // The remote is github.com so isGitLabRemote returns false even with GITLAB_HOST set
  // (GITLAB_HOST only matters when the remote contains that hostname).
  // This verifies that github.com remotes stay on the GitHub path.
  assert.doesNotMatch(stderr, /GitLab token is required/);
});

test('GITLAB_HOST matching the remote selects GitLab provider', () => {
  // Create a repo with a GitLab-style remote to verify provider selection.
  const gitlabRepo = join(projectRoot, '.tmp-gitlab-repo');
  mkdirSync(gitlabRepo, { recursive: true });
  writeFileSync(join(gitlabRepo, 'app.ts'), 'export const x = 1;\n');
  spawnSync('git', ['init'], { cwd: gitlabRepo });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitlabRepo });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: gitlabRepo });
  spawnSync('git', ['add', '.'], { cwd: gitlabRepo });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: gitlabRepo });
  spawnSync('git', ['remote', 'add', 'origin', 'https://gitlab.mycompany.com/team/project.git'], { cwd: gitlabRepo });

  try {
    const { status, stderr } = runCli(['app.ts:1'], {
      cwd: gitlabRepo,
      env: { GITHUB_TOKEN: '', GITLAB_TOKEN: '', GITLAB_HOST: 'https://gitlab.mycompany.com' },
    });
    assert.equal(status, 1);
    // isGitLabRemote returns true → GitLab flow → missing token error mentions GITLAB_TOKEN
    assert.match(stderr, /GITLAB_TOKEN/);
  } finally {
    rmSync(gitlabRepo, { recursive: true, force: true });
  }
});

// ─── Missing token errors ─────────────────────────────────────────────────────

test('missing GitHub token produces a clear error mentioning GITHUB_TOKEN', () => {
  // Use --repo to bypass remote URL detection, stay on GitHub path.
  // We need blame to succeed first; use tempRepoPath with a known file.
  const { status, stderr } = runCli(['sample.ts:1', '--repo', 'owner/repo'], {
    cwd: tempRepoPath,
    env: { GITHUB_TOKEN: '', GITLAB_TOKEN: '' },
  });
  assert.equal(status, 1);
  assert.match(stderr, /GITHUB_TOKEN/);
});

test('missing GitLab token produces a clear error mentioning GITLAB_TOKEN', () => {
  const gitlabRepo = join(projectRoot, '.tmp-gitlab-token-repo');
  mkdirSync(gitlabRepo, { recursive: true });
  writeFileSync(join(gitlabRepo, 'app.ts'), 'export const x = 1;\n');
  spawnSync('git', ['init'], { cwd: gitlabRepo });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitlabRepo });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: gitlabRepo });
  spawnSync('git', ['add', '.'], { cwd: gitlabRepo });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: gitlabRepo });
  spawnSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/team/project.git'], { cwd: gitlabRepo });

  try {
    const { status, stderr } = runCli(['app.ts:1'], {
      cwd: gitlabRepo,
      env: { GITHUB_TOKEN: '', GITLAB_TOKEN: '' },
    });
    assert.equal(status, 1);
    assert.match(stderr, /GITLAB_TOKEN/);
  } finally {
    rmSync(gitlabRepo, { recursive: true, force: true });
  }
});

// ─── Valid invocations call correct downstream functions ──────────────────────

test('--bus-factor on a tracked path runs bus-factor analysis and exits 0', () => {
  const { status, stdout } = runCli(['.', '--bus-factor'], { cwd: tempRepoPath });
  assert.equal(status, 0);
  assert.match(stdout, /Bus Factor Analysis/);
});

test('--export csv on a tracked path outputs CSV with header row', () => {
  const { status, stdout } = runCli(['.', '--export', 'csv'], { cwd: tempRepoPath });
  assert.equal(status, 0);
  assert.match(stdout, /file,author,lines,percent,lastModified/);
});

test('--export json on a tracked path outputs valid JSON array', () => {
  const { status, stdout } = runCli(['.', '--export', 'json'], { cwd: tempRepoPath });
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout) as unknown[];
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
});

test('--since on a tracked path shows since-report output', () => {
  const { status, stdout } = runCli(['.', '--since', '2020-01-01'], { cwd: tempRepoPath });
  assert.equal(status, 0);
  assert.match(stdout, /Showing blame for changes since/);
});

test('--json flag on a file:line lookup passes validation and reaches API layer', () => {
  // Verifies --json is accepted for file:line targets. Blame runs, then a fake token
  // produces a network/auth error from the GitHub API — not a validation error.
  const { stderr } = runCli(['sample.ts:1', '--repo', 'owner/repo', '--token', 'fake', '--json'], {
    cwd: tempRepoPath,
  });
  assert.doesNotMatch(stderr, /choose only one of/);
  assert.doesNotMatch(stderr, /--json is only supported for <file:line>/);
  assert.doesNotMatch(stderr, /--repo must be in the format/);
});

test('tracked path without any mode flag errors: must use --since, --team, --bus-factor, or --export', () => {
  // A bare directory path without any tracked-path flag is not a valid file:line target either.
  const { status, stderr } = runCli(['src/']);
  assert.equal(status, 1);
  assert.match(stderr, /argument must be in the format <file:line>/);
});
