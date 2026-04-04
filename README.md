[![npm](https://img.shields.io/npm/v/git-blame-blame)](https://www.npmjs.com/package/git-blame-blame) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# git-blame-blame

Find who approved the PR that introduced a buggy line of code.

## Description

`git-blame-blame` goes one step further than `git blame`. It not only identifies the commit that introduced a line of code, but also finds the pull request associated with that commit and lists everyone who approved it.

## Install

```bash
npm install -g git-blame-blame
```

## Requirements

- A GitHub or GitLab personal access token
- Set the appropriate environment variable (or use the `--token` flag)

```bash
# GitHub
export GITHUB_TOKEN=ghp_your_token_here

# GitLab (gitlab.com)
export GITLAB_TOKEN=glpat_your_token_here

# Self-hosted GitLab
export GITLAB_HOST=https://gitlab.mycompany.com
export GITLAB_TOKEN=glpat_your_token_here
```

The provider (GitHub vs GitLab) is auto-detected from the git remote URL. No flags needed.

## Usage

```bash
git-blame-blame <file:line> [options]
git-blame-blame <tracked-path> --bus-factor
git-blame-blame <tracked-path> --export csv
```

### Examples

```
$ git-blame-blame src/auth.js:42
src/auth.js:42
  Line: "return token === undefined ? guest : user"

  Commit:   abc1234 by alice <alice@co.com> (2024-03-15)
  Subject:  fix: handle unauthenticated users

  PR #234:  "fix: handle unauthenticated users"
  URL:      https://github.com/org/repo/pull/234

  Approved: bob, carol
```

```
$ git-blame-blame src/auth.js:42 --json
{
  "file": "src/auth.js",
  "line": 42,
  "lineContent": "return token === undefined ? guest : user",
  "commit": {
    "sha": "abc1234...",
    "shortSha": "abc1234",
    "authorName": "alice",
    "authorEmail": "alice@co.com",
    "date": "2024-03-15",
    "subject": "fix: handle unauthenticated users"
  },
  "pr": {
    "number": 234,
    "title": "fix: handle unauthenticated users",
    "url": "https://github.com/org/repo/pull/234"
  },
  "approvals": [
    { "login": "bob", "email": null },
    { "login": "carol", "email": null }
  ]
}
```

```
$ git-blame-blame src/ --bus-factor
Bus Factor Analysis:

Critical (bus factor = 1):
  src/core/engine.ts      only alice maintains this (847 lines)

At Risk (bus factor = 2):
  src/api/routes.ts       carol 60% + alice 40%

Healthy (bus factor >= 3):
  src/utils/helpers.ts    alice 40%, bob 35%, carol 25%

Overall repo bus factor: 1
Recommendation: alice is the single point of failure for 1 file
```

```
$ git-blame-blame src/ --export csv > blame-report.csv
$ git-blame-blame src/ --export json > blame-report.json
```

### Options

| Flag | Description |
|------|-------------|
| `-t, --token <token>` | GitHub or GitLab personal access token (overrides `GITHUB_TOKEN` / `GITLAB_TOKEN`) |
| `-r, --repo <owner/repo>` | GitHub repository or GitLab project path (auto-detected from git remote if omitted) |
| `--json` | Output results as JSON |
| `--since <date>` | Limit tracked-path analysis to code added or modified since this date |
| `--team <file>` | Show tracked-path contributions grouped by a team roster |
| `--bus-factor` | Show per-file bus factor using contributors with more than 20% of blamed lines |
| `--export <csv|json>` | Export tracked-path blame analysis as structured data |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

## GitLab

`git-blame-blame` auto-detects GitLab repos from the git remote URL. For self-hosted instances, set `GITLAB_HOST`:

```bash
# Self-hosted GitLab
export GITLAB_HOST=https://gitlab.mycompany.com
export GITLAB_TOKEN=glpat_your_token_here

git-blame-blame src/auth.js:42
```

The tool uses the GitLab MR Approvals API (`/api/v4/projects/:id/merge_requests/:iid/approvals`) to find approvers.

## How it works

`git-blame-blame` runs a 4-step pipeline:

1. **git blame** — Runs `git log -L` on the specified file and line to identify the commit that introduced that line of code.
2. **Find commit** — Looks up the commit SHA in your repository to get author info, date, and commit message.
3. **Find PR/MR** — Queries the GitHub or GitLab API to find which pull/merge request contains that commit.
4. **Get approvals** — Fetches all reviews/approvals for that PR/MR and returns the list of approvers.

## Development

```bash
# Clone and install
git clone https://github.com/yourusername/git-blame-blame
cd git-blame-blame
pnpm install

# Run in dev mode
pnpm dev src/auth.js:42

# Build
pnpm build
```

## VS Code Extension

A minimal VS Code extension scaffold lives in [`vscode/`](./vscode/).

See [`vscode/README.md`](./vscode/README.md) for setup and usage instructions.

## License

MIT
