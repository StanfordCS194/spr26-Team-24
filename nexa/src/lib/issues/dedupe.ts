import { prisma } from "@/lib/prisma";
import type { IssueType } from "@/generated/prisma/enums";

// Two reports of the same issue type whose locations fall within this radius are
// treated as the same real-world problem and merged into one IssueGroup.
export const DEDUPE_RADIUS_METERS = 75;

// Mean Earth radius — used by the haversine distance below.
const EARTH_RADIUS_METERS = 6_371_000;

// Approximate metres per degree of latitude (constant); longitude is scaled by
// the cosine of the latitude in the bounding-box prefilter.
const METERS_PER_DEGREE_LAT = 111_320;

// Groups in a terminal state are closed cases — new reports should never attach
// to them, they start a fresh group instead.
const TERMINAL_STATUSES = ["RESOLVED", "CLOSED"] as const;

/** Great-circle distance between two lat/long points, in metres. */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface FindOrCreateArgs {
  issueType?: IssueType | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Finds the IssueGroup a new report belongs to (same issue type, nearby
 * location, still open) or creates a fresh one seeded from the report.
 *
 * The lookup prefilters candidate groups with a lat/long bounding box and then
 * refines with a true haversine distance, picking the closest group within
 * {@link DEDUPE_RADIUS_METERS}. On a match the group's centroid is recomputed as
 * a running average and its reportCount incremented (both account for the
 * about-to-be-created report). Returns the group id, or null when the report
 * lacks a location or issue type and therefore can't be grouped.
 */
export async function findOrCreateIssueGroup(
  args: FindOrCreateArgs,
): Promise<string | null> {
  const { issueType, latitude, longitude } = args;

  if (
    !issueType ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  // Bounding-box prefilter: a small box around the report keeps the candidate
  // set tiny before the exact haversine refinement.
  const latDelta = DEDUPE_RADIUS_METERS / METERS_PER_DEGREE_LAT;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const lonDelta =
    DEDUPE_RADIUS_METERS /
    (METERS_PER_DEGREE_LAT * Math.max(Math.abs(cosLat), 1e-6));

  const candidates = await prisma.issueGroup.findMany({
    where: {
      issueType,
      status: { notIn: [...TERMINAL_STATUSES] },
      latitude: { gte: latitude - latDelta, lte: latitude + latDelta },
      longitude: { gte: longitude - lonDelta, lte: longitude + lonDelta },
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      reportCount: true,
    },
  });

  let best: {
    id: string;
    reportCount: number;
    lat: number;
    lon: number;
  } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = haversineMeters(
      latitude,
      longitude,
      candidate.latitude,
      candidate.longitude,
    );
    if (distance <= DEDUPE_RADIUS_METERS && distance < bestDistance) {
      best = {
        id: candidate.id,
        reportCount: candidate.reportCount,
        lat: candidate.latitude,
        lon: candidate.longitude,
      };
      bestDistance = distance;
    }
  }

  if (best) {
    // Recompute the centroid as a running average that folds in the new report.
    const nextCount = best.reportCount + 1;
    const nextLat = (best.lat * best.reportCount + latitude) / nextCount;
    const nextLon = (best.lon * best.reportCount + longitude) / nextCount;

    await prisma.issueGroup.update({
      where: { id: best.id },
      data: {
        latitude: nextLat,
        longitude: nextLon,
        reportCount: nextCount,
      },
    });
    return best.id;
  }

  const created = await prisma.issueGroup.create({
    data: {
      issueType,
      latitude,
      longitude,
      status: "CONFIRMED",
      reportCount: 1,
    },
    select: { id: true },
  });
  return created.id;
}
