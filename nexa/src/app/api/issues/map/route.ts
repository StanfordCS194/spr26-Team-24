import { getSession } from "@/lib/auth";
import { getIssueMapPoints } from "@/lib/issues/map";
import { successResponse, errorResponse } from "@/lib/api/response";

/**
 * Aggregated community issue map: every IssueGroup as a single pin, regardless
 * of who filed the underlying reports. Requires a session (matches the
 * dashboard's login-gated access).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return errorResponse("Not authenticated.", 401);
  }

  const points = await getIssueMapPoints(session.userId);
  return successResponse({ points });
}
