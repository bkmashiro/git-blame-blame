import chalk from 'chalk';
import type { BlameResult } from './blame.js';
import type { PRInfo, Approver } from './github.js';

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
      console.log(`  ${chalk.yellow('Approved:')} ${chalk.dim('(no approvals found)')}`);
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
