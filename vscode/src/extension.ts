import * as vscode from 'vscode';
import * as path from 'node:path';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Git Blame Blame');

  const command = vscode.commands.registerCommand('gitBlameBlame.blameLine', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Git Blame Blame requires an active editor.');
      return;
    }

    if (editor.document.isUntitled) {
      vscode.window.showErrorMessage('Save the file before running Git Blame Blame.');
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        'Open the file inside a workspace folder before running Git Blame Blame.'
      );
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const line = editor.selection.active.line + 1;
    const config = vscode.workspace.getConfiguration('gitBlameBlame');
    const token = config.get<string>('githubToken') || process.env.GITHUB_TOKEN;

    if (!token) {
      vscode.window.showErrorMessage(
        'Set gitBlameBlame.githubToken in VS Code settings or GITHUB_TOKEN in your environment.'
      );
      return;
    }

    const cli = await resolveCliPath(config, context);
    const cwd = workspaceFolder.uri.fsPath;
    const relativeFile = path.relative(cwd, filePath) || path.basename(filePath);
    const target = `${relativeFile}:${line}`;

    outputChannel.clear();
    outputChannel.appendLine(`Running: ${cli.command} ${cli.args.join(' ')}`);
    outputChannel.appendLine(`Workspace: ${cwd}`);

    try {
      const { stdout, stderr } = await execFileAsync(cli.command, [...cli.args, target], {
        cwd,
        env: {
          ...process.env,
          GITHUB_TOKEN: token
        }
      });

      if (stderr.trim()) {
        outputChannel.appendLine(stderr.trim());
      }

      const result = stdout.trim();
      outputChannel.appendLine(result || 'No output returned.');
      outputChannel.show(true);

      if (result) {
        vscode.window.showInformationMessage(result);
      } else {
        vscode.window.showInformationMessage('Git Blame Blame completed. See output channel.');
      }
    } catch (error) {
      const details = formatExecError(error);
      outputChannel.appendLine(details);
      outputChannel.show(true);
      vscode.window.showErrorMessage('Git Blame Blame failed. See output channel for details.');
    }
  });

  context.subscriptions.push(command, outputChannel);
}

async function resolveCliPath(
  config: vscode.WorkspaceConfiguration,
  context: vscode.ExtensionContext
): Promise<{ command: string; args: string[] }> {
  const configuredCliPath = config.get<string>('cliPath');
  if (configuredCliPath) {
    return buildCliCommand(configuredCliPath);
  }

  const repoRoot = path.resolve(context.extensionPath, '..');
  const builtCliPath = path.join(repoRoot, 'dist', 'index.js');

  if (await fileExists(builtCliPath)) {
    return {
      command: process.execPath,
      args: [builtCliPath]
    };
  }

  return {
    command: 'git-blame-blame',
    args: []
  };
}

function buildCliCommand(cliPath: string): { command: string; args: string[] } {
  if (cliPath.endsWith('.js') || cliPath.endsWith('.cjs') || cliPath.endsWith('.mjs')) {
    return {
      command: process.execPath,
      args: [cliPath]
    };
  }

  return {
    command: cliPath,
    args: []
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function formatExecError(error: unknown): string {
  if (error && typeof error === 'object') {
    const execError = error as { message?: string; stdout?: string; stderr?: string };
    return [
      execError.message?.trim(),
      execError.stderr?.trim(),
      execError.stdout?.trim()
    ]
      .filter(Boolean)
      .join('\n');
  }

  return String(error);
}
