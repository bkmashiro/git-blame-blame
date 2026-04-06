export interface PRInfo {
  number: number;
  title: string;
  html_url: string;
}

export interface Approver {
  login: string;
  email?: string;
}
