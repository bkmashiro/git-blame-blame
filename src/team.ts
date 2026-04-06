import { readFileSync } from 'node:fs';
import type { FileContribution } from './blame.js';

export interface TeamMember {
  name: string;
  email: string;
}

export interface TeamContributionRow {
  label: string;
  lines: number;
  files: number;
  percent: number;
  bar: string;
}

/**
 * Parses a JSON string into an array of team members.
 *
 * Expects the root value to be a JSON array where every element is an object
 * with `name` and `email` string fields.
 *
 * @param content - Raw JSON string to parse.
 * @returns Array of validated team members.
 * @throws {Error} If the root value is not an array.
 * @throws {Error} If any element is missing or has non-string `name` or `email` fields.
 */
export function parseTeamJson(content: string): TeamMember[] {
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Team JSON must be an array');
  }

  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as { name?: unknown }).name !== 'string' ||
      typeof (entry as { email?: unknown }).email !== 'string'
    ) {
      throw new Error('Each team member must include string name and email fields');
    }

    return {
      name: (entry as { name: string }).name,
      email: (entry as { email: string }).email,
    };
  });
}

/**
 * Parses a CSV string into an array of team members.
 *
 * The first non-empty line is treated as a header; it must contain `name` and
 * `email` columns (case-insensitive). Subsequent lines are parsed accordingly.
 * Returns an empty array for entirely blank input.
 *
 * @param content - Raw CSV string to parse.
 * @returns Array of team members in the order they appear in the file.
 * @throws {Error} If the header row does not contain both `name` and `email` columns.
 * @throws {Error} If any data row is missing a value for `name` or `email`.
 */
export function parseTeamCsv(content: string): TeamMember[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const [header, ...rows] = lines;
  const columns = header.split(',').map((column) => column.trim().toLowerCase());
  const nameIndex = columns.indexOf('name');
  const emailIndex = columns.indexOf('email');

  if (nameIndex === -1 || emailIndex === -1) {
    throw new Error('Team CSV must include name and email headers');
  }

  return rows.map((row) => {
    const values = row.split(',').map((value) => value.trim());
    const name = values[nameIndex];
    const email = values[emailIndex];

    if (!name || !email) {
      throw new Error(`Invalid team CSV row: ${row}`);
    }

    return { name, email };
  });
}

export function loadTeamFile(
  filePath: string,
  readFile: (path: string, encoding: BufferEncoding) => string = readFileSync
): TeamMember[] {
  const content = readFile(filePath, 'utf-8');
  const trimmed = content.trim();

  if (!trimmed) {
    return [];
  }

  if (filePath.endsWith('.json')) {
    return parseTeamJson(trimmed);
  }

  if (filePath.endsWith('.csv')) {
    return parseTeamCsv(trimmed);
  }

  try {
    return parseTeamJson(trimmed);
  } catch {
    return parseTeamCsv(trimmed);
  }
}

/**
 * Aggregates file contributions into per-team-member (and external) totals.
 *
 * Author emails are matched case-insensitively against the team roster. Any
 * author not on the team is bucketed under the `[external]` label. The result
 * includes a progress bar scaled to the highest contributor's line count.
 *
 * @param contributions - Flat list of file contributions produced by
 *   {@link collectFileContributions}.
 * @param team - Team roster used to classify authors.
 * @returns Rows sorted by descending line count, each with label, totals, percentage,
 *   and an ASCII bar proportional to contribution size.
 */
export function aggregateTeamContributions(
  contributions: FileContribution[],
  team: TeamMember[]
): TeamContributionRow[] {
  const teamEmails = new Set(team.map((member) => member.email.toLowerCase()));
  const totals = new Map<string, { lines: number; files: Set<string> }>();

  for (const contribution of contributions) {
    const email = contribution.authorEmail.toLowerCase();
    const label = teamEmails.has(email) ? contribution.authorEmail : '[external]';
    const existing = totals.get(label) ?? { lines: 0, files: new Set<string>() };
    existing.lines += contribution.lines;
    existing.files.add(contribution.filePath);
    totals.set(label, existing);
  }

  const totalLines = contributions.reduce((sum, contribution) => sum + contribution.lines, 0);
  const maxLines = Math.max(...Array.from(totals.values(), (entry) => entry.lines), 0);

  return Array.from(totals.entries())
    .map(([label, value]) => ({
      label,
      lines: value.lines,
      files: value.files.size,
      percent: totalLines === 0 ? 0 : Math.round((value.lines / totalLines) * 100),
      bar: maxLines === 0 ? '' : '#'.repeat(Math.max(1, Math.round((value.lines / maxLines) * 20))),
    }))
    .sort((left, right) => right.lines - left.lines || left.label.localeCompare(right.label));
}
