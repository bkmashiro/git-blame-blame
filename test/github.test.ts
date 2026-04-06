import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getApprovals,
  getPRForCommit,
  getRepoInfo,
  isGitHubRemote,
  parseApprovalsFromReviews,
} from '../src/github.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mockPr = JSON.parse(readFileSync(join(here, 'fixtures/mock-pr.json'), 'utf8')) as Array<{
  number: number;
  title: string;
  html_url: string;
}>;
const mockReviews = JSON.parse(
  readFileSync(join(here, 'fixtures/mock-reviews.json'), 'utf8')
) as Array<{
  state: string;
  user: { login: string; email?: string };
}>;

test('getPRForCommit extracts the PR number from the commits pulls response', async () => {
  const octokit = {
    request: async () => ({ data: mockPr }),
  };

  const pr = await getPRForCommit(octokit as never, 'acme', 'git-blame-blame', 'abc123');

  assert.deepEqual(pr, mockPr[0]);
});

test('getPRForCommit handles no PR found when the response array is empty', async () => {
  const octokit = {
    request: async () => ({ data: [] }),
  };

  const pr = await getPRForCommit(octokit as never, 'acme', 'git-blame-blame', 'abc123');

  assert.equal(pr, null);
});

test('getPRForCommit handles 404 responses by returning null', async () => {
  const octokit = {
    request: async () => {
      throw { status: 404, message: 'Not Found' };
    },
  };

  const pr = await getPRForCommit(octokit as never, 'acme', 'git-blame-blame', 'abc123');

  assert.equal(pr, null);
});

test('getPRForCommit wraps non-404 API failures with commit context', async () => {
  const octokit = {
    request: async () => {
      throw { status: 500, message: 'GitHub exploded' };
    },
  };

  await assert.rejects(
    () => getPRForCommit(octokit as never, 'acme', 'git-blame-blame', 'deadbeef'),
    /Failed to get PR for commit deadbeef: GitHub exploded/
  );
});

test('getApprovals extracts only approved reviewers from the reviews response', async () => {
  const octokit = {
    pulls: {
      listReviews: async () => ({ data: mockReviews }),
    },
  };

  const approvals = await getApprovals(octokit as never, 'acme', 'git-blame-blame', 42);

  assert.deepEqual(
    approvals.map((approval) => approval.login),
    ['alex', 'jamie']
  );
});

test('getApprovals handles reviews with no approvals', async () => {
  const octokit = {
    pulls: {
      listReviews: async () => ({
        data: [
          { state: 'COMMENTED', user: { login: 'sam' } },
          { state: 'CHANGES_REQUESTED', user: { login: 'pat' } },
        ],
      }),
    },
  };

  const approvals = await getApprovals(octokit as never, 'acme', 'git-blame-blame', 42);

  assert.deepEqual(approvals, []);
});

test('getApprovals handles PRs with multiple approvers and deduplicates repeat approvals', async () => {
  const octokit = {
    pulls: {
      listReviews: async () => ({ data: mockReviews }),
    },
  };

  const approvals = await getApprovals(octokit as never, 'acme', 'git-blame-blame', 42);

  assert.equal(approvals.length, 2);
  assert.deepEqual(approvals[0], { login: 'alex', email: 'alex@example.com' });
  assert.deepEqual(approvals[1], { login: 'jamie', email: 'jamie@example.com' });
});

test('parseApprovalsFromReviews ignores approvals with missing users', () => {
  const approvals = parseApprovalsFromReviews([
    { state: 'APPROVED', user: null },
    { state: 'APPROVED' },
    { state: 'COMMENTED', user: { login: 'sam' } },
  ]);

  assert.deepEqual(approvals, []);
});

test('getApprovals wraps API failures with PR context', async () => {
  const octokit = {
    pulls: {
      listReviews: async () => {
        throw new Error('rate limited');
      },
    },
  };

  await assert.rejects(
    () => getApprovals(octokit as never, 'acme', 'git-blame-blame', 42),
    /Failed to get approvals for PR #42: rate limited/
  );
});

