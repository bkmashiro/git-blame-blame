export interface PRInfo {
  number: number;
  title: string;
  html_url: string;
}

export interface Approver {
  login: string;
  email?: string;
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
}

export interface GitLabRepoInfo {
  projectPath: string;
  host: string;
}
