import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveAgencyId } from "@/lib/jurisdictions/agency";
import { findOrCreateIssueGroup } from "@/lib/issues/dedupe";
import { CreateReportSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";

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
    } = await parseJsonRequest(request, CreateReportSchema);

    const validIssueType = issueType ?? null;

    // Route the report to the responsible agency from its location + issue
    // type so the submission pipeline has somewhere to file it.
    const agencyId = await resolveAgencyId({
      latitude,
      longitude,
      issueType: validIssueType,
    });

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
        status: "CONFIRMED",
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Report creation error:", error);
    return NextResponse.json(
      { error: "Failed to create report. Please try again." },
      { status: 500 },
    );
  }
}
