import { prisma } from "@/lib/prisma";
import { ReportStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Admin analytics aggregation (issue #219).
//
// Computes group-level metrics across ALL reports for the /admin dashboard:
//   - submission success / failure rate
//   - status distribution
//   - median & p90 time-to-submit
//   - per-agency and per-issue-type breakdowns
//   - ambiguous / no-agency rates
//
// Data layer note: this reuses the shared Prisma singleton (no parallel data
// access) and pushes the heavy lifting into the DB with `groupBy` / `aggregate`
// rather than pulling every row into the app. The one exception is
// time-to-submit, which needs per-row `(submittedAt - createdAt)` and so reads a
// trimmed projection of the submitted-or-later reports. `submittedAt` is the
// timestamp orchestrateSubmission stamps on the SUBMITTED transition (#241); we
// fall back to `updatedAt` only for rows submitted before that column existed.
//
// The pure shaping helpers (rates, percentiles, distribution) are exported so
// they can be unit-tested without a database.
// ---------------------------------------------------------------------------

/**
 * Lifecycle states that mean a report was successfully filed with an agency.
 * SUBMITTED and everything past it on the status machine (see
 * src/lib/reports/status-machine.ts) count as a successful submission.
 */
const SUBMITTED_STATUSES: ReportStatus[] = [
  ReportStatus.SUBMITTED,
  ReportStatus.ACKNOWLEDGED,
  ReportStatus.IN_PROGRESS,
  ReportStatus.RESOLVED,
  ReportStatus.CLOSED,
];

/**
 * A report that reached CONFIRMED (ready to file) but never advanced past it is
 * "stuck" — confirmed but not submitted. This is the failure signal the
 * dashboard surfaces: the routing/submission step never completed. DRAFT and
 * CLASSIFYING are pre-confirmation and are not counted as failures (the user
 * simply hasn't finished), but they are tracked in the status distribution.
 */
const STUCK_STATUSES: ReportStatus[] = [
  ReportStatus.CONFIRMED,
  ReportStatus.SUBMITTING,
];

export type StatusCount = { status: ReportStatus; count: number };
export type IssueTypeCount = { issueType: string; count: number };
export type AgencyCount = {
  agencyId: string | null;
  name: string;
  count: number;
};

export interface SubmissionRates {
  /** Total reports past the pre-confirmation stage (denominator). */
  total: number;
  /** Reports that were successfully filed (SUBMITTED or later). */
  submitted: number;
  /** Confirmed-or-submitting reports that have not (yet) been filed. */
  stuck: number;
  /** submitted / total, in [0,1]. 0 when total is 0. */
  successRate: number;
  /** stuck / total, in [0,1]. 0 when total is 0. */
  failureRate: number;
}

export interface TimeToSubmitStats {
  /** Number of submitted reports we could measure a time for. */
  count: number;
  /** Median seconds from report creation to submission. null when count is 0. */
  medianSeconds: number | null;
  /** 90th-percentile seconds from creation to submission. null when count is 0. */
  p90Seconds: number | null;
}

export interface AmbiguityRates {
  total: number;
  /** Reports with no agency assigned (no jurisdiction/issue-type match). */
  noAgency: number;
  /** noAgency / total, in [0,1]. 0 when total is 0. */
  noAgencyRate: number;
}

export interface AdminAnalytics {
  totalReports: number;
  submission: SubmissionRates;
  statusDistribution: StatusCount[];
  byIssueType: IssueTypeCount[];
  byAgency: AgencyCount[];
  timeToSubmit: TimeToSubmitStats;
  ambiguity: AmbiguityRates;
}

/** Divide safely, returning 0 (not NaN) when the denominator is 0. */
export function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * The `p`-th percentile (0..100) of `values` using linear interpolation between
 * the two closest ranks (the common "type 7" definition). Returns null for an
 * empty input. Does not mutate the caller's array.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Derive the submission success/failure rates from a status -> count map.
 * "Total" excludes the pre-confirmation DRAFT/CLASSIFYING states so the rate
 * answers "of the reports that were ready to file, how many got filed?".
 */
export function computeSubmissionRates(
  counts: Map<ReportStatus, number>,
): SubmissionRates {
  const submitted = SUBMITTED_STATUSES.reduce(
    (sum, status) => sum + (counts.get(status) ?? 0),
    0,
  );
  const stuck = STUCK_STATUSES.reduce(
    (sum, status) => sum + (counts.get(status) ?? 0),
    0,
  );
  const total = submitted + stuck;
  return {
    total,
    submitted,
    stuck,
    successRate: rate(submitted, total),
    failureRate: rate(stuck, total),
  };
}

/**
 * Compute median & p90 time-to-submit (in whole seconds) from a list of
 * creation/submission timestamp pairs. The submission timestamp is the report's
 * `submittedAt` — stamped on the SUBMITTED transition (#241) — which is exact.
 * Rows submitted before that column existed have a null `submittedAt`; for those
 * we fall back to `updatedAt`, an approximation since it reflects the most recent
 * change. Negative or non-finite durations are dropped defensively.
 */
export function computeTimeToSubmit(
  rows: { createdAt: Date; updatedAt: Date; submittedAt: Date | null }[],
): TimeToSubmitStats {
  const durations = rows
    .map((row) => {
      const submittedAt = row.submittedAt ?? row.updatedAt;
      return (submittedAt.getTime() - row.createdAt.getTime()) / 1000;
    })
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);

  const median = percentile(durations, 50);
  const p90 = percentile(durations, 90);
  return {
    count: durations.length,
    medianSeconds: median === null ? null : Math.round(median),
    p90Seconds: p90 === null ? null : Math.round(p90),
  };
}

/**
 * Aggregate analytics across every report. Reuses the shared Prisma client and
 * runs the independent aggregations concurrently. Pure shaping is delegated to
 * the exported helpers above so the math is unit-tested without a DB.
 */
export async function computeAdminAnalytics(): Promise<AdminAnalytics> {
  const [
    totalReports,
    statusGroups,
    issueTypeGroups,
    agencyGroups,
    noAgencyCount,
    submittedRows,
    agencies,
  ] = await Promise.all([
    prisma.report.count(),
    prisma.report.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.report.groupBy({ by: ["issueType"], _count: { _all: true } }),
    prisma.report.groupBy({ by: ["agencyId"], _count: { _all: true } }),
    prisma.report.count({ where: { agencyId: null } }),
    prisma.report.findMany({
      where: { status: { in: SUBMITTED_STATUSES } },
      select: { createdAt: true, updatedAt: true, submittedAt: true },
    }),
    prisma.agency.findMany({ select: { id: true, name: true } }),
  ]);

  const statusCountMap = new Map<ReportStatus, number>(
    statusGroups.map((group) => [group.status, group._count._all]),
  );

  const statusDistribution: StatusCount[] = statusGroups
    .map((group) => ({ status: group.status, count: group._count._all }))
    .sort((a, b) => b.count - a.count);

  const byIssueType: IssueTypeCount[] = issueTypeGroups
    .map((group) => ({
      issueType: group.issueType ?? "UNCATEGORIZED",
      count: group._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  const agencyNameById = new Map(
    agencies.map((agency) => [agency.id, agency.name]),
  );
  const byAgency: AgencyCount[] = agencyGroups
    .map((group) => ({
      agencyId: group.agencyId,
      name:
        group.agencyId === null
          ? "UNROUTED"
          : (agencyNameById.get(group.agencyId) ?? "UNKNOWN"),
      count: group._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalReports,
    submission: computeSubmissionRates(statusCountMap),
    statusDistribution,
    byIssueType,
    byAgency,
    timeToSubmit: computeTimeToSubmit(submittedRows),
    ambiguity: {
      total: totalReports,
      noAgency: noAgencyCount,
      noAgencyRate: rate(noAgencyCount, totalReports),
    },
  };
}
