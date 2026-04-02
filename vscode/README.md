# Git Blame Blame VS Code Extension

This folder contains a minimal VS Code extension scaffold for `git-blame-blame`.

## Prerequisites

- A built or installed `git-blame-blame` CLI
- A GitHub token provided through the `gitBlameBlame.githubToken` VS Code setting or the `GITHUB_TOKEN` environment variable

## Install

1. Open the `vscode/` folder in VS Code.
2. Run `pnpm install` or `npm install` inside `vscode/`.
3. Build the extension bundle with `npm run build`.
4. Press `F5` in VS Code to launch an Extension Development Host.

## Usage

1. Open a file inside a Git repository.
2. Place the cursor on the line you want to inspect.
3. Run `Git Blame Blame: Who Approved This Line?` from the editor context menu or Command Palette.
4. Review the result in the information message or the `Git Blame Blame` output channel.

## Notes

- The extension tries the configured `gitBlameBlame.cliPath` first.
- If no CLI path is configured, it looks for `../dist/index.js` in this repository.
- If that file does not exist, it falls back to `git-blame-blame` on your PATH.
