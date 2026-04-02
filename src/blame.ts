import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface BlameResult {
  sha: string;
  authorEmail: string;
  authorName: string;
  date: string;
  subject: string;
  lineContent: string;
}

export function parseGitLogOutput(output: string): Omit<BlameResult, 'lineContent'> {
  const lines = output.split('\n');
  const commitLine = lines.find((line) => /^[0-9a-f]{40}\s/.test(line));

  if (!commitLine) {
    throw new Error('Could not parse git log output');
  }

  const parts = commitLine.split(' ');
  const sha = parts[0];
  const authorEmail = parts[1];
  const dateIdx = parts.findIndex((part, index) => index > 1 && /^\d{4}-\d{2}-\d{2}$/.test(part));

  if (dateIdx === -1) {
    throw new Error(`Could not parse date from git log output: ${commitLine}`);
  }

  return {
    sha,
    authorEmail,
    authorName: parts.slice(2, dateIdx).join(' '),
    date: parts[dateIdx],
    subject: parts.slice(dateIdx + 1).join(' '),
  };
}

export function extractLineNumberFromBlameOutput(output: string): number {
  const match = output.match(/\s(\d+)\)\s/);

  if (!match) {
    throw new Error('Could not parse line number from blame output');
  }

  return Number.parseInt(match[1], 10);
}

export function blameFile(filePath: string, line: number): BlameResult {
  // Read the actual line content from the file
  const fileContent = readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n');
  const lineContent = lines[line - 1] ?? '';

  // Run git log to get commit info for the specific line
  const format = '%H %ae %an %ad %s';
  const gitCmd = `git log -L ${line},${line}:${filePath} --follow -1 --format="${format}" --date=short`;

  let output: string;
  try {
    output = execSync(gitCmd, { encoding: 'utf-8' }).trim();
  } catch (err) {
    throw new Error(`Failed to run git log: ${(err as Error).message}`);
  }

  if (!output) {
    throw new Error(`No git history found for ${filePath}:${line}`);
  }

  return { ...parseGitLogOutput(output), lineContent };
}
