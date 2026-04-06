import { Octokit } from '@octokit/rest';
import type { PRInfo, Approver } from './types.js';

export type { PRInfo, Approver };

/** GitHub repository coordinates parsed from a remote URL. */
export interface RepoInfo {
  /** GitHub organisation or user name. */
  owner: string;
  /** Repository name. */
  repo: string;
}

/**
 * Extracts the first pull request from a GitHub "commits pulls" API response.
 *
 * @param pulls - Array of pull request objects returned by the GitHub API.
 * @returns The first {@link PRInfo}, or `null` if the array is empty.
 */
export function parsePRFromCommitPullsResponse(
  pulls: Array<{ number: number; title: string; html_url: string }>
): PRInfo | null {
  if (pulls.length === 0) {
    return null;
  }

  const pr = pulls[0];
  return {
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
  };
}

/**
 * Filters a list of GitHub review objects down to unique approvals.
 *
 * Only reviews with `state === 'APPROVED'` are included. If the same reviewer
 * approved multiple times, they appear once in the output.
 *
 * @param reviews - Array of review objects from the GitHub list-reviews API.
 * @returns Deduplicated list of approvers.
 */
export function parseApprovalsFromReviews(
  reviews: Array<{ state?: string; user?: { login: string; email?: string | null } | null }>
): Approver[] {
  const approvalMap = new Map<string, Approver>();

  for (const review of reviews) {
    if (review.state === 'APPROVED' && review.user) {
      approvalMap.set(review.user.login, {
        login: review.user.login,
        email: review.user.email ?? undefined,
      });
    }
  }

  return Array.from(approvalMap.values());
}

/**
 * Extracts GitHub owner and repository name from an HTTPS or SSH remote URL.
 * @param remoteUrl - Git remote URL (HTTPS or SSH format).
 * @returns Parsed `owner` and `repo` strings.
 */
export function getRepoInfo(remoteUrl: string): RepoInfo {
  // Support HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
  // Support SSH: git@github.com:owner/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new Error(`Could not parse owner/repo from remote URL: ${remoteUrl}`);
}

/**
 * Looks up the first pull request associated with a commit SHA via the GitHub API.
 * @param octokit - Authenticated Octokit client.
 * @param owner - Repository owner (user or organisation).
 * @param repo - Repository name.
 * @param sha - Full commit SHA to look up.
 * @returns The matching PR info, or `null` if none exists or the repo is not found.
 */
export async function getPRForCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<PRInfo | null> {
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
      owner,
      repo,
      commit_sha: sha,
      headers: {
        accept: 'application/vnd.github.groot-preview+json',
      },
    });

    const pulls = response.data as Array<{ number: number; title: string; html_url: string }>;
    return parsePRFromCommitPullsResponse(pulls);
  } catch (err) {
    const error = err as { status?: number; message?: string };
    if (error.status === 404) {
      return null;
    }
    throw new Error(`Failed to get PR for commit ${sha}: ${error.message ?? String(err)}`);
  }
}

/**
 * Fetches the list of approving reviewers for a GitHub pull request.
 * @param octokit - Authenticated Octokit client.
 * @param owner - Repository owner (user or organisation).
 * @param repo - Repository name.
 * @param pullNumber - Pull request number.
 * @returns Array of approvers (deduplicated by login).
 */
export async function getApprovals(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<Approver[]> {
  try {
    const response = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return parseApprovalsFromReviews(response.data);
  } catch (err) {
    throw new Error(`Failed to get approvals for PR #${pullNumber}: ${(err as Error).message}`);
  }
}
