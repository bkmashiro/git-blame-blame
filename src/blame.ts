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
 * Parses a single commit entry from `git log --format="%H %ae %an %ad %s" --date=short` output.
 *
 * The expected format for the commit line is:
 *   `<40-char sha> <authorEmail> <authorName...> <YYYY-MM-DD> <subject...>`
 *
 * The function scans all space-delimited tokens for the first token after index 1 that matches
 * `YYYY-MM-DD`. Everything between the email and the date is treated as the author name;
 * everything after the date is treated as the subject.
 *
 * **Known limitation**: if an author's name contains a date-like substring (e.g. "Dev 2024-01-01
 * User"), the heuristic will misidentify that token as the date boundary, truncating the real
 * author name and producing a wrong subject.
 *
 * @param output - Raw stdout from `git log`, which may contain diff hunk headers and other lines
 *   before the commit line. Non-commit lines are skipped.
 * @returns Parsed commit metadata without the source line content.
 * @throws {Error} If no 40-hex-char commit line is found, or if no date token is present.
 */
export function parseGitLogOutput(output: string): Omit<BlameResult, 'lineContent'> {
  const lines = output.split('\n');
  const commitLine = lines.find((line) => /^[0-9a-f]{7,40}\s/.test(line));

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

/**
 * Extracts the line number from a single line of `git blame` porcelain output.
 *
 * @param output - A single annotated blame line, e.g. `"abc123 (Author 2024-01-01  42) code"`.
 * @returns The 1-based line number parsed from the blame annotation.
 * @throws {Error} If the expected line-number pattern is not found in the output.
 */
export function extractLineNumberFromBlameOutput(output: string): number {
  const match = output.match(/\s(\d+)\)\s/);

  if (!match) {
    throw new Error('Could not parse line number from blame output');
  }

  return Number.parseInt(match[1], 10);
}

/**
 * Parses the tab-delimited output of `git log --format="%ae\t%an"` into author objects.
 *
 * @param output - Raw stdout where each line is `"<email>\t<name>"`.
 * @returns Array of `{ email, name }` objects; empty lines are skipped.
 * @throws {Error} If any non-empty line is missing the expected `email\tname` format.
 */
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
 * Parses the output of `git blame --line-porcelain` into per-author contribution totals.
 *
 * The porcelain format emits a variable-length block per blamed line:
 * ```
 * <sha> <orig-line> <final-line> [<num-lines>]
 * author <name>
 * author-mail <<email>>
 * author-time <unix-timestamp>
 * ... (other fields) ...
 * \t<line content>
 * ```
 * The parser accumulates `author`, `author-mail`, and `author-time` fields as it encounters them,
 * then commits the accumulated state to a contribution record when it sees the tab-prefixed
 * content line. All other lines (the sha header, `committer-*`, `summary`, etc.) are skipped.
 *
 * `author-time` is a Unix timestamp in seconds; it is converted to a `YYYY-MM-DD` ISO date.
 * `author-mail` may be wrapped in angle brackets (`<email@host>`); they are stripped.
 *
 * Results are sorted descending by line count. When the same email appears more than once,
 * line counts are summed and `lastModified` is kept as the maximum observed date.
 *
 * **Edge cases**:
 * - Lines attributed to "Not Committed Yet" (e.g. when `--since` filters out all commits)
 *   are included under that synthetic author email.
 * - An empty `output` string produces an empty array without throwing.
 * - If a tab line is reached before any `author-mail` line has been seen, an error is thrown.
 *
 * @param output - Raw stdout from `git blame --line-porcelain`.
 * @returns Contributions sorted by line count descending.
 * @throws {Error} If a content line is encountered before an author-mail header.
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

/**
 * Wraps `value` in single quotes for safe shell interpolation.
 *
 * Any embedded single quotes are escaped using the POSIX idiom `'\''`
 * (close quote, escaped literal quote, reopen quote), which works in all
 * POSIX-compatible shells and does not rely on `$'...'` syntax.
 *
 * **Limitation**: the result is not safe for use inside double-quoted shell
 * strings or as a bare value passed to `exec`-family calls that accept arrays.
 * It is intended solely for constructing single-argument tokens in
 * shell-parsed command strings.
 *
 * @param value - The raw string to quote (e.g. a file path or git ref).
 * @returns A shell-safe single-quoted string.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Returns the list of files tracked by git under `targetPath`.
 *
 * Runs `git ls-files -- <targetPath>` and splits the output on newlines. Empty
 * lines (including a trailing newline) are filtered out.
 *
 * **Silently excludes**:
 * - Untracked files (not yet staged or committed).
 * - Files ignored by `.gitignore`.
 * - Binary files — `git ls-files` lists them but downstream `git blame` calls
 *   will return empty output for them; those files are then skipped in
 *   `collectFileContributions`.
 * - Deleted files that have been removed from the index.
 *
 * @param targetPath - A path or glob pattern passed directly to `git ls-files`.
 *   If the path does not exist or matches nothing, an empty array is returned.
 * @param exec - Injected command runner (defaults to `execSync` in callers);
 *   receives the full shell command string and returns stdout.
 * @returns Relative file paths as reported by git, one per line.
 */
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
 * Collects per-author line contributions for all git-tracked files under `targetPath`.
 *
 * Runs `git ls-files` to enumerate files, then `git blame --line-porcelain` on each.
 * When `options.since` is provided, results are filtered to authors who touched the
 * file within that window, and each entry is tagged as `'added'` or `'modified'`.
 *
 * @param targetPath - File or directory path to analyse (passed to `git ls-files`).
 * @param options - Optional settings: `since` (date string for `--since`) and `exec`
 *   (custom command executor, defaults to `execSync`).
 * @returns Array of `FileContribution` records sorted by file path then descending line count.
 * @throws {Error} If no tracked files are found under `targetPath`.
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
 * Returns blame information for a single line in a file, including the line's content.
 *
 * Reads the file from disk to capture the current line content, then runs
 * `git log -L <line>,<line>:<file>` to find the most recent commit that touched it.
 *
 * @param filePath - Absolute or repo-relative path to the source file.
 * @param line - 1-based line number to blame.
 * @param since - Optional ISO date string passed as `--since` to limit the log range.
 * @returns `BlameResult` containing commit SHA, author, date, subject, and the line content.
 * @throws {Error} If `git log` exits with a non-zero status (e.g. git is not installed,
 *   or the file is not in a git repository).
 * @throws {Error} If no git history is found for the given file/line (e.g. untracked file
 *   or line outside the `--since` window).
 * @throws {Error} If the git log output cannot be parsed by `parseGitLogOutput`.
 */
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
