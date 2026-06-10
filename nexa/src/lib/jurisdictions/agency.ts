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
 * The outcome of resolving which agency a report should be filed with.
 *
 * - `agencyId` is set only when exactly one agency confidently covers the
 *   report's jurisdiction + issue type. It is null when nothing matches OR when
 *   the match is ambiguous (more than one agency covers it) — ambiguity
 *   resolution is a separate concern and is left to a future caller.
 * - `candidates` lists every agency id that covers the jurisdiction + issue
 *   type (in the tier that produced the matches), so that downstream ambiguity
 *   handling has the full set to choose from.
 */
export type AgencyResolution = {
  agencyId: string | null;
  candidates: string[];
};

/** No confident agency match (no input, no jurisdiction, no coverage, or ambiguous). */
const UNRESOLVED: AgencyResolution = { agencyId: null, candidates: [] };

/**
 * Resolves the Agency a report should be filed with, based on its location and
 * issue type. This is the link between the polygon routing engine
 * (`resolveJurisdiction`) and the seeded Agency records that the submission
 * pipeline needs.
 *
 * Returns a single confident `agencyId` (with the full `candidates` list) when
 * exactly one agency covers the jurisdiction + issue type. Returns
 * `agencyId: null` when there is no location/issue type, no jurisdiction match,
 * no agency covers it, or the match is ambiguous (multiple candidates).
 */
export async function resolveAgencyId(args: {
  latitude?: number | null;
  longitude?: number | null;
  issueType?: IssueType | null;
}): Promise<AgencyResolution> {
  const { latitude, longitude, issueType } = args;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !issueType
  ) {
    return UNRESOLVED;
  }

  const match = resolveJurisdiction(latitude, longitude, issueType);
  if (!match) return UNRESOLVED;

  // Try the matched jurisdiction first, then any fallback jurisdictions. We use
  // the first jurisdiction tier that yields any agency so that a fallback only
  // applies when the primary jurisdiction has no coverage at all.
  const jurisdictions: JurisdictionId[] = [
    match.jurisdiction.id,
    ...(AGENCY_FALLBACKS[match.jurisdiction.id] ?? []),
  ];

  for (const jurisdiction of jurisdictions) {
    const agencies = await prisma.agency.findMany({
      where: { jurisdiction, issueTypes: { has: issueType } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (agencies.length === 0) continue;

    const candidates = agencies.map((a) => a.id);
    // Only a single, unambiguous match becomes the report's agency. Multiple
    // candidates are surfaced for future ambiguity handling but do not get
    // auto-assigned here.
    return {
      agencyId: candidates.length === 1 ? candidates[0] : null,
      candidates,
    };
  }

  return UNRESOLVED;
}
