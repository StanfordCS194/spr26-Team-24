import { prisma } from "@/lib/prisma";
import { IntakeMethod, ReportStatus } from "@/generated/prisma/enums";
import { resolveAgencyId } from "@/lib/jurisdictions/agency";
import { parseOpen311Config, submitToOpen311 } from "@/lib/submission/open311";

// ---------------------------------------------------------------------------
// Submission orchestrator (issue #34)
//
// One entry point ties a CONFIRMED report to the right submission agent based
// on its assigned agency's `intakeMethod`, executes that agent, stores the
// resulting tracking id, and advances the report's status — or rolls it back
// on failure so the user can retry.
//
//   API                -> the Open311 GeoReport agent (`open311.ts`). Fully
//                         automated: we file the request and store the returned
//                         service_request_id / token. (issue #32)
//   WEB_FORM / EMAIL    -> a graceful manual-assist fallback. The per-modality
//                         email (#31) and web-form (#33) agents are separate;
//                         until they land, we degrade gracefully by pointing the
//                         user at the official form / address with their fields
//                         pre-filled (the `submission-fields` route + assistant)
//                         rather than failing the request. The report stays
//                         CONFIRMED so it can be submitted manually.
//   PHONE              -> same manual-assist fallback (no automated path).
//
// Like `open311.ts`, this never throws to its caller: every outcome is a typed
// discriminated result the route maps onto an HTTP response.
// ---------------------------------------------------------------------------

/** Outcome of orchestrating a single report's submission. */
export type OrchestrationResult =
  | {
      // The report was filed with an automated agent (API intake). Status is
      // now SUBMITTED and `externalTrackingId` is set.
      status: "submitted";
      reportId: string;
      externalTrackingId: string;
    }
  | {
      // No automated agent covers this agency's intake method. The report stays
      // CONFIRMED; the caller should surface the manual-assist path (official
      // form/email link + pre-filled fields) so the user can file it.
      status: "manual_assist";
      reportId: string;
      intakeMethod: IntakeMethod;
      agencyName: string;
      // Where the user should file: the agency's form URL or intake email.
      intakeUrl: string | null;
      intakeEmail: string | null;
    }
  | {
      // A precondition failed (report missing, not owned, already submitted, no
      // agency). `code` lets the route choose an HTTP status without parsing
      // the message.
      status: "error";
      code:
        | "not_found"
        | "forbidden"
        | "already_submitted"
        | "in_progress"
        | "no_agency"
        | "submit_failed";
      message: string;
    };

/** Caller identity used to authorize the submission. */
export type OrchestrationActor = {
  // The signed-in user's id, or null/undefined for an anonymous caller.
  userId?: string | null;
};

/**
 * Orchestrates submission of a single confirmed report end-to-end.
 *
 * Responsibilities (mirroring the prior inline logic of the submit route, now
 * generalized beyond API-only intake):
 *  1. Load the report and authorize the actor (owner-only; anonymous reports
 *     stay submittable by any link-holder).
 *  2. Ensure an agency is assigned, resolving + persisting one on demand.
 *  3. Dispatch by `agency.intakeMethod`:
 *       - API: atomically claim CONFIRMED -> SUBMITTING, run the Open311 agent,
 *         then SUBMITTING -> SUBMITTED (storing the tracking id) on success or
 *         roll back to CONFIRMED on failure.
 *       - WEB_FORM / EMAIL / PHONE: leave the report CONFIRMED and return a
 *         `manual_assist` result instead of erroring.
 */
export async function orchestrateSubmission(
  reportId: string,
  actor: OrchestrationActor = {},
): Promise<OrchestrationResult> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { agency: true },
  });

  if (!report) {
    return {
      status: "error",
      code: "not_found",
      message: "Report not found.",
    };
  }

  // Only the report's owner may submit it. Anonymous (userId === null) reports
  // remain submittable by anyone holding the link, matching the
  // anonymous-reporting model elsewhere in the app.
  if (report.userId && report.userId !== actor.userId) {
    return {
      status: "error",
      code: "forbidden",
      message: "You can only submit your own reports.",
    };
  }

  if (report.status === ReportStatus.SUBMITTED || report.externalTrackingId) {
    return {
      status: "error",
      code: "already_submitted",
      message: "This report has already been submitted.",
    };
  }

  // Reports created before jurisdiction routing existed (or whose location was
  // added later) may not have an agency yet — resolve it on demand.
  let agency = report.agency;
  if (!agency) {
    const { agencyId } = await resolveAgencyId({
      latitude: report.latitude,
      longitude: report.longitude,
      issueType: report.issueType,
    });
    if (agencyId) {
      await prisma.report.update({
        where: { id: reportId },
        data: { agencyId },
      });
      agency = await prisma.agency.findUnique({ where: { id: agencyId } });
    }
  }
  if (!agency) {
    return {
      status: "error",
      code: "no_agency",
      message: "No agency is assigned to this report.",
    };
  }

  // Non-API intake has no automated agent wired yet (#31/#33). Degrade
  // gracefully: the report stays CONFIRMED and the caller surfaces the
  // manual-assist path rather than returning an error.
  if (agency.intakeMethod !== IntakeMethod.API) {
    return {
      status: "manual_assist",
      reportId: report.id,
      intakeMethod: agency.intakeMethod,
      agencyName: agency.name,
      intakeUrl: agency.intakeUrl,
      intakeEmail: agency.intakeEmail,
    };
  }

  // --- API path: fully automated Open311 submission -----------------------

  // Atomically claim the report for submission. A single conditional update
  // (CONFIRMED -> SUBMITTING) is the DB-level guard against concurrent submits:
  // only one of two simultaneous calls can flip the row, so only one ever
  // reaches submitToOpen311 below. The loser sees count === 0.
  const claim = await prisma.report.updateMany({
    where: { id: reportId, status: ReportStatus.CONFIRMED },
    data: { status: ReportStatus.SUBMITTING },
  });
  if (claim.count !== 1) {
    return {
      status: "error",
      code: "in_progress",
      message: "This report is already being submitted.",
    };
  }

  const config = parseOpen311Config(agency.requiredFields);
  const result = await submitToOpen311(report, {
    config,
    intakeUrl: agency.intakeUrl,
  });

  if (result.status === "error") {
    // Roll back to CONFIRMED so the user can retry.
    await prisma.report.update({
      where: { id: reportId },
      data: { status: ReportStatus.CONFIRMED },
    });
    return {
      status: "error",
      code: "submit_failed",
      message: result.message,
    };
  }

  const updated = await prisma.report.update({
    where: { id: reportId },
    data: {
      status: ReportStatus.SUBMITTED,
      // Prefer the immediate id; fall back to the async token until a later
      // poll resolves it to a real service_request_id.
      externalTrackingId: result.serviceRequestId ?? result.token,
    },
  });

  return {
    status: "submitted",
    reportId: updated.id,
    // Non-null: a "submitted" result always carries an id or token (the agent
    // errors otherwise), and the line above writes one of the two.
    externalTrackingId: updated.externalTrackingId as string,
  };
}
