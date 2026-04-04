import * as vscode from 'vscode';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Octokit } from '@octokit/rest';

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

interface BlameInfo {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  date: string;
  summary: string;
  line: number;
  lineContent: string;
}

interface PRInfo {
  number: number;
  title: string;
  url: string;
  author: string;
  reviewers: string[];
  platform: 'github' | 'gitlab';
}

interface RepoRemote {
  platform: 'github' | 'gitlab';
  owner: string;
  repo: string;
  baseUrl: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const prCache = new Map<string, PRInfo | null>();
const blameCache = new Map<string, BlameInfo[]>();

function clearCache() {
  prCache.clear();
  blameCache.clear();
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

async function getGitBlameForLine(filePath: string, line: number): Promise<BlameInfo | null> {
  try {
    const dir = path.dirname(filePath);
    const { stdout } = await execFileAsync(
      'git',
      ['blame', '-L', `${line},${line}`, '--porcelain', filePath],
      { cwd: dir }
    );
    return parseBlameOutput(stdout, line);
  } catch {
    return null;
  }
}

async function getGitBlameForFile(filePath: string): Promise<BlameInfo[]> {
  const cached = blameCache.get(filePath);
  if (cached) return cached;

  try {
    const dir = path.dirname(filePath);
    const { stdout } = await execFileAsync(
      'git',
      ['blame', '--porcelain', filePath],
      { cwd: dir }
    );
    const results = parseFullBlameOutput(stdout);
    blameCache.set(filePath, results);
    return results;
  } catch {
    return [];
  }
}

function parseBlameOutput(output: string, line: number): BlameInfo | null {
  const lines = output.split('\n');
  if (lines.length < 2) return null;

  const firstLine = lines[0];
  const shaMatch = firstLine.match(/^([0-9a-f]{40})/);
  if (!shaMatch) return null;

  const sha = shaMatch[1];
  const shortSha = sha.slice(0, 7);

  const get = (key: string) => {
    const l = lines.find((x) => x.startsWith(key + ' '));
    return l ? l.slice(key.length + 1).trim() : '';
  };

  const authorTime = get('author-time');
  const date = authorTime
    ? new Date(parseInt(authorTime, 10) * 1000).toISOString().slice(0, 10)
    : '';

  const lineContent = lines.find((l) => l.startsWith('\t'))?.slice(1) ?? '';

  return {
    sha,
    shortSha,
    author: get('author'),
    email: get('author-mail').replace(/[<>]/g, ''),
    date,
    summary: get('summary'),
    line,
    lineContent,
  };
}

function parseFullBlameOutput(output: string): BlameInfo[] {
  const results: BlameInfo[] = [];
  const lines = output.split('\n');
  let i = 0;

  while (i < lines.length) {
    const headerMatch = lines[i]?.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (!headerMatch) {
      i++;
      continue;
    }

    const sha = headerMatch[1];
    const lineNum = parseInt(headerMatch[2], 10);
    const block: string[] = [lines[i]];
    i++;

    while (i < lines.length && !lines[i].match(/^[0-9a-f]{40}/)) {
      block.push(lines[i]);
      i++;
    }

    const info = parseBlameOutput([lines[i - block.length - 1] ?? '', ...block].join('\n'), lineNum);
    if (info) results.push({ ...info, sha, shortSha: sha.slice(0, 7) });
  }

  return results;
}

async function getRemote(workspaceRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd: workspaceRoot }
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

function parseRemote(remoteUrl: string, gitlabBaseUrl: string): RepoRemote | null {
  // GitHub
  const ghHttps = remoteUrl.match(/https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/.]+)/);
  if (ghHttps) {
    return { platform: 'github', owner: ghHttps[1], repo: ghHttps[2], baseUrl: 'https://github.com' };
  }
  const ghSsh = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)/);
  if (ghSsh) {
    return { platform: 'github', owner: ghSsh[1], repo: ghSsh[2], baseUrl: 'https://github.com' };
  }

  // GitLab (including self-hosted)
  const glBaseHost = gitlabBaseUrl.replace(/https?:\/\//, '').replace(/\/$/, '');
  const glHttps = remoteUrl.match(new RegExp(`https?://(?:[^@]+@)?${escapeRegex(glBaseHost)}/([^/]+)/([^/.]+)`));
  if (glHttps) {
    return { platform: 'gitlab', owner: glHttps[1], repo: glHttps[2], baseUrl: gitlabBaseUrl };
  }
  const glSsh = remoteUrl.match(new RegExp(`git@${escapeRegex(glBaseHost)}:([^/]+)/([^/.]+)`));
  if (glSsh) {
    return { platform: 'gitlab', owner: glSsh[1], repo: glSsh[2], baseUrl: gitlabBaseUrl };
  }

  // Generic GitLab detection (git@gitlab.*)
  const glGenericSsh = remoteUrl.match(/git@(gitlab\.[^:]+):([^/]+)\/([^/.]+)/);
  if (glGenericSsh) {
    return { platform: 'gitlab', owner: glGenericSsh[2], repo: glGenericSsh[3], baseUrl: `https://${glGenericSsh[1]}` };
  }
  const glGenericHttps = remoteUrl.match(/https?:\/\/(gitlab\.[^/]+)\/([^/]+)\/([^/.]+)/);
  if (glGenericHttps) {
    return { platform: 'gitlab', owner: glGenericHttps[2], repo: glGenericHttps[3], baseUrl: `https://${glGenericHttps[1]}` };
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── PR fetching ──────────────────────────────────────────────────────────────

async function getPRInfo(
  sha: string,
  remote: RepoRemote,
  config: vscode.WorkspaceConfiguration
): Promise<PRInfo | null> {
  const cacheKey = `${remote.platform}:${remote.owner}/${remote.repo}:${sha}`;
  if (prCache.has(cacheKey)) return prCache.get(cacheKey)!;

  let result: PRInfo | null = null;
  try {
    if (remote.platform === 'github') {
      result = await fetchGitHubPR(sha, remote, config);
    } else {
      result = await fetchGitLabPR(sha, remote, config);
    }
  } catch {
    result = null;
  }

  prCache.set(cacheKey, result);
  return result;
}

async function fetchGitHubPR(
  sha: string,
  remote: RepoRemote,
  config: vscode.WorkspaceConfiguration
): Promise<PRInfo | null> {
  const token = config.get<string>('githubToken') || process.env.GITHUB_TOKEN;
  if (!token) return null;

  const octokit = new Octokit({ auth: token });
  const pulls = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
    owner: remote.owner,
    repo: remote.repo,
    commit_sha: sha,
    headers: { accept: 'application/vnd.github.groot-preview+json' },
  });

  const prs = pulls.data as Array<{ number: number; title: string; html_url: string; user: { login: string } | null }>;
  if (!prs.length) return null;

  const pr = prs[0];
  const reviews = await octokit.pulls.listReviews({
    owner: remote.owner,
    repo: remote.repo,
    pull_number: pr.number,
  });

  const approvers = Array.from(
    new Set(
      reviews.data
        .filter((r) => r.state === 'APPROVED' && r.user)
        .map((r) => r.user!.login)
    )
  );

  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    author: pr.user?.login ?? 'unknown',
    reviewers: approvers,
    platform: 'github',
  };
}

