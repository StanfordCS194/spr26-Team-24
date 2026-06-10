import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/health
//
// Liveness + readiness probe (issue #108). Beyond reporting that the process is
// up, this actually verifies the database is reachable by running a cheap
// `SELECT 1`, so an external monitor (e.g. Vercel/UptimeRobot) can distinguish a
// healthy app from one whose DB is unreachable.
//
// Returns 200 with `{ status: "ok", database: "ok" }` when the DB responds, and
// 503 with `{ status: "error", database: "unreachable" }` when it does not.

// Bound the probe so a hung connection can't make the health check itself hang.
const DB_PROBE_TIMEOUT_MS = 5_000;

export async function GET() {
  const dbOk = await checkDatabase();

  if (!dbOk) {
    return NextResponse.json(
      { status: "error", database: "unreachable" },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "ok", database: "ok" });
}

/**
 * Run a lightweight `SELECT 1` against the database, bounded by a timeout.
 * Returns `true` only if the query resolves before the deadline; any error or
 * timeout returns `false` (and logs a recognizable prefix for monitors).
 */
async function checkDatabase(): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`DB probe timed out after ${DB_PROBE_TIMEOUT_MS}ms`),
            ),
          DB_PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
    return true;
  } catch (error) {
    // Recognizable prefix so an external log monitor can alert on it.
    console.error("[health] DB probe failed:", error);
    return false;
  }
}
