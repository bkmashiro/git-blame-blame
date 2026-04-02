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

- A GitHub personal access token with `repo` scope
- Set the `GITHUB_TOKEN` environment variable (or use the `--token` flag)

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

## Usage

```bash
git-blame-blame <file:line> [options]
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

### Options

| Flag | Description |
|------|-------------|
| `-t, --token <token>` | GitHub personal access token (overrides `GITHUB_TOKEN`) |
| `-r, --repo <owner/repo>` | GitHub repository (auto-detected from git remote if omitted) |
| `--json` | Output results as JSON |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

## How it works

`git-blame-blame` runs a 4-step pipeline:

1. **git blame** — Runs `git log -L` on the specified file and line to identify the commit that introduced that line of code.
2. **Find commit** — Looks up the commit SHA in your repository to get author info, date, and commit message.
3. **Find PR** — Queries the GitHub API to find which pull request contains that commit.
4. **Get approvals** — Fetches all reviews for that PR and returns the list of approvers.

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
