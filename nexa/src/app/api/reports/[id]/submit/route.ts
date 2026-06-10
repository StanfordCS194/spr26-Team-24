import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { orchestrateSubmission } from "@/lib/submission/orchestrate";
import { successResponse, errorResponse } from "@/lib/api/response";

// POST /api/reports/[id]/submit
//
// Submits a single confirmed report to its assigned agency, dispatching to the
// right submission agent by the agency's `intakeMethod` (issue #34):
//
//   - API:              the report is filed automatically via the Open311
//                       GeoReport agent (#32). On success its
//                       externalTrackingId is stored and its status advances to
//                       SUBMITTED so the status poller (#37) can track it.
//   - WEB_FORM / EMAIL: there is no automated agent yet (#31/#33), so we degrade
//                       gracefully — the response reports `manualAssist` with
//                       the official intake link so the UI can guide the user
//                       through filing it themselves. The report stays CONFIRMED.
//
// The orchestration itself (auth, agency resolution, status transitions, agent
// dispatch) lives in `@/lib/submission/orchestrate`; this route is a thin
// translation of its discriminated result onto HTTP.
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    const { id } = await context.params;

    const result = await orchestrateSubmission(id, { userId: session?.userId });

    switch (result.status) {
      case "submitted":
        return successResponse({
          reportId: result.reportId,
          status: "SUBMITTED",
          submitted: true,
          externalTrackingId: result.externalTrackingId,
        });

      case "manual_assist":
        // Not an error: the agency simply has no automated agent, so the user
        // files it via the official channel. 200 with the details the UI needs
        // to render the manual-assist guidance.
        return successResponse({
          reportId: result.reportId,
          status: "CONFIRMED",
          submitted: false,
          manualAssist: {
            intakeMethod: result.intakeMethod,
            agencyName: result.agencyName,
            intakeUrl: result.intakeUrl,
            intakeEmail: result.intakeEmail,
          },
        });

      case "error": {
        // The Open311 agent's failure reason is worth surfacing to the user.
        const message =
          result.code === "submit_failed"
            ? `Submission failed: ${result.message}`
            : result.message;
        return errorResponse(message, ERROR_STATUS[result.code], result.code);
      }
    }
  } catch (error) {
    console.error("Report submission error:", error);
    return errorResponse("Failed to submit report. Please try again.", 500);
  }
}

// HTTP status for each orchestration error code. Keeping this here (rather than
// in the orchestrator) lets the service stay transport-agnostic.
const ERROR_STATUS: Record<
  Extract<
    Awaited<ReturnType<typeof orchestrateSubmission>>,
    { status: "error" }
  >["code"],
  number
> = {
  not_found: 404,
  forbidden: 403,
  already_submitted: 409,
  in_progress: 409,
  no_agency: 400,
  submit_failed: 502,
};
