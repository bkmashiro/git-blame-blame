import { Octokit } from '@octokit/rest';

export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface PRInfo {
  number: number;
  title: string;
  html_url: string;
}

export interface Approver {
  login: string;
  email?: string;
}

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
    throw new Error(`Failed to get PR for commit ${sha}: ${error.message}`);
  }
}

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
