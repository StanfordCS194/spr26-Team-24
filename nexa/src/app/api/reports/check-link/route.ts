import { NextRequest } from "next/server";
import { CheckLinkRequestSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { checkSubmittableLink } from "@/lib/submission/link-check";
import type { LinkCheckResult } from "@/lib/api/types";

/**
 * `POST /api/reports/check-link` — given a user-supplied custom agency link
 * (the "Filing somewhere else?" override on the review step), report whether it
 * points at a submittable form. Mirrors the form-link route's posture: no auth
 * (the report flow itself is anonymous-friendly), the shared per-IP rate limit
 * (this route fans out a third-party fetch and is otherwise trivially abusable),
 * zod-validated body, and the standard success/error envelope.
 *
 * The detection itself never throws (see {@link checkSubmittableLink}); a 500 is
 * therefore reserved for genuinely unexpected route-level failures.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request.headers);
    if (limited) return limited;

    const { url } = await parseJsonRequest(request, CheckLinkRequestSchema);

    const result: LinkCheckResult = await checkSubmittableLink(url);
    return successResponse(result);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Custom-link check error:", error);
    return errorResponse("Failed to check the link.", 500);
  }
}
