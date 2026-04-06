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

function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (inQuotes) {
      if (char === '"' && row[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

export function parseTeamCsv(content: string): TeamMember[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const [header, ...rows] = lines;
  const columns = parseCsvRow(header).map((column) => column.toLowerCase());
  const nameIndex = columns.indexOf('name');
  const emailIndex = columns.indexOf('email');

  if (nameIndex === -1 || emailIndex === -1) {
    throw new Error('Team CSV must include name and email headers');
  }

  return rows.map((row) => {
    const values = parseCsvRow(row);
    const name = values[nameIndex];
    const email = values[emailIndex];

    if (!name || !email) {
      throw new Error(`Invalid team CSV row: ${row}`);
    }

    return { name, email };
  });
}

/**
 * Loads a team member list from a JSON or CSV file, auto-detecting the format by extension or content.
 * @param filePath - Path to the team file (`.json` or `.csv`; plain JSON array is also accepted).
 * @param readFile - File reader function; defaults to `fs.readFileSync` (injectable for testing).
 * @returns Array of parsed team members with `name` and `email` fields.
 */
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
 * Aggregates file contributions into per-team-member (plus `[external]`) totals with a progress bar.
 * @param contributions - Flat list of per-file, per-author contribution records.
 * @param team - List of known team members used to distinguish internal from external contributors.
 * @returns Rows sorted by line count descending, each with label, line count, file count, percentage, and bar.
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
