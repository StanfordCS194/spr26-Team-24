import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveAgencyId } from "@/lib/jurisdictions/agency";
import { buildPrefillFields } from "@/lib/submission/prefill";
import { successResponse, errorResponse } from "@/lib/api/response";

// GET /api/reports/[id]/submission-fields
//
// Returns the per-field "copy-over" guide for filing this report with its
// agency's official form: the agency, the form URL, and each required field
// pre-filled with the value we already have. Nexa does not submit on the user's
// behalf — they copy these values into the official form themselves.
export async function GET(
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
    if (report.userId && report.userId !== session?.userId) {
      return errorResponse("You can only view your own reports.", 403);
    }

    // Resolve the agency for display without persisting (this is a read).
    let agency = report.agency;
    if (!agency) {
      const { agencyId } = await resolveAgencyId({
        latitude: report.latitude,
        longitude: report.longitude,
        issueType: report.issueType,
      });
      if (agencyId) {
        agency = await prisma.agency.findUnique({ where: { id: agencyId } });
      }
    }

    if (!agency) {
      return successResponse({ agency: null, fields: [] });
    }

    const fields = buildPrefillFields(
      {
        description: report.description,
        aiDescription: report.aiDescription,
        address: report.address,
        latitude: report.latitude,
        longitude: report.longitude,
        imageUrl: report.imageUrl,
        createdAt: report.createdAt,
        contactEmail: session?.email ?? null,
      },
      agency.requiredFields,
    );

    return successResponse({
      agency: {
        name: agency.name,
        intakeUrl: agency.intakeUrl,
        intakeMethod: agency.intakeMethod,
      },
      formUrl: agency.intakeUrl,
      fields,
    });
  } catch (error) {
    console.error("Submission fields error:", error);
    return errorResponse("Failed to build submission fields.", 500);
  }
}
