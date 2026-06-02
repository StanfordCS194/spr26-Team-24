import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getIssueMapPoints } from "@/lib/issues/map";

/**
 * Aggregated community issue map: every IssueGroup as a single pin, regardless
 * of who filed the underlying reports. Requires a session (matches the
 * dashboard's login-gated access).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const points = await getIssueMapPoints(session.userId);
  return NextResponse.json({ points });
}
