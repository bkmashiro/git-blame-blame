import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getApprovals, getPRForCommit } from '../src/github.ts';

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
