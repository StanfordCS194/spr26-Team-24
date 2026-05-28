import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { IntakeMethod, ReportStatus } from "@/generated/prisma/enums";
import { parseOpen311Config, submitToOpen311 } from "@/lib/submission/open311";

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
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }

    // Only the report's owner may submit it. Anonymous (userId === null)
    // reports remain submittable by anyone holding the link, matching the
    // anonymous-reporting model elsewhere in the app.
    if (report.userId && report.userId !== session?.userId) {
      return NextResponse.json(
        { error: "You can only submit your own reports." },
        { status: 403 },
      );
    }

    if (report.status === ReportStatus.SUBMITTED || report.externalTrackingId) {
      return NextResponse.json(
        { error: "This report has already been submitted." },
        { status: 409 },
      );
    }

    const agency = report.agency;
    if (!agency) {
      return NextResponse.json(
        { error: "No agency is assigned to this report." },
        { status: 400 },
      );
    }
    if (agency.intakeMethod !== IntakeMethod.API) {
      return NextResponse.json(
        {
          error: `Agency "${agency.name}" does not accept API submissions (intake method: ${agency.intakeMethod}).`,
        },
        { status: 400 },
      );
    }

    // Mark in-flight so concurrent submits don't double-file.
    await prisma.report.update({
      where: { id },
      data: { status: ReportStatus.SUBMITTING },
    });

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
      return NextResponse.json(
        { error: `Submission failed: ${result.message}` },
        { status: 502 },
      );
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

    return NextResponse.json({
      success: true,
      reportId: updated.id,
      status: updated.status,
      externalTrackingId: updated.externalTrackingId,
    });
  } catch (error) {
    console.error("Report submission error:", error);
    return NextResponse.json(
      { error: "Failed to submit report. Please try again." },
      { status: 500 },
    );
  }
}