async function fetchGitLabPR(
  sha: string,
  remote: RepoRemote,
  config: vscode.WorkspaceConfiguration
): Promise<PRInfo | null> {
  const token = config.get<string>('gitlabToken') || process.env.GITLAB_TOKEN;
  if (!token) return null;

  const baseUrl = remote.baseUrl.replace(/\/$/, '');
  const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);

  const headers: Record<string, string> = { 'PRIVATE-TOKEN': token };

  // Find MR associated with commit
  const mrsResp = await fetch(
    `${baseUrl}/api/v4/projects/${projectPath}/repository/commits/${sha}/merge_requests`,
    { headers }
  );
  if (!mrsResp.ok) return null;

  const mrs = await mrsResp.json() as Array<{ iid: number; title: string; web_url: string; author: { username: string } }>;
  if (!mrs.length) return null;

  const mr = mrs[0];

  // Get approvals
  const approvalsResp = await fetch(
    `${baseUrl}/api/v4/projects/${projectPath}/merge_requests/${mr.iid}/approvals`,
    { headers }
  );

  let approvers: string[] = [];
  if (approvalsResp.ok) {
    const data = await approvalsResp.json() as { approved_by?: Array<{ user: { username: string } }> };
    approvers = (data.approved_by ?? []).map((a) => a.user.username);
  }

  return {
    number: mr.iid,
    title: mr.title,
    url: mr.web_url,
    author: mr.author.username,
    reviewers: approvers,
    platform: 'gitlab',
  };
}

