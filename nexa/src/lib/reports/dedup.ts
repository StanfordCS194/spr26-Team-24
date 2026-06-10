import { prisma } from "@/lib/prisma";
import { haversineMeters } from "@/lib/issues/dedupe";
import {
  getDuplicateRadiusMeters,
  getDuplicateWindowHours,
} from "@/lib/config";
import type { IssueType } from "@/generated/prisma/enums";

// Approximate metres per degree of latitude (constant); longitude is scaled by
// the cosine of the latitude in the bounding-box prefilter. Mirrors the
// constant used by the IssueGroup dedupe so both lookups behave consistently.
const METERS_PER_DEGREE_LAT = 111_320;

interface FindDuplicateArgs {
  /** The reporter, or null for an anonymous (guest) submission. */
  userId?: string | null;
  issueType?: IssueType | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface DuplicateMatch {
  /** Id of the existing report this submission duplicates. */
  reportId: string;
  /** Distance (metres) between the two reports. */
  distanceMeters: number;
}

/**
 * Looks for an existing report that the incoming submission likely duplicates:
 * the same issue type, a near-identical location (within the configured
 * radius), filed within the recent time window. For a signed-in reporter the
 * match is additionally scoped to their own reports (a user re-filing the same
 * issue); anonymous submissions (`userId == null`) fall back to a pure
 * location + type heuristic across all reporters, since we have no stable guest
 * identity to key on.
 *
 * This deliberately reuses {@link haversineMeters} from the IssueGroup dedupe
 * rather than rolling a second distance metric. The two features are distinct:
 * IssueGroup *merges* distinct people's reports of one real-world problem into a
 * shared case; this guards against one reporter filing the *same* report twice.
 *
 * Returns the closest match within the radius, or null when none is found (and
 * therefore when the report has no location or issue type to compare on).
 */
export async function findDuplicateReport(
  args: FindDuplicateArgs,
): Promise<DuplicateMatch | null> {
  const { userId, issueType, latitude, longitude } = args;

  if (
    !issueType ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  const radiusMeters = getDuplicateRadiusMeters();
  const windowHours = getDuplicateWindowHours();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Bounding-box prefilter keeps the candidate set tiny before the exact
  // haversine refinement; identical approach to the IssueGroup lookup.
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const lonDelta =
    radiusMeters / (METERS_PER_DEGREE_LAT * Math.max(Math.abs(cosLat), 1e-6));

  const candidates = await prisma.report.findMany({
    where: {
      issueType,
      // Scope to the reporter when signed in; anonymous reports rely on the
      // location + type heuristic alone.
      ...(userId ? { userId } : {}),
      createdAt: { gte: since },
      latitude: { gte: latitude - latDelta, lte: latitude + latDelta },
      longitude: { gte: longitude - lonDelta, lte: longitude + lonDelta },
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
    },
  });

  let best: DuplicateMatch | null = null;

  for (const candidate of candidates) {
    if (
      typeof candidate.latitude !== "number" ||
      typeof candidate.longitude !== "number"
    ) {
      continue;
    }
    const distance = haversineMeters(
      latitude,
      longitude,
      candidate.latitude,
      candidate.longitude,
    );
    if (
      distance <= radiusMeters &&
      (best === null || distance < best.distanceMeters)
    ) {
      best = { reportId: candidate.id, distanceMeters: distance };
    }
  }

  return best;
}
