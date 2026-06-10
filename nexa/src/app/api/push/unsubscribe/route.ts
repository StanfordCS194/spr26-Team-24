import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PushUnsubscribeSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";

// POST /api/push/unsubscribe — drop a stored Web Push subscription (issue #38).
//
// Called when the user opts out (or the browser revokes the subscription).
// Keyed on the unique `endpoint`; idempotent — deleting an unknown endpoint
// still returns success so the client can fire-and-forget.
export async function POST(request: NextRequest) {
  try {
    const { endpoint } = await parseJsonRequest(request, PushUnsubscribeSchema);

    await prisma.pushSubscription.deleteMany({ where: { endpoint } });

    return successResponse({ unsubscribed: true });
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Push unsubscribe error:", error);
    return errorResponse("Failed to remove push subscription.", 500);
  }
}
