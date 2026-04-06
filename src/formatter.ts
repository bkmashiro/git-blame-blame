import chalk from 'chalk';
import type { BlameResult, FileContribution } from './blame.js';
import { BUS_FACTOR_THRESHOLD_PERCENT, type BusFactorReport, type FileBusFactor } from './bus-factor.js';
import type { PRInfo, Approver } from './types.js';
import type { TeamContributionRow } from './team.js';

/** All data needed to render a single-line blame result. */
export interface OutputData {
  /** Path to the file being blamed. */
  file: string;
  /** 1-based line number that was blamed. */
  line: number;
  /** Blame metadata returned for this line. */
  blame: BlameResult;
  /** Associated pull request, if one was found. */
  pr: PRInfo | null;
  /** Reviewers who approved the associated pull request. */
  approvals: Approver[];
}

interface ExportAuthorRow {
  email: string;
  name: string;
  lines: number;
  percent: number;
  lastModified: string;
}

interface ExportFileRow {
  file: string;
  authors: ExportAuthorRow[];
  busFactor: number;
}

/**
 * Prints human-readable blame output for a single file line to stdout.
 *
 * Displays the file/line header, commit details (SHA, author, date, subject),
 * and associated PR information including approvers.
 *
 * @param data - Combined blame, PR, and approver data for one file line.
 */
