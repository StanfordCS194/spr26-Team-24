import { NextRequest } from "next/server";
import { resolveAgencyCandidates } from "@/lib/jurisdictions/agency";
import { AgencyCandidatesRequestSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";
import type { AgencyCandidatesResult } from "@/lib/api/types";

/**
 * Resolves the candidate agencies for a report's location + issue type so the
 * review step can let the user disambiguate when more than one agency covers the
 * same spot (e.g. Menlo Park's web-form desk vs. its Open311 API). Reuses
 * `resolveAgencyCandidates` (which wraps `resolveAgencyId`) — it does not
 * reimplement routing. Returns the confident `agencyId` (null when ambiguous),
 * the candidate details, and a disambiguating question when ambiguous.
 */
export async function POST(request: NextRequest) {
  try {
    const { issueType, latitude, longitude } = await parseJsonRequest(
      request,
      AgencyCandidatesRequestSchema,
    );

    const result: AgencyCandidatesResult = await resolveAgencyCandidates({
      latitude,
      longitude,
      issueType: issueType ?? null,
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Agency candidates lookup error:", error);
    return errorResponse("Failed to resolve agency candidates.", 500);
  }
}
