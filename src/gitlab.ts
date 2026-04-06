export interface RepoInfo {
  projectPath: string;
  host: string;
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

/**
 * Extracts the GitLab project path and host from a remote URL.
 *
 * The host is read from the `GITLAB_HOST` environment variable (defaulting to
 * `https://gitlab.com`). Both HTTPS and SSH remote formats are supported,
 * including self-hosted instances and nested group paths.
 *
 * @param remoteUrl - The `git remote get-url origin` value to parse.
 * @returns Parsed project path (e.g. `"group/subgroup/repo"`) and resolved host URL.
 * @throws {Error} If the URL does not match the configured GitLab hostname.
 */
export function getRepoInfo(remoteUrl: string): RepoInfo {
  const host = process.env.GITLAB_HOST?.replace(/\/$/, '') ?? 'https://gitlab.com';
  const hostname = new URL(host).hostname;

  // HTTPS: https://gitlab.com/owner/repo.git or https://gitlab.mycompany.com/group/subgroup/repo
  const httpsMatch = remoteUrl.match(new RegExp(`https?://(?:[^@]+@)?${escapeRegex(hostname)}/(.+?)(?:\\.git)?$`));
  if (httpsMatch) {
    return { projectPath: httpsMatch[1], host };
  }

  // SSH: git@gitlab.com:owner/repo.git
  const sshMatch = remoteUrl.match(new RegExp(`git@${escapeRegex(hostname)}:(.+?)(?:\\.git)?$`));
  if (sshMatch) {
    return { projectPath: sshMatch[1], host };
  }

  throw new Error(`Could not parse project path from remote URL: ${remoteUrl}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function gitlabHeaders(): Record<string, string> {
  const token = process.env.GITLAB_TOKEN;
  return token ? { 'PRIVATE-TOKEN': token } : {};
}

async function gitlabFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: gitlabHeaders() });
  if (!res.ok) {
    const err = new Error(`GitLab API error ${res.status}: ${res.statusText}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Looks up the merge request associated with a commit SHA via the GitLab API.
 *
 * @param projectPath - URL-encoded GitLab project path (e.g. `"group/repo"`).
 * @param sha - Full commit SHA to look up.
 * @param host - GitLab host URL (e.g. `"https://gitlab.com"`).
 * @returns The first associated MR mapped to the shared `PRInfo` shape, or `null`
 *   if none exists or the project/commit is not found (404).
 * @throws {Error} If the GitLab API call fails for any reason other than a 404.
 */
export async function getPRForCommit(projectPath: string, sha: string, host: string): Promise<PRInfo | null> {
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${host}/api/v4/projects/${encodedPath}/repository/commits/${sha}/merge_requests`;

  try {
    const mrs = await gitlabFetch(url) as Array<{ iid: number; title: string; web_url: string }>;
    if (mrs.length === 0) return null;
    const mr = mrs[0];
    return { number: mr.iid, title: mr.title, html_url: mr.web_url };
  } catch (err) {
    const error = err as { status?: number; message?: string };
    if (error.status === 404) return null;
    throw new Error(`Failed to get MR for commit ${sha}: ${error.message}`);
  }
}

/**
 * Fetches the list of users who have approved a GitLab merge request.
 *
 * @param projectPath - URL-encoded GitLab project path (e.g. `"group/repo"`).
 * @param mrIid - Internal merge request IID (project-scoped integer identifier).
 * @param host - GitLab host URL (e.g. `"https://gitlab.com"`).
 * @returns Array of approvers; empty if the MR has no approvals or `approved_by` is absent.
 * @throws {Error} If the GitLab API call fails.
 */
export async function getApprovals(projectPath: string, mrIid: number, host: string): Promise<Approver[]> {
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${host}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/approvals`;

  try {
    const data = await gitlabFetch(url) as { approved_by?: Array<{ user: { username: string; email?: string } }> };
    const approvedBy = data.approved_by ?? [];
    return approvedBy.map((entry) => ({
      login: entry.user.username,
      email: entry.user.email,
    }));
  } catch (err) {
    throw new Error(`Failed to get approvals for MR !${mrIid}: ${(err as Error).message}`);
  }
}

/**
 * Determines whether a git remote URL points to a GitLab instance.
 *
 * Checks for `gitlab.com` as well as any custom hostname configured via the
 * `GITLAB_HOST` environment variable. Returns `false` if `GITLAB_HOST` is set
 * to an invalid URL.
 *
 * @param remoteUrl - The git remote URL to inspect.
 * @returns `true` if the URL contains a recognised GitLab hostname, `false` otherwise.
 */
export function isGitLabRemote(remoteUrl: string): boolean {
  const host = process.env.GITLAB_HOST?.replace(/\/$/, '') ?? '';
  const defaultHostname = 'gitlab.com';

  if (remoteUrl.includes(defaultHostname)) return true;
  if (host) {
    try {
      const hostname = new URL(host).hostname;
      return remoteUrl.includes(hostname);
    } catch {
      return false;
    }
  }
  return false;
}
