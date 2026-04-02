#!/usr/bin/env node
import { program } from 'commander';
import { execSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import { blameFile } from './blame.js';
import { getRepoInfo, getPRForCommit, getApprovals } from './github.js';
import { formatOutput, formatJson } from './formatter.js';

program
  .name('git-blame-blame')
  .description('Find who approved the PR that introduced a buggy line of code')
  .version('0.1.0')
  .argument('<file:line>', 'File and line number to blame (e.g. src/auth.js:42)')
  .option('-t, --token <token>', 'GitHub personal access token')
  .option('-r, --repo <owner/repo>', 'GitHub repository (auto-detected from git remote if omitted)')
  .option('--json', 'Output as JSON')
  .action(async (fileArg: string, options: { token?: string; repo?: string; json?: boolean }) => {
    // Parse file:line argument
    const colonIdx = fileArg.lastIndexOf(':');
    if (colonIdx === -1) {
      console.error('Error: argument must be in the format <file:line>, e.g. src/auth.js:42');
      process.exit(1);
    }

    const filePath = fileArg.substring(0, colonIdx);
    const lineStr = fileArg.substring(colonIdx + 1);
    const line = parseInt(lineStr, 10);

    if (isNaN(line) || line < 1) {
      console.error(`Error: invalid line number "${lineStr}"`);
      process.exit(1);
    }

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
      blame = blameFile(filePath, line);
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
  });

program.parse();
