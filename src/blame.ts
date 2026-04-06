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

/**
 * Parses the output of `git log` for a single commit into a structured blame result.
 *
 * @param output - Raw stdout from a `git log --format` command containing one commit line.
 * @returns Parsed commit metadata excluding line content.
 * @throws {Error} If the output does not contain a recognisable 40-character SHA line.
 * @throws {Error} If a `YYYY-MM-DD` date cannot be located within the commit line.
 */
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

/**
 * Parses the porcelain output of `git blame --line-porcelain` into per-author line counts.
 *
 * Iterates every porcelain block, accumulates line counts keyed by author email, and
 * tracks the most-recent modification date for each author.
 *
 * @param output - Raw stdout from `git blame --line-porcelain`.
 * @returns Array of author contributions sorted descending by line count.
 * @throws {Error} If a content line (starting with `\t`) is encountered before an
 *   `author-mail` header has been seen.
 */
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

/**
 * Collects per-file, per-author line contributions for every git-tracked file under
 * `targetPath`, optionally filtered to changes made since a given date.
 *
 * When `options.since` is provided only files touched since that date are included, and
 * blame entries are filtered to authors who appear in the recent commit history for each
 * file.
 *
 * @param targetPath - File or directory path to analyse; passed directly to `git ls-files`.
 * @param options - Optional configuration.
 * @param options.since - ISO date string (e.g. `"2024-01-01"`); limits scope to recent changes.
 * @param options.exec - Override the shell executor (defaults to `execSync`); useful in tests.
 * @returns Flat array of file contributions sorted by file path then descending line count.
 * @throws {Error} If `targetPath` contains no git-tracked files.
 */
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

/**
 * Returns the blame information for a single line in a file.
 *
 * Reads the file from disk to capture the current line content, then runs
 * `git log -L` to find the most-recent commit that touched that line.
 *
 * @param filePath - Absolute or repo-relative path to the file.
 * @param line - 1-based line number to blame.
 * @param since - Optional ISO date string; restricts history to commits after this date.
 * @returns Full blame result including commit metadata and the raw line content.
 * @throws {Error} If the `git log` command fails to execute.
 * @throws {Error} If no git history is found for the given file and line.
 */
export function blameFile(filePath: string, line: number, since?: string): BlameResult {
  // Read the actual line content from the file
  const fileContent = readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n');
  const lineContent = lines[line - 1] ?? '';

  // Run git log to get commit info for the specific line
  const format = '%H %ae %an %ad %s';
  const gitCmd = since
    ? `git log --since=${shellQuote(since)} -L ${line},${line}:${filePath} --follow -1 --format="${format}" --date=short`
    : `git log -L ${line},${line}:${filePath} --follow -1 --format="${format}" --date=short`;

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
