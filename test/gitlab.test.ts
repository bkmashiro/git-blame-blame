import test from 'node:test';
import assert from 'node:assert/strict';
import { getRepoInfo, isGitLabRemote, getPRForCommit, getApprovals } from '../src/gitlab.ts';

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(response: unknown, status = 200): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Internal Server Error',
    json: async () => response,
  } as Response);
  return () => { globalThis.fetch = original; };
}

function mockFetchError(message: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error(message); };
  return () => { globalThis.fetch = original; };
}

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

test('isGitLabRemote does not match mygitlab.company.com as gitlab.com', () => {
  // A URL whose hostname contains "gitlab.com" as a substring should NOT match
  // when GITLAB_HOST is not set. The includes() check on the raw URL string
  // produces a false positive because "mygitlab.company.com" contains "gitlab.com".
  const original = process.env.GITLAB_HOST;
  delete process.env.GITLAB_HOST;
  try {
    assert.equal(isGitLabRemote('https://mygitlab.company.com/team/repo.git'), false);
  } finally {
    if (original === undefined) delete process.env.GITLAB_HOST;
    else process.env.GITLAB_HOST = original;
  }
});

// ---------------------------------------------------------------------------
// getPRForCommit
// ---------------------------------------------------------------------------

test('getPRForCommit returns a PRInfo for the first MR in the list', async () => {
  const restore = mockFetch([
    { iid: 7, title: 'feat: add stuff', web_url: 'https://gitlab.com/acme/repo/-/merge_requests/7' },
    { iid: 8, title: 'chore: unrelated', web_url: 'https://gitlab.com/acme/repo/-/merge_requests/8' },
  ]);
  try {
    const pr = await getPRForCommit('acme/repo', 'abc123', 'https://gitlab.com');
    assert.deepEqual(pr, {
      number: 7,
      title: 'feat: add stuff',
      html_url: 'https://gitlab.com/acme/repo/-/merge_requests/7',
    });
  } finally {
    restore();
  }
});

test('getPRForCommit returns null when the MR list is empty', async () => {
  const restore = mockFetch([]);
  try {
    const pr = await getPRForCommit('acme/repo', 'abc123', 'https://gitlab.com');
    assert.equal(pr, null);
  } finally {
    restore();
  }
});

test('getPRForCommit returns null on 404', async () => {
  const restore = mockFetch({ message: '404 Not Found' }, 404);
  try {
    const pr = await getPRForCommit('acme/repo', 'deadbeef', 'https://gitlab.com');
    assert.equal(pr, null);
  } finally {
    restore();
  }
});

test('getPRForCommit wraps non-404 API failures with commit context', async () => {
  const restore = mockFetch({ message: 'Internal Server Error' }, 500);
  try {
    await assert.rejects(
      () => getPRForCommit('acme/repo', 'deadbeef', 'https://gitlab.com'),
      /Failed to get MR for commit deadbeef/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// getApprovals
// ---------------------------------------------------------------------------

test('getApprovals returns approvers mapped from approved_by', async () => {
  const restore = mockFetch({
    approved_by: [
      { user: { username: 'alex', email: 'alex@example.com' } },
      { user: { username: 'jamie', email: 'jamie@example.com' } },
    ],
  });
  try {
    const approvals = await getApprovals('acme/repo', 7, 'https://gitlab.com');
    assert.deepEqual(approvals, [
      { login: 'alex', email: 'alex@example.com' },
      { login: 'jamie', email: 'jamie@example.com' },
    ]);
  } finally {
    restore();
  }
});

test('getApprovals returns an empty array when approved_by is absent', async () => {
  const restore = mockFetch({ approved_by: [] });
  try {
    const approvals = await getApprovals('acme/repo', 7, 'https://gitlab.com');
    assert.deepEqual(approvals, []);
  } finally {
    restore();
  }
});

test('getApprovals handles missing approved_by key gracefully', async () => {
  const restore = mockFetch({});
  try {
    const approvals = await getApprovals('acme/repo', 7, 'https://gitlab.com');
    assert.deepEqual(approvals, []);
  } finally {
    restore();
  }
});

test('getApprovals wraps API failures with MR context', async () => {
  const restore = mockFetchError('connection refused');
  try {
    await assert.rejects(
      () => getApprovals('acme/repo', 42, 'https://gitlab.com'),
      /Failed to get approvals for MR !42: connection refused/
    );
  } finally {
    restore();
  }
});

test('getPRForCommit wraps non-404 API failures with commit context', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' }) as never;
  try {
    await assert.rejects(
      () => getPRForCommit('acme/project', 'deadbeef', 'https://gitlab.com'),
      /Failed to get MR for commit deadbeef/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getPRForCommit error message does not contain "undefined" when error has no message field', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw { status: 500 };
  };
  try {
    await assert.rejects(
      () => getPRForCommit('acme/project', 'deadbeef', 'https://gitlab.com'),
      (err: Error) => {
        assert.ok(!err.message.includes('undefined'), `Error message should not contain "undefined": ${err.message}`);
        assert.match(err.message, /Failed to get MR for commit deadbeef/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
