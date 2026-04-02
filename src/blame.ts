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

  // The output may contain diff lines before the commit line, filter to the first format line
  const lines2 = output.split('\n');
  // The commit line matches: <40-char sha> <email> <name> <date> <subject>
  const commitLine = lines2.find((l) => /^[0-9a-f]{40}\s/.test(l));

  if (!commitLine) {
    throw new Error(`Could not parse git log output for ${filePath}:${line}`);
  }

  // Parse: sha email name date ...rest(subject)
  // Format: %H %ae %an %ad %s
  // Note: name and subject can have spaces, but date is YYYY-MM-DD
  const parts = commitLine.split(' ');
  const sha = parts[0];
  const authorEmail = parts[1];

  // Find the date (format YYYY-MM-DD)
  const dateIdx = parts.findIndex((p, i) => i > 1 && /^\d{4}-\d{2}-\d{2}$/.test(p));
  if (dateIdx === -1) {
    throw new Error(`Could not parse date from git log output: ${commitLine}`);
  }

  const authorName = parts.slice(2, dateIdx).join(' ');
  const date = parts[dateIdx];
  const subject = parts.slice(dateIdx + 1).join(' ');

  return { sha, authorEmail, authorName, date, subject, lineContent };
}
