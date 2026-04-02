#!/usr/bin/env node
import { program } from 'commander';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Octokit } from '@octokit/rest';
import { blameFile, collectFileContributions } from './blame.js';
import { analyzeBusFactor } from './bus-factor.js';
import { getRepoInfo, getPRForCommit, getApprovals } from './github.js';
import {
  formatBusFactorReport,
  formatExportCsv,
  formatExportJson,
  formatOutput,
  formatJson,
  formatSinceReport,
  formatTeamReport,
} from './formatter.js';
import { aggregateTeamContributions, loadTeamFile } from './team.js';

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const packageVersion = JSON.parse(readFileSync(packageJsonPath, 'utf-8')).version as string;

program
  .name('git-blame-blame')
  .description('Find who approved the PR that introduced a buggy line of code')
  .version(packageVersion)
  .argument('<target>', 'File:line for GitHub blame lookup, or a tracked path for local reports')
  .option('-t, --token <token>', 'GitHub personal access token')
  .option('-r, --repo <owner/repo>', 'GitHub repository (auto-detected from git remote if omitted)')
  .option('--since <date>', 'Only show blame entries for code added or modified since this date')
  .option('--team <file>', 'Load a team roster JSON or CSV file and show a contribution distribution')
  .option('--bus-factor', 'Analyze file ownership concentration for a tracked file or directory path')
  .option('--export <format>', 'Export tracked-path blame analysis as csv or json')
  .option('--json', 'Output as JSON')
  .action(
    async (
      target: string,
      options: {
        token?: string;
        repo?: string;
        json?: boolean;
        since?: string;
        team?: string;
        busFactor?: boolean;
        export?: string;
      }
    ) => {
      const colonIdx = target.lastIndexOf(':');
      const lineStr = colonIdx === -1 ? '' : target.substring(colonIdx + 1);
      const line = Number.parseInt(lineStr, 10);
      const isFileLineTarget = colonIdx !== -1 && !Number.isNaN(line) && line >= 1;
      const exportFormat = options.export?.toLowerCase();
      const hasTrackedPathMode = Boolean(options.team || options.since || options.busFactor || exportFormat);

      if (exportFormat && exportFormat !== 'csv' && exportFormat !== 'json') {
        console.error('Error: --export must be one of: csv, json');
        process.exit(1);
      }

      if (hasTrackedPathMode) {
        if (options.json) {
          console.error('Error: --json is only supported for <file:line> lookups');
          process.exit(1);
        }

        const outputModeCount = [Boolean(options.team), Boolean(options.busFactor), Boolean(exportFormat)].filter(
          Boolean
        ).length;
        if (outputModeCount > 1) {
          console.error('Error: choose only one of --team, --bus-factor, or --export');
          process.exit(1);
        }

        if (isFileLineTarget) {
          console.error(
            'Error: --since, --team, --bus-factor, and --export expect a tracked file or directory path, not <file:line>'
          );
          process.exit(1);
        }

        let contributions;
        try {
          contributions = collectFileContributions(target, { since: options.since });
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }

        if (options.team) {
          try {
            const team = loadTeamFile(options.team);
            formatTeamReport(aggregateTeamContributions(contributions, team));
          } catch (err) {
            console.error(`Error: ${(err as Error).message}`);
            process.exit(1);
          }
          return;
        }

        if (options.busFactor) {
          formatBusFactorReport(analyzeBusFactor(contributions));
          return;
        }

        if (exportFormat === 'csv') {
          formatExportCsv(contributions);
          return;
        }

        if (exportFormat === 'json') {
          formatExportJson(contributions);
          return;
        }

        if (options.since) {
          formatSinceReport(contributions, options.since);
          return;
        }

        console.error('Error: a tracked path requires one of --since, --team, --bus-factor, or --export');
        return;
      }

      if (!isFileLineTarget) {
        console.error(
          'Error: argument must be in the format <file:line>, or use --since/--team with a tracked path'
        );
        process.exit(1);
      }

      const filePath = target.substring(0, colonIdx);

      // Get GitHub token
      const token = options.token ?? process.env.GITHUB_TOKEN;
      if (!token) {
        console.error(
          'Error: GitHub token is required. Set GITHUB_TOKEN env var or use --token flag.'
        );
        process.exit(1);
      }

      // Step 1: Get blame info
      let blame;
      try {
        blame = blameFile(filePath, line, options.since);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }

      // Step 2: Detect owner/repo
      let owner: string;
      let repo: string;

      if (options.repo) {
        const parts = options.repo.split('/');
        if (parts.length !== 2) {
          console.error('Error: --repo must be in the format owner/repo');
          process.exit(1);
        }
        owner = parts[0];
        repo = parts[1];
      } else {
        let remoteUrl: string;
        try {
          remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
        } catch {
          console.error('Error: could not determine git remote URL. Use --repo to specify manually.');
          process.exit(1);
        }

        try {
          const repoInfo = getRepoInfo(remoteUrl);
          owner = repoInfo.owner;
          repo = repoInfo.repo;
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      // Step 3: Init Octokit
      const octokit = new Octokit({ auth: token });

      // Step 4: Get PR for commit
      let pr;
      try {
        pr = await getPRForCommit(octokit, owner, repo, blame.sha);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }

      // Step 5: Get approvals
      let approvals: Awaited<ReturnType<typeof getApprovals>> = [];
      if (pr) {
        try {
          approvals = await getApprovals(octokit, owner, repo, pr.number);
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      // Step 6: Format and output
      const outputData = { file: filePath, line, blame, pr, approvals };

      if (options.json) {
        formatJson(outputData);
      } else {
        formatOutput(outputData);
      }
    }
  );

program.parse();
