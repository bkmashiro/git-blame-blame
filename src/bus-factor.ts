import type { FileContribution } from './blame.js';

/**
 * Minimum ownership percentage for an author to be counted as a maintainer.
 *
 * An author who owns more than this share of a file's lines is considered
 * a key maintainer for bus-factor calculations.
 */
export const BUS_FACTOR_THRESHOLD_PERCENT = 20;

/** An author's ownership share of a single file, expressed as both raw lines and a percentage. */
export interface FileAuthorShare {
  /** Email address of the author. */
  email: string;
  /** Display name of the author. */
  name: string;
  /** Number of lines attributed to this author in the file. */
  lines: number;
  /** Rounded percentage of total file lines owned by this author. */
  percent: number;
  /** Most recent commit date attributed to this author, in YYYY-MM-DD format. */
  lastModified: string;
}

/** Bus-factor analysis result for a single file. */
export interface FileBusFactor {
  /** Path to the file relative to the repository root. */
  filePath: string;
  /** Total number of attributed lines in the file. */
  totalLines: number;
  /** Number of authors who own more than the threshold percentage of lines. */
  busFactor: number;
  /** All authors with their ownership shares, sorted by descending line count. */
  authors: FileAuthorShare[];
  /** Subset of `authors` who meet the maintainer ownership threshold. */
  maintainers: FileAuthorShare[];
}

/** Aggregated bus-factor analysis across all files in a repository or path. */
export interface BusFactorReport {
  /** Per-file analysis results, sorted by file path. */
  files: FileBusFactor[];
  /** Minimum bus factor across all analysed files (worst-case knowledge concentration). */
  overallBusFactor: number;
  /** Files with a bus factor of exactly 1 (single point of failure). */
  criticalFiles: FileBusFactor[];
  /** Files with a bus factor of exactly 2 (shared but fragile ownership). */
  atRiskFiles: FileBusFactor[];
  /** Files with a bus factor of 3 or more (healthy distributed ownership). */
  healthyFiles: FileBusFactor[];
  /** Human-readable recommendation identifying the top single point of failure, or `null` if none. */
  recommendation: string | null;
}

/**
 * Groups a flat list of file contributions by file path.
 *
 * @param contributions - Flat array of per-author-per-file contributions.
 * @returns A map from file path to the array of contributions for that file.
 */
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
 * Calculates the bus factor for a single file.
 *
 * The bus factor equals the number of authors whose ownership share exceeds
 * `thresholdPercent`. A bus factor of 1 means a single author owns the majority
 * of the file (critical risk); higher values indicate more distributed ownership.
 *
 * @param filePath - Path to the file being analysed.
 * @param contributions - All contributions for this file (one entry per author).
 * @param thresholdPercent - Minimum ownership percentage to qualify as a maintainer.
 *   Defaults to {@link BUS_FACTOR_THRESHOLD_PERCENT}.
 * @returns A {@link FileBusFactor} containing the bus factor score, all authors, and key maintainers.
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
 * Analyses file contributions to produce a bus-factor report across all files.
 * @param contributions - Flat list of per-file, per-author contribution records.
 * @param thresholdPercent - Minimum ownership percentage for a contributor to count as a maintainer (default 20).
 * @returns Report with per-file bus factors, overall score, and a remediation recommendation.
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
