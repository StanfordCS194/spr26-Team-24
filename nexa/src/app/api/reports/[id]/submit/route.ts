import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { IntakeMethod, ReportStatus } from "@/generated/prisma/enums";
import { parseOpen311Config, submitToOpen311 } from "@/lib/submission/open311";
import { resolveAgencyId } from "@/lib/jurisdictions/agency";
import { successResponse, errorResponse } from "@/lib/api/response";

// POST /api/reports/[id]/submit
//
// Submits a single confirmed report to its assigned agency via the Open311
// GeoReport v2 API. This is the API submission agent from issue #32; web-form,
// email, and phone intake methods are handled by their own agents (#31, #33)
// and are out of scope here.
//
// On success the report's externalTrackingId is stored and its status advances
// to SUBMITTED so the status poller (#37) can later track it.
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    const { id } = await context.params;

    const report = await prisma.report.findUnique({
      where: { id },
      include: { agency: true },
    });

    if (!report) {
      return errorResponse("Report not found.", 404);
    }

    // Only the report's owner may submit it. Anonymous (userId === null)
    // reports remain submittable by anyone holding the link, matching the
    // anonymous-reporting model elsewhere in the app.
    if (report.userId && report.userId !== session?.userId) {
      return errorResponse("You can only submit your own reports.", 403);
    }

    if (report.status === ReportStatus.SUBMITTED || report.externalTrackingId) {
      return errorResponse("This report has already been submitted.", 409);
    }

    // Reports created before jurisdiction routing existed (or whose location
    // was added later) may not have an agency yet — resolve it on demand.
    let agency = report.agency;
    if (!agency) {
      const { agencyId } = await resolveAgencyId({
        latitude: report.latitude,
        longitude: report.longitude,
        issueType: report.issueType,
      });
      if (agencyId) {
        await prisma.report.update({ where: { id }, data: { agencyId } });
        agency = await prisma.agency.findUnique({ where: { id: agencyId } });
      }
    }
    if (!agency) {
      return errorResponse("No agency is assigned to this report.", 400);
    }
    if (agency.intakeMethod !== IntakeMethod.API) {
      return errorResponse(
        `Agency "${agency.name}" does not accept API submissions (intake method: ${agency.intakeMethod}).`,
        400,
      );
    }

    // Atomically claim the report for submission. A single conditional update
    // (CONFIRMED -> SUBMITTING) is the DB-level guard against concurrent
    // submits: only one of two simultaneous POSTs can flip the row, so only
    // one ever reaches submitToOpen311 below. The loser sees count === 0.
    const claim = await prisma.report.updateMany({
      where: { id, status: ReportStatus.CONFIRMED },
      data: { status: ReportStatus.SUBMITTING },
    });
    if (claim.count !== 1) {
      return errorResponse("This report is already being submitted.", 409);
    }

    const config = parseOpen311Config(agency.requiredFields);
    const result = await submitToOpen311(report, {
      config,
      intakeUrl: agency.intakeUrl,
    });

    if (result.status === "error") {
      // Roll back to CONFIRMED so the user can retry.
      await prisma.report.update({
        where: { id },
        data: { status: ReportStatus.CONFIRMED },
      });
      return errorResponse(`Submission failed: ${result.message}`, 502);
    }

    const updated = await prisma.report.update({
      where: { id },
      data: {
        status: ReportStatus.SUBMITTED,
        // Prefer the immediate id; fall back to the async token until a later
        // poll resolves it to a real service_request_id.
        externalTrackingId: result.serviceRequestId ?? result.token,
      },
    });

    return successResponse({
      reportId: updated.id,
      status: updated.status,
      externalTrackingId: updated.externalTrackingId,
    });
  } catch (error) {
    console.error("Report submission error:", error);
    return errorResponse("Failed to submit report. Please try again.", 500);
  }
}