// ─── Hover Provider ───────────────────────────────────────────────────────────

class BlameHoverProvider implements vscode.HoverProvider {
  private pendingRequest: ReturnType<typeof setTimeout> | undefined;

  constructor() {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | null> {
    const config = vscode.workspace.getConfiguration('gitBlameBlame');
    if (!config.get<boolean>('enableHover', true)) return null;
    if (document.isUntitled || document.uri.scheme !== 'file') return null;

    const line = position.line + 1;
    const filePath = document.uri.fsPath;

    const blame = await getGitBlameForLine(filePath, line);
    if (!blame) return null;

    if (blame.sha.startsWith('0000000')) {
      const md = new vscode.MarkdownString('$(circle-slash) **Uncommitted change**', true);
      md.isTrusted = true;
      return new vscode.Hover(md);
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const root = workspaceFolder?.uri.fsPath ?? path.dirname(filePath);
    const gitlabBaseUrl = config.get<string>('gitlabUrl', 'https://gitlab.com');

    const remoteUrl = await getRemote(root);
    const remote = remoteUrl ? parseRemote(remoteUrl, gitlabBaseUrl) : null;

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportHtml = false;

    md.appendMarkdown(`**$(git-commit) ${blame.shortSha}** — ${escapeMarkdown(blame.summary)}\n\n`);
    md.appendMarkdown(`$(account) **${escapeMarkdown(blame.author)}** \`${blame.email}\`  \n`);
    md.appendMarkdown(`$(calendar) ${blame.date}\n\n`);

    if (remote) {
      const delay = config.get<number>('hoverDelay', 300);
      const pr = await new Promise<PRInfo | null>((resolve) => {
        if (this.pendingRequest) clearTimeout(this.pendingRequest);
        this.pendingRequest = setTimeout(async () => {
          resolve(await getPRInfo(blame.sha, remote, config));
        }, delay);
      });

      if (pr) {
        const platformIcon = pr.platform === 'github' ? '$(github)' : '$(git-pull-request)';
        md.appendMarkdown(`---\n\n`);
        md.appendMarkdown(`${platformIcon} **[#${pr.number} ${escapeMarkdown(pr.title)}](${pr.url})**\n\n`);
        md.appendMarkdown(`$(person) **Author:** ${escapeMarkdown(pr.author)}  \n`);
        if (pr.reviewers.length > 0) {
          md.appendMarkdown(`$(check) **Approved by:** ${pr.reviewers.map(escapeMarkdown).join(', ')}\n`);
        } else {
          md.appendMarkdown(`$(warning) **No approvals recorded**\n`);
        }
      } else {
        md.appendMarkdown(`---\n\n$(info) No associated PR found`);
      }
    } else {
      md.appendMarkdown(`\n\n$(info) Configure \`gitBlameBlame.githubToken\` or \`gitBlameBlame.gitlabToken\` to see PR details`);
    }

    return new vscode.Hover(md);
  }
}

function escapeMarkdown(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

// ─── Blame Tree View ──────────────────────────────────────────────────────────

interface BlameEntry {
  blame: BlameInfo;
  pr?: PRInfo | null;
}

function makeBlameTreeItem(entry: BlameEntry): vscode.TreeItem {
  const label = `${entry.blame.shortSha} — Line ${entry.blame.line}`;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.description = entry.blame.date;
  item.tooltip = new vscode.MarkdownString(
    `**${entry.blame.summary}**\n\n${entry.blame.author} \`${entry.blame.email}\`\n\n${entry.blame.date}`
  );
  item.iconPath = new vscode.ThemeIcon('git-commit');
  item.contextValue = 'blameEntry';
  (item as vscode.TreeItem & { _entry: BlameEntry })._entry = entry;
  return item;
}

function makeBlameDetailItem(label: string, desc: string, icon: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = desc;
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

class BlameTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private blameEntries: BlameEntry[] = [];
  private filePath: string | undefined;
  private remote: RepoRemote | null = null;
  private config: vscode.WorkspaceConfiguration | null = null;

  async refresh(document: vscode.TextDocument | undefined): Promise<void> {
    if (!document || document.isUntitled || document.uri.scheme !== 'file') {
      this.blameEntries = [];
      this.filePath = undefined;
      this._onDidChangeTreeData.fire();
      return;
    }

    this.filePath = document.uri.fsPath;
    this.config = vscode.workspace.getConfiguration('gitBlameBlame');
    const gitlabBaseUrl = this.config.get<string>('gitlabUrl', 'https://gitlab.com');

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const root = workspaceFolder?.uri.fsPath ?? path.dirname(this.filePath!);
    const remoteUrl = await getRemote(root);
    this.remote = remoteUrl ? parseRemote(remoteUrl, gitlabBaseUrl) : null;

    blameCache.delete(this.filePath!);
    const blames = await getGitBlameForFile(this.filePath!);

    // Deduplicate by commit sha
    const shaMap = new Map<string, BlameInfo>();
    for (const b of blames) {
      if (!shaMap.has(b.sha)) {
        shaMap.set(b.sha, b);
      }
    }

    this.blameEntries = Array.from(shaMap.values()).map((blame) => ({
      blame,
      pr: undefined,
    }));

    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      if (this.blameEntries.length === 0) {
        const placeholder = new vscode.TreeItem('No blame data', vscode.TreeItemCollapsibleState.None);
        placeholder.iconPath = new vscode.ThemeIcon('info');
        return [placeholder];
      }
      return this.blameEntries.map((e) => makeBlameTreeItem(e));
    }

    const entry = (element as vscode.TreeItem & { _entry?: BlameEntry })._entry;
    if (!entry) return [];

    const { blame } = entry;
    const items: vscode.TreeItem[] = [
      makeBlameDetailItem('Commit', blame.shortSha, 'git-commit'),
      makeBlameDetailItem('Author', `${blame.author} <${blame.email}>`, 'account'),
      makeBlameDetailItem('Date', blame.date, 'calendar'),
      makeBlameDetailItem('Message', blame.summary, 'comment'),
    ];

    if (this.remote && this.config && !blame.sha.startsWith('0000000')) {
      let pr = entry.pr;
      if (pr === undefined) {
        pr = await getPRInfo(blame.sha, this.remote, this.config);
        entry.pr = pr;
      }

      if (pr) {
        const icon = pr.platform === 'github' ? 'github' : 'git-pull-request';
        items.push(makeBlameDetailItem('PR', `#${pr.number} ${pr.title}`, icon));
        items.push(makeBlameDetailItem('PR Author', pr.author, 'person'));
        if (pr.reviewers.length > 0) {
          items.push(makeBlameDetailItem('Approved by', pr.reviewers.join(', '), 'check'));
        } else {
          items.push(makeBlameDetailItem('Approved by', '(none recorded)', 'warning'));
        }
      } else {
        items.push(makeBlameDetailItem('PR', 'Not found', 'info'));
      }
    }

    return items;
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────

async function updateStatusBar(
  statusBar: vscode.StatusBarItem,
  editor: vscode.TextEditor | undefined
): Promise<void> {
  if (!editor || editor.document.isUntitled || editor.document.uri.scheme !== 'file') {
    statusBar.hide();
    return;
  }

  const line = editor.selection.active.line + 1;
  const blame = await getGitBlameForLine(editor.document.uri.fsPath, line);

  if (!blame || blame.sha.startsWith('0000000')) {
    statusBar.text = '$(git-commit) Uncommitted';
    statusBar.tooltip = 'This line has not been committed yet';
  } else {
    statusBar.text = `$(git-commit) ${blame.shortSha} — ${blame.author} (${blame.date})`;
    statusBar.tooltip = blame.summary;
  }

  statusBar.show();
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Git Blame Blame');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'gitBlameBlame.blameLine';

  const treeDataProvider = new BlameTreeDataProvider();
  const treeView = vscode.window.createTreeView('gitBlameBlameView', {
    treeDataProvider,
    showCollapseAll: true,
  });

  // Hover provider — register for all file types
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file' },
    new BlameHoverProvider()
  );

  // ── Commands ──

  const cmdBlameLine = vscode.commands.registerCommand('gitBlameBlame.blameLine', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.isUntitled) {
      vscode.window.showErrorMessage('Git Blame Blame: No active file.');
      return;
    }

    const line = editor.selection.active.line + 1;
    const blame = await getGitBlameForLine(editor.document.uri.fsPath, line);

    if (!blame) {
      vscode.window.showErrorMessage('Git Blame Blame: Could not get blame for this line.');
      return;
    }

    if (blame.sha.startsWith('0000000')) {
      vscode.window.showInformationMessage('Git Blame Blame: This line is uncommitted.');
      return;
    }

    const config = vscode.workspace.getConfiguration('gitBlameBlame');
    const gitlabBaseUrl = config.get<string>('gitlabUrl', 'https://gitlab.com');
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const root = workspaceFolder?.uri.fsPath ?? path.dirname(editor.document.uri.fsPath);
    const remoteUrl = await getRemote(root);
    const remote = remoteUrl ? parseRemote(remoteUrl, gitlabBaseUrl) : null;

    outputChannel.clear();
    outputChannel.appendLine(`File: ${editor.document.uri.fsPath}:${line}`);
    outputChannel.appendLine(`Commit: ${blame.sha}`);
    outputChannel.appendLine(`Author: ${blame.author} <${blame.email}>`);
    outputChannel.appendLine(`Date: ${blame.date}`);
    outputChannel.appendLine(`Message: ${blame.summary}`);

    if (remote) {
      outputChannel.appendLine(`\nFetching PR info from ${remote.platform}...`);
      const pr = await getPRInfo(blame.sha, remote, config);
      if (pr) {
        outputChannel.appendLine(`PR #${pr.number}: ${pr.title}`);
        outputChannel.appendLine(`URL: ${pr.url}`);
        outputChannel.appendLine(`Author: ${pr.author}`);
        outputChannel.appendLine(`Approved by: ${pr.reviewers.join(', ') || '(none)'}`);

        const msg = `${blame.shortSha}: ${blame.summary} | PR #${pr.number} by ${pr.author}` +
          (pr.reviewers.length ? ` | Approved: ${pr.reviewers.join(', ')}` : '');
        const prUrl = pr.url;
        vscode.window.showInformationMessage(msg, 'Open PR').then((choice: string | undefined) => {
          if (choice === 'Open PR') vscode.env.openExternal(vscode.Uri.parse(prUrl));
        });
      } else {
        outputChannel.appendLine('No PR found for this commit.');
        vscode.window.showInformationMessage(
          `${blame.shortSha} by ${blame.author} on ${blame.date}: ${blame.summary} (no PR found)`
        );
      }
    } else {
      vscode.window.showInformationMessage(
        `${blame.shortSha} by ${blame.author} on ${blame.date}: ${blame.summary}`
      );
    }

    outputChannel.show(true);
  });

  const cmdBlameFile = vscode.commands.registerCommand('gitBlameBlame.blameFile', async () => {
    const editor = vscode.window.activeTextEditor;
    await treeDataProvider.refresh(editor?.document);
    treeView.reveal(undefined as unknown as vscode.TreeItem, { focus: true }).then(
      () => {},
      () => {}
    );
  });

  const cmdRefresh = vscode.commands.registerCommand('gitBlameBlame.refreshBlame', async () => {
    clearCache();
    const editor = vscode.window.activeTextEditor;
    await treeDataProvider.refresh(editor?.document);
  });

  const cmdClearCache = vscode.commands.registerCommand('gitBlameBlame.clearCache', () => {
    clearCache();
    vscode.window.showInformationMessage('Git Blame Blame: Cache cleared.');
  });

  // ── Auto-update on cursor move ──

  let statusBarDebounce: ReturnType<typeof setTimeout> | undefined;
  const onCursorChange = vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
    if (statusBarDebounce) clearTimeout(statusBarDebounce);
    statusBarDebounce = setTimeout(() => {
      updateStatusBar(statusBar, e.textEditor);
    }, 200);
  });

  const onActiveEditorChange = vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
    updateStatusBar(statusBar, editor);
    if (editor && !editor.document.isUntitled) {
      treeDataProvider.refresh(editor.document);
    }
  });

  const onDocumentSave = vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
    blameCache.delete(doc.uri.fsPath);
    const editor = vscode.window.activeTextEditor;
    if (editor?.document === doc) {
      treeDataProvider.refresh(doc);
    }
  });

  // Initialize for current editor
  if (vscode.window.activeTextEditor) {
    updateStatusBar(statusBar, vscode.window.activeTextEditor);
    treeDataProvider.refresh(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    outputChannel,
    statusBar,
    treeView,
    hoverProvider,
    cmdBlameLine,
    cmdBlameFile,
    cmdRefresh,
    cmdClearCache,
    onCursorChange,
    onActiveEditorChange,
    onDocumentSave
  );
}

export function deactivate(): void {
  clearCache();
}
