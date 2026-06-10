import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PushSubscribeSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";

// POST /api/push/subscribe — store a browser Web Push subscription (issue #38).
//
// The browser creates the subscription via PushManager.subscribe() and POSTs
// its JSON here. We upsert on the unique `endpoint` so re-subscribing the same
// browser refreshes its keys (and re-attaches the current user) instead of
// piling up duplicate rows.
//
// `userId` is taken from the session when present and stored nullable, so a
// guest can still subscribe; a later account claim can attach the row. This is
// complementary to the email path — it never replaces it.
export async function POST(request: NextRequest) {
  try {
    const { endpoint, keys } = await parseJsonRequest(
      request,
      PushSubscribeSchema,
    );

    const session = await getSession();
    const userId = session?.userId ?? null;

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId,
      },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId,
      },
    });

    return successResponse({ subscribed: true }, 201);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Push subscribe error:", error);
    return errorResponse("Failed to save push subscription.", 500);
  }
}
