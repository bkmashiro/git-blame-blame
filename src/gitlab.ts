/** GitLab project coordinates parsed from a remote URL. */
export interface RepoInfo {
  /** URL-encoded project path, e.g. `group/subgroup/repo`. */
  projectPath: string;
  /** GitLab host base URL, e.g. `https://gitlab.com`. */
  host: string;
}

/** Subset of merge request fields used for display and linking. */
export interface PRInfo {
  /** Merge request IID (internal ID within the project). */
  number: number;
  /** Merge request title. */
  title: string;
  /** URL to the merge request on GitLab. */
  html_url: string;
}

/** A user who approved a GitLab merge request. */
export interface Approver {
  /** GitLab username of the approver. */
  login: string;
  /** Email address of the approver, if available. */
  email?: string;
}

/**
 * Extracts the GitLab project path and host from an HTTPS or SSH remote URL.
 * @param remoteUrl - Git remote URL (HTTPS or SSH format).
 * @returns Parsed `projectPath` (e.g. `group/subgroup/repo`) and `host` base URL.
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
 * Looks up the first merge request associated with a commit SHA via the GitLab API.
 * @param projectPath - URL-encoded GitLab project path (e.g. `group/repo`).
 * @param sha - Full commit SHA to look up.
 * @param host - GitLab host base URL (e.g. `https://gitlab.com`).
 * @returns The matching MR info as a `PRInfo`, or `null` if none exists or the project is not found.
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
 * Fetches the list of approving users for a GitLab merge request.
 * @param projectPath - URL-encoded GitLab project path (e.g. `group/repo`).
 * @param mrIid - Internal merge request ID (iid) within the project.
 * @param host - GitLab host base URL (e.g. `https://gitlab.com`).
 * @returns Array of approvers with `login` (username) and optional `email`.
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

function hostnameMatches(remoteUrl: string, hostname: string): boolean {
  // Match the hostname as a whole component, not as a substring of another hostname.
  // Handles both HTTPS (://hostname/) and SSH (git@hostname:) URL forms.
  return new RegExp(`(?:https?://[^@]*@?|git@)${escapeRegex(hostname)}(?:[:/])`).test(remoteUrl);
}

export function isGitLabRemote(remoteUrl: string): boolean {
  const host = process.env.GITLAB_HOST?.replace(/\/$/, '') ?? '';
  const defaultHostname = 'gitlab.com';

  if (hostnameMatches(remoteUrl, defaultHostname)) return true;
  if (host) {
    try {
      const hostname = new URL(host).hostname;
      return hostnameMatches(remoteUrl, hostname);
    } catch {
      return false;
    }
  }
  return false;
}
