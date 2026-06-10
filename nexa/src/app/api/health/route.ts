import { errorResponse, successResponse } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

// GET /api/health
//
// Liveness + readiness probe (issue #108). Beyond reporting that the process is
// up, this actually verifies the database is reachable by running a cheap
// `SELECT 1`, so an external monitor (e.g. Vercel/UptimeRobot) can distinguish a
// healthy app from one whose DB is unreachable.
//
// Returns 200 `{ success: true, data: { status: "ok", database: "ok" } }` when
// the DB responds, and 503 `{ success: false, error, code: "db_unreachable" }`
// when it does not.

// Bound the probe so a hung connection can't make the health check itself hang.
const DB_PROBE_TIMEOUT_MS = 5_000;

export async function GET() {
  const dbOk = await checkDatabase();

  if (!dbOk) {
    return errorResponse("Database unreachable", 503, "db_unreachable");
  }

  return successResponse({ status: "ok", database: "ok" });
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
