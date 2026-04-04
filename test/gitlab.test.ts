import test from 'node:test';
import assert from 'node:assert/strict';
import { getRepoInfo, isGitLabRemote } from '../src/gitlab.ts';

test('getRepoInfo parses https gitlab.com remote with .git suffix', () => {
  assert.deepEqual(getRepoInfo('https://gitlab.com/acme/my-project.git'), {
    projectPath: 'acme/my-project',
    host: 'https://gitlab.com',
  });
});

test('getRepoInfo parses https gitlab.com remote without .git suffix', () => {
  assert.deepEqual(getRepoInfo('https://gitlab.com/acme/my-project'), {
    projectPath: 'acme/my-project',
    host: 'https://gitlab.com',
  });
});

test('getRepoInfo parses ssh gitlab.com remote', () => {
  assert.deepEqual(getRepoInfo('git@gitlab.com:acme/my-project.git'), {
    projectPath: 'acme/my-project',
    host: 'https://gitlab.com',
  });
});

test('getRepoInfo parses nested group paths', () => {
  const result = getRepoInfo('https://gitlab.com/org/group/subgroup/repo.git');
  assert.equal(result.projectPath, 'org/group/subgroup/repo');
});

test('getRepoInfo throws on unrecognized remote', () => {
  assert.throws(
    () => getRepoInfo('https://github.com/owner/repo.git'),
    /Could not parse project path from remote URL/
  );
});

test('getRepoInfo uses GITLAB_HOST for self-hosted detection', () => {
  const original = process.env.GITLAB_HOST;
  process.env.GITLAB_HOST = 'https://gitlab.mycompany.com';
  try {
    const result = getRepoInfo('https://gitlab.mycompany.com/team/project.git');
    assert.equal(result.projectPath, 'team/project');
    assert.equal(result.host, 'https://gitlab.mycompany.com');
  } finally {
    if (original === undefined) delete process.env.GITLAB_HOST;
    else process.env.GITLAB_HOST = original;
  }
});

test('isGitLabRemote detects gitlab.com URLs', () => {
  assert.equal(isGitLabRemote('https://gitlab.com/acme/repo.git'), true);
  assert.equal(isGitLabRemote('git@gitlab.com:acme/repo.git'), true);
});

test('isGitLabRemote returns false for GitHub URLs', () => {
  assert.equal(isGitLabRemote('https://github.com/acme/repo.git'), false);
  assert.equal(isGitLabRemote('git@github.com:acme/repo.git'), false);
});

test('isGitLabRemote detects self-hosted via GITLAB_HOST', () => {
  const original = process.env.GITLAB_HOST;
  process.env.GITLAB_HOST = 'https://gitlab.mycompany.com';
  try {
    assert.equal(isGitLabRemote('https://gitlab.mycompany.com/team/repo.git'), true);
    assert.equal(isGitLabRemote('https://github.com/team/repo.git'), false);
  } finally {
    if (original === undefined) delete process.env.GITLAB_HOST;
    else process.env.GITLAB_HOST = original;
  }
});
