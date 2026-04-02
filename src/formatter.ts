import chalk from 'chalk';
import type { BlameResult, FileContribution } from './blame.js';
import type { PRInfo, Approver } from './github.js';
import type { TeamContributionRow } from './team.js';

export interface OutputData {
  file: string;
  line: number;
  blame: BlameResult;
  pr: PRInfo | null;
  approvals: Approver[];
}

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
