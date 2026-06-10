import { ReportStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Report status machine (issue #104)
//
// A single source of truth for the report lifecycle: which `ReportStatus`
// transitions are allowed, and a `canTransition` / `assertTransition` pair the
// mutation sites use so an invalid transition (e.g. DRAFT -> RESOLVED, or the
// poller demoting a report) is rejected rather than silently written.
//
// Lifecycle (forward, "happy path"):
//
//   DRAFT -> CLASSIFYING -> CONFIRMED -> SUBMITTING -> SUBMITTED
//         -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED
//
//   - DRAFT        a report row exists but hasn't been classified/confirmed.
//                  (Schema default; today the create flow in src/app/api/reports
//                  confirms immediately, since classification runs client-side
//                  before the row is created — see the route's comment.)
//   - CLASSIFYING  AI classification is in flight. Optional intermediate state.
//   - CONFIRMED    the user confirmed the report; it is ready to submit.
//   - SUBMITTING   a submission agent has atomically claimed the report.
//   - SUBMITTED    filed with the agency; the poller now tracks it.
//   - ACKNOWLEDGED / IN_PROGRESS  agency-reported progress (from the poller).
//   - RESOLVED     the issue is resolved (by the agency or the reporter).
//   - CLOSED       terminal; no further transitions.
//
// Besides the forward path there are a few legitimate non-forward edges:
//   - SUBMITTING -> CONFIRMED   rollback when a submission attempt fails.
//   - CLASSIFYING -> DRAFT      classification was cancelled / reset.
//   - any non-terminal -> CLOSED  an admin/cleanup may close a report.
//   - RESOLVED -> IN_PROGRESS   the agency reopened a "resolved" case.
//
// The poller additionally only ever moves a report *forward* by rank
// (see STATUS_RANK + isForwardTransition) so an Open311 "open" can never demote
// a report a human already advanced.
// ---------------------------------------------------------------------------

/**
 * Monotonic rank of each lifecycle state. Used to detect forward vs. backward
 * movement (e.g. the status poller never regresses a report). This is the
 * single ranking for the app; `open311.ts` re-exports it for backward compat.
 */
export const STATUS_RANK: Record<ReportStatus, number> = {
  [ReportStatus.DRAFT]: 0,
  [ReportStatus.CLASSIFYING]: 1,
  [ReportStatus.CONFIRMED]: 2,
  [ReportStatus.SUBMITTING]: 3,
  [ReportStatus.SUBMITTED]: 4,
  [ReportStatus.ACKNOWLEDGED]: 5,
  [ReportStatus.IN_PROGRESS]: 6,
  [ReportStatus.RESOLVED]: 7,
  [ReportStatus.CLOSED]: 8,
};

/**
 * Allowed transitions, keyed by the *from* status. A transition is permitted
 * iff the target appears in the source's set. CLOSED is terminal (empty set).
 *
 * Re-entering the same status is treated as a no-op and always allowed (see
 * `canTransition`), so idempotent writes don't need to be special-cased here.
 */
const ALLOWED_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  [ReportStatus.DRAFT]: [
    ReportStatus.CLASSIFYING,
    ReportStatus.CONFIRMED,
    ReportStatus.CLOSED,
  ],
  [ReportStatus.CLASSIFYING]: [
    ReportStatus.CONFIRMED,
    ReportStatus.DRAFT,
    ReportStatus.CLOSED,
  ],
  [ReportStatus.CONFIRMED]: [ReportStatus.SUBMITTING, ReportStatus.CLOSED],
  [ReportStatus.SUBMITTING]: [
    ReportStatus.SUBMITTED,
    // Rollback when a submission attempt fails (orchestrator).
    ReportStatus.CONFIRMED,
    ReportStatus.CLOSED,
  ],
  [ReportStatus.SUBMITTED]: [
    ReportStatus.ACKNOWLEDGED,
    ReportStatus.IN_PROGRESS,
    ReportStatus.RESOLVED,
    ReportStatus.CLOSED,
  ],
  [ReportStatus.ACKNOWLEDGED]: [
    ReportStatus.IN_PROGRESS,
    ReportStatus.RESOLVED,
    ReportStatus.CLOSED,
  ],
  [ReportStatus.IN_PROGRESS]: [ReportStatus.RESOLVED, ReportStatus.CLOSED],
  [ReportStatus.RESOLVED]: [
    // The agency can reopen a case it previously marked resolved.
    ReportStatus.IN_PROGRESS,
    ReportStatus.CLOSED,
  ],
  [ReportStatus.CLOSED]: [],
};

/**
 * The statuses from which a *user* may mark a report RESOLVED. A report must
 * have at least been submitted before it can be user-resolved — resolving a
 * DRAFT / CLASSIFYING / CONFIRMED / SUBMITTING report would bypass the
 * submission flow. (Enforced by the resolution endpoint, issue #104.)
 */
export const USER_RESOLVABLE_FROM: ReportStatus[] = [
  ReportStatus.SUBMITTED,
  ReportStatus.ACKNOWLEDGED,
  ReportStatus.IN_PROGRESS,
  ReportStatus.RESOLVED,
];

/** Terminal states the poller (and other automations) stop tracking. */
export const TERMINAL_STATUSES: ReportStatus[] = [
  ReportStatus.RESOLVED,
  ReportStatus.CLOSED,
];

/**
 * Whether moving from `from` to `to` is a legal status transition. Staying in
 * the same status is always allowed (idempotent no-op write).
 */
export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** True when `to` is strictly later in the lifecycle than `from` by rank. */
export function isForwardTransition(
  from: ReportStatus,
  to: ReportStatus,
): boolean {
  return STATUS_RANK[to] > STATUS_RANK[from];
}

/** Thrown by `assertTransition` when a transition isn't allowed. */
export class InvalidStatusTransitionError extends Error {
  readonly from: ReportStatus;
  readonly to: ReportStatus;

  constructor(from: ReportStatus, to: ReportStatus) {
    super(`Invalid report status transition: ${from} -> ${to}.`);
    this.name = "InvalidStatusTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Asserts that `from -> to` is a legal transition, throwing
 * `InvalidStatusTransitionError` otherwise. Use at mutation sites that aren't
 * already guarded by a conditional DB update.
 */
export function assertTransition(from: ReportStatus, to: ReportStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}
