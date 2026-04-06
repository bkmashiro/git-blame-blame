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

export interface AuthorContribution {
  authorEmail: string;
  authorName: string;
  lines: number;
  lastModified: string;
}

export interface FileContribution extends AuthorContribution {
  filePath: string;
  changeType: 'added' | 'modified';
}

export interface ContributionReportOptions {
  since?: string;
  exec?: (command: string) => string;
}

interface RecentAuthor {
  email: string;
  name: string;
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

export function parseRecentAuthorsOutput(output: string): RecentAuthor[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, name] = line.split('\t');
      if (!email || !name) {
        throw new Error(`Could not parse recent author output: ${line}`);
      }

      return { email, name };
    });
}

export function parseBlamePorcelainOutput(output: string): AuthorContribution[] {
  const contributions = new Map<string, AuthorContribution>();
  let currentAuthorName = '';
  let currentAuthorEmail = '';
  let currentAuthorDate = '';

  for (const line of output.split('\n')) {
    if (line.startsWith('author ')) {
      currentAuthorName = line.slice('author '.length);
      continue;
    }

    if (line.startsWith('author-mail ')) {
      currentAuthorEmail = line.slice('author-mail '.length).replace(/^<|>$/g, '');
      continue;
    }

    if (line.startsWith('author-time ')) {
      currentAuthorDate = new Date(Number.parseInt(line.slice('author-time '.length), 10) * 1000)
        .toISOString()
        .slice(0, 10);
      continue;
    }

    if (!line.startsWith('\t')) {
      continue;
    }

    if (!currentAuthorEmail) {
      throw new Error('Could not parse author email from git blame output');
    }

    const existing = contributions.get(currentAuthorEmail);
    if (existing) {
      existing.lines += 1;
      if (!existing.authorName && currentAuthorName) {
        existing.authorName = currentAuthorName;
      }
      if (currentAuthorDate && currentAuthorDate > existing.lastModified) {
        existing.lastModified = currentAuthorDate;
      }
      continue;
    }

    contributions.set(currentAuthorEmail, {
      authorEmail: currentAuthorEmail,
      authorName: currentAuthorName,
      lines: 1,
      lastModified: currentAuthorDate,
    });
  }

  return Array.from(contributions.values()).sort((left, right) => right.lines - left.lines);
}

function runGit(command: string): string {
  return execSync(command, { encoding: 'utf-8' }).trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getTrackedFiles(targetPath: string, exec: (command: string) => string): string[] {
  const output = exec(`git ls-files -- ${shellQuote(targetPath)}`);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function getRecentAuthors(
  filePath: string,
  since: string,
  exec: (command: string) => string
): RecentAuthor[] {
  const format = '%ae\t%an';
  const output = exec(
    `git log --since=${shellQuote(since)} --diff-filter=AM --format=${shellQuote(format)} -- ${shellQuote(filePath)}`
  );

  if (!output) {
    return [];
  }

  const deduped = new Map<string, RecentAuthor>();
  for (const author of parseRecentAuthorsOutput(output)) {
    deduped.set(author.email, author);
  }
  return Array.from(deduped.values());
}

function getChangeType(filePath: string, since: string, exec: (command: string) => string): 'added' | 'modified' {
  const output = exec(
    `git log --since=${shellQuote(since)} --diff-filter=A --format=%H -1 -- ${shellQuote(filePath)}`
  );
  return output ? 'added' : 'modified';
}

export function collectFileContributions(
  targetPath: string,
  options: ContributionReportOptions = {}
): FileContribution[] {
  const exec = options.exec ?? runGit;
  const trackedFiles = getTrackedFiles(targetPath, exec);

  if (trackedFiles.length === 0) {
    throw new Error(`No tracked files found for ${targetPath}`);
  }

  const results: FileContribution[] = [];

  for (const filePath of trackedFiles) {
    const blameCommand = options.since
      ? `git blame --line-porcelain --since=${shellQuote(options.since)} -- ${shellQuote(filePath)}`
      : `git blame --line-porcelain -- ${shellQuote(filePath)}`;
    const blameOutput = exec(blameCommand);

    if (!blameOutput) {
      continue;
    }

    let contributions = parseBlamePorcelainOutput(blameOutput);
    let changeType: 'added' | 'modified' = 'modified';

    if (options.since) {
      const recentAuthors = getRecentAuthors(filePath, options.since, exec);
      if (recentAuthors.length === 0) {
        continue;
      }

      const recentEmails = new Set(recentAuthors.map((author) => author.email));
      contributions = contributions.filter((contribution) => recentEmails.has(contribution.authorEmail));
      changeType = getChangeType(filePath, options.since, exec);
    }

    for (const contribution of contributions) {
      results.push({
        filePath,
        authorEmail: contribution.authorEmail,
        authorName: contribution.authorName,
        lines: contribution.lines,
        lastModified: contribution.lastModified,
        changeType,
      });
    }
  }

  return results.sort((left, right) => {
    if (left.filePath === right.filePath) {
      return right.lines - left.lines;
    }
    return left.filePath.localeCompare(right.filePath);
  });
}

export function blameFile(filePath: string, line: number, since?: string): BlameResult {
  // Read the actual line content from the file
  const fileContent = readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n');
  const lineContent = lines[line - 1] ?? '';

  // Run git log to get commit info for the specific line
  const format = '%H %ae %an %ad %s';
  const lineRange = shellQuote(`${line},${line}:${filePath}`);
  const gitCmd = since
    ? `git log --since=${shellQuote(since)} -L ${lineRange} --follow -1 --format="${format}" --date=short`
    : `git log -L ${lineRange} --follow -1 --format="${format}" --date=short`;

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
