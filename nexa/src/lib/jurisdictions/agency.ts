import { prisma } from "@/lib/prisma";
import type { IssueType } from "@/generated/prisma/enums";
import { resolveJurisdiction } from "./resolve";
import type { JurisdictionId } from "./types";

// Some matched jurisdictions have no agency of their own and are served by a
// neighboring one. Stanford campus is unincorporated and has no public 311, so
// its civic issues are handled by Palo Alto (mirrors the portal routing in
// ./registry.ts).
const AGENCY_FALLBACKS: Partial<Record<JurisdictionId, JurisdictionId[]>> = {
  "stanford-campus": ["city-palo-alto"],
};

/**
 * Resolves the Agency a report should be filed with, based on its location and
 * issue type. This is the link between the polygon routing engine
 * (`resolveJurisdiction`) and the seeded Agency records that the submission
 * pipeline needs.
 *
 * Returns the agency id, or null when there is no location/issue type or no
 * agency covers that jurisdiction + issue type.
 */
export async function resolveAgencyId(args: {
  latitude?: number | null;
  longitude?: number | null;
  issueType?: IssueType | null;
}): Promise<string | null> {
  const { latitude, longitude, issueType } = args;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !issueType
  ) {
    return null;
  }

  const match = resolveJurisdiction(latitude, longitude, issueType);
  if (!match) return null;

  // Try the matched jurisdiction first, then any fallback jurisdictions.
  const candidates: JurisdictionId[] = [
    match.jurisdiction.id,
    ...(AGENCY_FALLBACKS[match.jurisdiction.id] ?? []),
  ];

  for (const jurisdiction of candidates) {
    const agency = await prisma.agency.findFirst({
      where: { jurisdiction, issueTypes: { has: issueType } },
      select: { id: true },
    });
    if (agency) return agency.id;
  }

  return null;
}
