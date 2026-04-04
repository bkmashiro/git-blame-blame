# Git Blame Blame — VSCode Extension

Hover over any line of code to instantly see who wrote it, which PR introduced it, who authored that PR, and who approved it. Also shows a per-file blame sidebar.

Supports **GitHub** and **GitLab** (including self-hosted).

## Features

### Hover blame info
Hover over any line to see a tooltip with:
- Commit SHA, message, author, and date
- PR number and title (linked)
- PR author
- Reviewers who approved the PR

### Sidebar blame details (SCM panel)
Open the **Blame Details** view in the Source Control sidebar to browse every unique commit in the current file. Expand any entry to see the full commit metadata and PR/approval info.

### Status bar
The status bar shows the commit for the current cursor line at a glance.

### Commands
| Command | Description |
|---|---|
| `Git Blame Blame: Who Approved This Line?` | Show full blame + PR info in the output panel |
| `Git Blame Blame: Show File Blame in Sidebar` | Refresh the sidebar blame tree |
| `Git Blame Blame: Refresh` | Clear cache and reload sidebar blame |
| `Git Blame Blame: Clear Cache` | Purge the in-memory PR cache |

## Setup

### GitHub
1. Create a personal access token at GitHub → Settings → Developer settings → Personal access tokens.
   Scopes needed: `repo` (for private repos) or `public_repo` (for public repos).
2. Add it to VS Code settings:
   ```json
   "gitBlameBlame.githubToken": "ghp_..."
   ```
   Or set the `GITHUB_TOKEN` environment variable.

### GitLab
1. Create a personal access token at GitLab → User Settings → Access Tokens.
   Scopes needed: `read_api`.
2. Add it to VS Code settings:
   ```json
   "gitBlameBlame.gitlabToken": "glpat-..."
   ```
   Or set the `GITLAB_TOKEN` environment variable.

For self-hosted GitLab, also set:
```json
"gitBlameBlame.gitlabUrl": "https://gitlab.your-company.com"
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `gitBlameBlame.githubToken` | `""` | GitHub personal access token |
| `gitBlameBlame.gitlabToken` | `""` | GitLab personal access token |
| `gitBlameBlame.gitlabUrl` | `"https://gitlab.com"` | GitLab instance URL |
| `gitBlameBlame.enableHover` | `true` | Show blame tooltip on hover |
| `gitBlameBlame.hoverDelay` | `300` | Hover delay in ms before fetching PR info |
| `gitBlameBlame.cliPath` | `""` | Path to the `git-blame-blame` CLI (unused by this extension) |

## Building from source

```bash
cd vscode-extension
npm install
npm run build
```

Press **F5** in VS Code to launch the Extension Development Host.

## How it works

The extension runs `git blame --porcelain` locally (no CLI needed), then queries the GitHub or GitLab API to find the PR associated with each commit and fetch its reviewers.

The remote URL of the `origin` remote is parsed to automatically detect whether the repo is on GitHub or GitLab.

PR results are cached in memory for the lifetime of the VS Code session. Use **Clear Cache** after force-pushes or rebase operations.
