import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveAgencyId } from "@/lib/jurisdictions/agency";
import { findOrCreateIssueGroup } from "@/lib/issues/dedupe";
import { findDuplicateReport } from "@/lib/reports/dedup";
import { CreateReportSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";
import { ReportStatus } from "@/generated/prisma/enums";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    const {
      description,
      aiDescription,
      issueType,
      latitude,
      longitude,
      address,
      imageUrl,
      selectedAgencyId,
    } = await parseJsonRequest(request, CreateReportSchema);

    const validIssueType = issueType ?? null;

    // Guard against the same reporter (or, for guests, the same nearby spot)
    // filing an identical issue twice in quick succession. On a likely match we
    // return 409 with the existing report's id rather than persisting a second
    // copy — distinct reports (different type/location/window) are unaffected.
    const duplicate = await findDuplicateReport({
      userId: session?.userId ?? null,
      issueType: validIssueType,
      latitude,
      longitude,
    });
    if (duplicate) {
      return errorResponse(
        "A matching report was filed recently nearby.",
        409,
        "DUPLICATE_REPORT",
        { duplicateOf: duplicate.reportId },
      );
    }

    // Route the report to the responsible agency from its location + issue
    // type so the submission pipeline has somewhere to file it. When routing is
    // unresolved or ambiguous we persist agencyId=null and log why rather than
    // failing the request — the report can still be created and routed later.
    const { agencyId: resolvedAgencyId, candidates } = await resolveAgencyId({
      latitude,
      longitude,
      issueType: validIssueType,
    });

    // When the user disambiguated an ambiguous match in the review step, honor
    // their choice — but only after validating it server-side against the freshly
    // resolved candidate set. Re-resolving here (rather than trusting the client)
    // means a client cannot assign an arbitrary agency: the selected id MUST be
    // one of the agencies that actually cover this location + issue type.
    let agencyId = resolvedAgencyId;
    if (selectedAgencyId !== undefined) {
      if (!candidates.includes(selectedAgencyId)) {
        return errorResponse(
          "Selected agency is not a valid candidate for this report's location and issue type.",
          400,
          "INVALID_AGENCY_CHOICE",
          { candidates },
        );
      }
      agencyId = selectedAgencyId;
    }

    if (!agencyId) {
      const reason =
        candidates.length > 1
          ? `ambiguous: ${candidates.length} candidate agencies (${candidates.join(", ")})`
          : "no agency covers this jurisdiction + issue type";
      console.warn(
        `Report routing unresolved (issueType=${validIssueType}, lat=${latitude}, lng=${longitude}): ${reason}`,
      );
    }

    // Group this report with any existing open report about the same nearby
    // issue so duplicate reports from different people share one case. Returns
    // null (no grouping) when the report has no location or issue type.
    const issueGroupId = await findOrCreateIssueGroup({
      issueType: validIssueType,
      latitude,
      longitude,
    });

    const report = await prisma.report.create({
      data: {
        userId: session?.userId ?? null,
        description,
        aiDescription,
        issueType: validIssueType,
        latitude,
        longitude,
        address,
        imageUrl,
        agencyId,
        issueGroupId,
        // A report row is only created once the user has reviewed the AI
        // classification and confirmed it client-side (the `/api/reports/classify`
        // endpoint is stateless and persists nothing). So the report is born
        // CONFIRMED — the DRAFT / CLASSIFYING enum values model the pre-creation
        // stages that live in the client and are never persisted on this path.
        // This is the start state of the lifecycle in src/lib/reports/status-machine.ts.
        status: ReportStatus.CONFIRMED,
      },
    });

    return successResponse(report, 201);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Report creation error:", error);
    return errorResponse("Failed to create report. Please try again.", 500);
  }
}