test('getRepoInfo parses https remotes with and without .git suffix', () => {
  assert.deepEqual(getRepoInfo('https://github.com/acme/git-blame-blame.git'), {
    owner: 'acme',
    repo: 'git-blame-blame',
  });
  assert.deepEqual(getRepoInfo('https://github.com/acme/git-blame-blame'), {
    owner: 'acme',
    repo: 'git-blame-blame',
  });
});

test('getRepoInfo parses ssh remotes', () => {
  assert.deepEqual(getRepoInfo('git@github.com:acme/git-blame-blame.git'), {
    owner: 'acme',
    repo: 'git-blame-blame',
  });
});

test('getRepoInfo rejects unsupported remotes', () => {
  assert.throws(
    () => getRepoInfo('https://gitlab.com/acme/git-blame-blame.git'),
    /Could not parse owner\/repo from remote URL/
  );
});

test('getRepoInfo uses GITHUB_HOST for GitHub Enterprise instances', () => {
  const original = process.env.GITHUB_HOST;
  process.env.GITHUB_HOST = 'https://github.mycompany.com';
  try {
    assert.deepEqual(getRepoInfo('https://github.mycompany.com/acme/git-blame-blame.git'), {
      owner: 'acme',
      repo: 'git-blame-blame',
    });
    assert.deepEqual(getRepoInfo('https://github.mycompany.com/acme/git-blame-blame'), {
      owner: 'acme',
      repo: 'git-blame-blame',
    });
  } finally {
    if (original === undefined) delete process.env.GITHUB_HOST;
    else process.env.GITHUB_HOST = original;
  }
});

test('getRepoInfo uses GITHUB_HOST for GitHub Enterprise SSH remotes', () => {
  const original = process.env.GITHUB_HOST;
  process.env.GITHUB_HOST = 'https://github.mycompany.com';
  try {
    assert.deepEqual(getRepoInfo('git@github.mycompany.com:acme/git-blame-blame.git'), {
      owner: 'acme',
      repo: 'git-blame-blame',
    });
  } finally {
    if (original === undefined) delete process.env.GITHUB_HOST;
    else process.env.GITHUB_HOST = original;
  }
});

test('getRepoInfo does not match a different enterprise host when GITHUB_HOST is set', () => {
  const original = process.env.GITHUB_HOST;
  process.env.GITHUB_HOST = 'https://github.mycompany.com';
  try {
    assert.throws(
      () => getRepoInfo('https://github.othercompany.com/acme/repo.git'),
      /Could not parse owner\/repo from remote URL/
    );
  } finally {
    if (original === undefined) delete process.env.GITHUB_HOST;
    else process.env.GITHUB_HOST = original;
  }
});

test('isGitHubRemote detects github.com URLs', () => {
  assert.equal(isGitHubRemote('https://github.com/acme/repo.git'), true);
  assert.equal(isGitHubRemote('git@github.com:acme/repo.git'), true);
});

test('isGitHubRemote returns false for non-GitHub URLs', () => {
  assert.equal(isGitHubRemote('https://gitlab.com/acme/repo.git'), false);
  assert.equal(isGitHubRemote('git@gitlab.com:acme/repo.git'), false);
});

test('isGitHubRemote detects self-hosted via GITHUB_HOST', () => {
  const original = process.env.GITHUB_HOST;
  process.env.GITHUB_HOST = 'https://github.mycompany.com';
  try {
    assert.equal(isGitHubRemote('https://github.mycompany.com/team/repo.git'), true);
    assert.equal(isGitHubRemote('https://gitlab.com/team/repo.git'), false);
  } finally {
    if (original === undefined) delete process.env.GITHUB_HOST;
    else process.env.GITHUB_HOST = original;
  }
});
