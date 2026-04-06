import type { FileContribution } from './blame.js';

export const BUS_FACTOR_THRESHOLD_PERCENT = 20;

export interface FileAuthorShare {
  email: string;
  name: string;
  lines: number;
  percent: number;
  lastModified: string;
}

export interface FileBusFactor {
  filePath: string;
  totalLines: number;
  busFactor: number;
  authors: FileAuthorShare[];
  maintainers: FileAuthorShare[];
}

export interface BusFactorReport {
  files: FileBusFactor[];
  overallBusFactor: number;
  criticalFiles: FileBusFactor[];
  atRiskFiles: FileBusFactor[];
  healthyFiles: FileBusFactor[];
  recommendation: string | null;
}

export function groupContributionsByFile(contributions: FileContribution[]): Map<string, FileContribution[]> {
  const grouped = new Map<string, FileContribution[]>();

  for (const contribution of contributions) {
    const existing = grouped.get(contribution.filePath) ?? [];
    existing.push(contribution);
    grouped.set(contribution.filePath, existing);
  }

  return grouped;
}

/**
 * Calculates the bus-factor score and author breakdown for a single file.
 *
 * The bus factor is defined as the number of authors whose individual line
 * ownership exceeds `thresholdPercent`. An author owning more than the threshold
 * is considered a "maintainer" — losing them would meaningfully hurt the file.
 *
 * @param filePath - Path of the file being analysed (stored verbatim in the result).
 * @param contributions - All per-author contribution records for this file.
 * @param thresholdPercent - Minimum ownership percentage to be counted as a maintainer
 *   (default: {@link BUS_FACTOR_THRESHOLD_PERCENT}).
 * @returns File bus-factor record including total lines, authors, maintainers, and score.
 */
export function calculateFileBusFactor(
  filePath: string,
  contributions: FileContribution[],
  thresholdPercent = BUS_FACTOR_THRESHOLD_PERCENT
): FileBusFactor {
  const totalLines = contributions.reduce((sum, contribution) => sum + contribution.lines, 0);
  const authors = contributions
    .map((contribution) => ({
      email: contribution.authorEmail,
      name: contribution.authorName,
      lines: contribution.lines,
      percent: totalLines === 0 ? 0 : Math.round((contribution.lines / totalLines) * 100),
      lastModified: contribution.lastModified,
    }))
    .sort((left, right) => right.lines - left.lines || left.email.localeCompare(right.email));

  const maintainers = authors.filter((author) => author.percent > thresholdPercent);

  return {
    filePath,
    totalLines,
    busFactor: maintainers.length,
    authors,
    maintainers,
  };
}

/**
 * Produces a full bus-factor report across all files in a contribution set.
 *
 * Files are classified into three risk tiers:
 * - **Critical** — bus factor = 1 (single point of failure)
 * - **At risk** — bus factor = 2
 * - **Healthy** — bus factor ≥ 3
 *
 * Also computes an overall repository bus factor (the minimum across all files)
 * and generates a human-readable recommendation highlighting the author who is
 * the single owner of the most critical files.
 *
 * @param contributions - Flat list of file contributions produced by {@link collectFileContributions}.
 * @param thresholdPercent - Ownership threshold for maintainer classification
 *   (default: {@link BUS_FACTOR_THRESHOLD_PERCENT}).
 * @returns Aggregated bus-factor report with per-file detail and summary statistics.
 */
export function analyzeBusFactor(
  contributions: FileContribution[],
  thresholdPercent = BUS_FACTOR_THRESHOLD_PERCENT
): BusFactorReport {
  const files = Array.from(groupContributionsByFile(contributions).entries())
    .map(([filePath, rows]) => calculateFileBusFactor(filePath, rows, thresholdPercent))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  const criticalFiles = files.filter((file) => file.busFactor === 1);
  const atRiskFiles = files.filter((file) => file.busFactor === 2);
  const healthyFiles = files.filter((file) => file.busFactor >= 3);
  const overallBusFactor = files.length === 0 ? 0 : Math.min(...files.map((file) => file.busFactor));

  const ownerCounts = new Map<string, { name: string; count: number }>();
  for (const file of criticalFiles) {
    const owner = file.maintainers[0];
    if (!owner) {
      continue;
    }

    const existing = ownerCounts.get(owner.email) ?? { name: owner.name, count: 0 };
    existing.count += 1;
    ownerCounts.set(owner.email, existing);
  }

  const topOwner = Array.from(ownerCounts.entries())
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))[0];

  return {
    files,
    overallBusFactor,
    criticalFiles,
    atRiskFiles,
    healthyFiles,
    recommendation: topOwner
      ? `${topOwner[1].name} is the single point of failure for ${topOwner[1].count} file${topOwner[1].count === 1 ? '' : 's'}`
      : null,
  };
}
