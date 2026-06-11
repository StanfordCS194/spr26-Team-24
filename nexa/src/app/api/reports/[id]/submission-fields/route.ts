import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveAgencyId } from "@/lib/jurisdictions/agency";
import { buildPrefillFields } from "@/lib/submission/prefill";
import { successResponse, errorResponse } from "@/lib/api/response";

// A generic field set used to pre-compose the report when there is no matched
// agency (so no required-fields schema) but the user supplied their own link.
// Covers the values every civic form asks for.
const DEFAULT_PREFILL_SCHEMA = {
  description: { type: "string", required: true },
  location_address: { type: "string", required: true },
  latitude: { type: "number", required: false },
  longitude: { type: "number", required: false },
  photo: { type: "file", required: false },
} as const;

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

    // The user's own override link (the "Filing somewhere else?" field). When
    // present it is the destination we route them to, regardless of what we
    // auto-routed — so a copy-over guide is worth building even with no agency.
    const customAgencyUrl = report.customAgencyUrl ?? null;

    const prefillReport = {
      description: report.description,
      aiDescription: report.aiDescription,
      address: report.address,
      latitude: report.latitude,
      longitude: report.longitude,
      imageUrl: report.imageUrl,
      createdAt: report.createdAt,
      contactEmail: session?.email ?? null,
    };

    if (!agency) {
      // No matched agency, but if the user supplied their own link we still
      // pre-compose the report against a generic field set so they can paste it
      // into that page. With no link and no agency there is nothing to fill.
      const fields = customAgencyUrl
        ? buildPrefillFields(prefillReport, DEFAULT_PREFILL_SCHEMA)
        : [];
      return successResponse({
        agency: null,
        formUrl: customAgencyUrl,
        customAgencyUrl,
        fields,
      });
    }

    const fields = buildPrefillFields(prefillReport, agency.requiredFields);

    return successResponse({
      agency: {
        name: agency.name,
        intakeUrl: agency.intakeUrl,
        intakeMethod: agency.intakeMethod,
      },
      // Prefer the user's override link as the destination when they gave one.
      formUrl: customAgencyUrl ?? agency.intakeUrl,
      customAgencyUrl,
      fields,
    });
  } catch (error) {
    console.error("Submission fields error:", error);
    return errorResponse("Failed to build submission fields.", 500);
  }
}