export function formatOutput(data: OutputData): void {
  const { file, line, blame, pr, approvals } = data;

  console.log();
  console.log(chalk.bold(`${file}:${line}`));
  console.log(chalk.dim(`  Line: "${blame.lineContent.trim()}"`));
  console.log();

  const shortSha = blame.sha.substring(0, 7);
  console.log(
    `  ${chalk.yellow('Commit:')}   ${chalk.cyan(shortSha)} by ${chalk.bold(blame.authorName)} ${chalk.dim(`<${blame.authorEmail}>`)} ${chalk.dim(`(${blame.date})`)}`
  );
  console.log(`  ${chalk.dim('Subject:')}  ${blame.subject}`);
  console.log();

  if (pr) {
    console.log(`  ${chalk.yellow(`PR #${pr.number}:`)}  ${chalk.bold(pr.title)}`);
    console.log(`  ${chalk.dim('URL:')}      ${chalk.blue(pr.html_url)}`);
    console.log();

    if (approvals.length === 0) {
      console.log(`  ${chalk.yellow('Approved:')} ${chalk.dim('No approvals found')}`);
    } else {
      const approverList = approvals.map((a) => {
        if (a.email) {
          return `${chalk.green(a.login)} ${chalk.dim(`<${a.email}>`)}`;
        }
        return chalk.green(a.login);
      });
      console.log(`  ${chalk.yellow('Approved:')} ${approverList.join(', ')}`);
    }
  } else {
    console.log(`  ${chalk.dim('PR:')}       ${chalk.dim('(no associated PR found)')}`);
  }

  console.log();
}

/**
 * Prints blame output as a JSON object to stdout.
 *
 * The JSON includes file, line, lineContent, a commit object, PR details (or null),
 * and an array of approver logins/emails.
 *
 * @param data - Combined blame, PR, and approver data for one file line.
 */
export function formatJson(data: OutputData): void {
  const output = {
    file: data.file,
    line: data.line,
    lineContent: data.blame.lineContent.trim(),
    commit: {
      sha: data.blame.sha,
      shortSha: data.blame.sha.substring(0, 7),
      authorName: data.blame.authorName,
      authorEmail: data.blame.authorEmail,
      date: data.blame.date,
      subject: data.blame.subject,
    },
    pr: data.pr
      ? {
          number: data.pr.number,
          title: data.pr.title,
          url: data.pr.html_url,
        }
      : null,
    approvals: data.approvals.map((a) => ({
      login: a.login,
      email: a.email ?? null,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Prints a tabular report of the top contributor per file since a given date.
 *
 * For each file, the author with the most lines in the window is shown alongside
 * the line count and whether the file was added or modified since `since`.
 *
 * @param contributions - Array of file contributions, typically from `collectFileContributions`.
 * @param since - Human-readable date string used in the header line (e.g. `"1 week ago"`).
 */
export function formatSinceReport(contributions: FileContribution[], since: string): void {
  const topByFile = new Map<string, FileContribution>();

  for (const contribution of contributions) {
    const existing = topByFile.get(contribution.filePath);
    if (!existing || contribution.lines > existing.lines) {
      topByFile.set(contribution.filePath, contribution);
    }
  }

  const rows = Array.from(topByFile.values()).sort((left, right) => right.lines - left.lines);

  console.log(`Showing blame for changes since ${since}...`);
  console.log();

  for (const row of rows) {
    const linesLabel = `${row.lines.toLocaleString()} lines`;
    console.log(
      `${row.filePath.padEnd(20)} ${row.authorName.padEnd(12)} ${linesLabel.padEnd(10)} (${row.changeType} since ${since})`
    );
  }

  if (rows.length === 0) {
    console.log('No matching blame entries found.');
  }
}

/**
 * Prints a formatted team contribution report to stdout.
 *
 * Renders a header row followed by one line per team member showing their name/label,
 * total lines, file count, percentage share, and an ASCII bar chart segment.
 *
 * @param rows - Contribution rows from the team analysis, sorted as desired by the caller.
 */
export function formatTeamReport(rows: TeamContributionRow[]): void {
  console.log('Team contribution report:');
  console.log();
  console.log('Member          Lines   Files   %');

  for (const row of rows) {
    console.log(
      `${row.label.padEnd(15)} ${row.lines.toLocaleString().padStart(6)}  ${String(row.files).padEnd(5)} ${String(row.percent).padStart(3)}%  ${row.bar}`
    );
  }

  if (rows.length === 0) {
    console.log('No matching contributions found.');
  }
}

function toExportRows(contributions: FileContribution[]): ExportFileRow[] {
  const grouped = new Map<string, FileContribution[]>();

  for (const contribution of contributions) {
    const rows = grouped.get(contribution.filePath) ?? [];
    rows.push(contribution);
    grouped.set(contribution.filePath, rows);
  }

  return Array.from(grouped.entries())
    .map(([file, rows]) => {
      const totalLines = rows.reduce((sum, row) => sum + row.lines, 0);
      const authors = rows
        .map((row) => ({
          email: row.authorEmail,
          name: row.authorName,
          lines: row.lines,
          percent: totalLines === 0 ? 0 : Math.round((row.lines / totalLines) * 100),
          lastModified: row.lastModified,
        }))
        .sort((left, right) => right.lines - left.lines || left.email.localeCompare(right.email));

      return {
        file,
        authors,
        busFactor: authors.filter((author) => author.percent > BUS_FACTOR_THRESHOLD_PERCENT).length,
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function formatAuthorShare(author: { name: string; lines: number; percent: number }): string {
  return `${author.name} ${author.percent}%`;
}

function formatMaintainers(file: FileBusFactor): string {
  if (file.maintainers.length === 0) {
    return 'no maintainers';
  }

  if (file.busFactor === 1) {
    const [owner] = file.maintainers;
    return `only ${owner.name} maintains this (${file.totalLines} lines)`;
  }

  return file.maintainers.map(formatAuthorShare).join(file.busFactor === 2 ? ' + ' : ', ');
}

/**
 * Prints a bus factor analysis report to stdout, grouped by risk level.
 *
 * Displays three sections — Critical (bus factor = 1), At Risk (= 2), Healthy (≥ 3) —
 * listing each file with its maintainers. Prints an overall repo bus factor and an
 * optional recommendation at the end.
 *
 * @param report - Bus factor report produced by the bus-factor analyser.
 */
export function formatBusFactorReport(report: BusFactorReport): void {
  console.log('Bus Factor Analysis:');
  console.log();

  console.log(`${chalk.red('Critical')} ${chalk.dim('(bus factor = 1):')}`);
  if (report.criticalFiles.length === 0) {
    console.log('  None');
  } else {
    for (const file of report.criticalFiles) {
      console.log(`  ${file.filePath.padEnd(24)} ${formatMaintainers(file)}`);
    }
  }
  console.log();

  console.log(`${chalk.yellow('At Risk')} ${chalk.dim('(bus factor = 2):')}`);
  if (report.atRiskFiles.length === 0) {
    console.log('  None');
  } else {
    for (const file of report.atRiskFiles) {
      console.log(`  ${file.filePath.padEnd(24)} ${formatMaintainers(file)}`);
    }
  }
  console.log();

  console.log(`${chalk.green('Healthy')} ${chalk.dim('(bus factor >= 3):')}`);
  if (report.healthyFiles.length === 0) {
    console.log('  None');
  } else {
    for (const file of report.healthyFiles) {
      console.log(`  ${file.filePath.padEnd(24)} ${formatMaintainers(file)}`);
    }
  }
  console.log();

  console.log(`Overall repo bus factor: ${report.overallBusFactor}`);
  if (report.recommendation) {
    console.log(`Recommendation: ${report.recommendation}`);
  }
}

/**
 * Serialises file contributions as a JSON array and prints it to stdout.
 *
 * Each entry contains the file path, a list of authors with line counts and percentages,
 * and the computed bus factor for that file.
 *
 * @param contributions - Array of file contributions, typically from `collectFileContributions`.
 */
export function formatExportJson(contributions: FileContribution[]): void {
  console.log(JSON.stringify(toExportRows(contributions), null, 2));
}

function csvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Serialises file contributions as CSV and prints it to stdout.
 *
 * Columns: `file`, `author` (email), `lines`, `percent`, `lastModified`.
 * Each author row for a file is emitted on its own line.
 *
 * @param contributions - Array of file contributions, typically from `collectFileContributions`.
 */
export function formatExportCsv(contributions: FileContribution[]): void {
  const lines = ['file,author,lines,percent,lastModified'];

  for (const row of toExportRows(contributions)) {
    for (const author of row.authors) {
      lines.push([csvField(row.file), csvField(author.email), csvField(String(author.lines)), csvField(String(author.percent)), csvField(author.lastModified)].join(','));
    }
  }

  console.log(lines.join('\n'));
}
