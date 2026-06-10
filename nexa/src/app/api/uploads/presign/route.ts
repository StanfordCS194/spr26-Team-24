import { NextRequest } from "next/server";
import { PresignUploadSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createPresignedUpload, isStorageConfigured } from "@/lib/storage";

// POST /api/uploads/presign — hand the client a presigned PUT URL so it can
// upload a (client-resized) report image straight to S3/R2, then submit the
// resulting public object URL as `Report.imageUrl` (issue #30).
//
// ENV-GATED, SAFE FALLBACK: when storage is not configured this returns a
// success envelope with `{ configured: false }` (HTTP 200) rather than an
// error, so the client cleanly falls back to the existing inline base64 path.
// The app therefore runs fine without any S3 credentials.
//
// Auth-aware like the other report routes: a session is used when present but
// not required (guests can report). Rate-limited per IP because presigning is
// an outbound AWS call and the route takes no auth.
export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(request.headers);
    if (limited) return limited;

    const { contentType } = await parseJsonRequest(
      request,
      PresignUploadSchema,
    );

    // Not configured → tell the client to fall back to inline base64. This is a
    // success, not an error: the absence of storage is an expected mode.
    if (!isStorageConfigured()) {
      return successResponse({ configured: false } as const);
    }

    const presigned = await createPresignedUpload(contentType);
    if (!presigned) {
      // Defensive: `isStorageConfigured()` was true, so this should not happen.
      return successResponse({ configured: false } as const);
    }

    return successResponse({
      configured: true,
      uploadUrl: presigned.uploadUrl,
      objectUrl: presigned.objectUrl,
      contentType: presigned.contentType,
    } as const);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("[uploads/presign] Unexpected error:", error);
    return errorResponse("Could not prepare an upload. Please try again.", 500);
  }
}
