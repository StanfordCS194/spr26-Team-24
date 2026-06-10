import type { Jurisdiction, JurisdictionId } from "./types";

// Entries with a `null` endpoint mean "polygon matches but we have not verified
// the official portal URL." The resolver will report the jurisdiction match but
// callers fall back to the LLM lookup for the actual URL.
//
// Polygon boundary data lives in ./boundaries.geojson and is keyed by the same
// jurisdictionId — keep these two files in sync.

export const JURISDICTIONS: Record<JurisdictionId, Jurisdiction> = {
  "stanford-campus": {
    id: "stanford-campus",
    displayName: "Stanford University",
    endpoints: {
      // Stanford campus is unincorporated and has no public 311 of its own.
      // Existing app convention (see 94305 → Palo Alto in the postcode hint
      // table) routes Stanford-area civic issues to Palo Alto 311; Palo Alto
      // forwards or returns issues that fall outside its jurisdiction.
      default: {
        url: "https://www.paloalto.gov/Residents/Services/Report-an-Issue/Palo-Alto-311",
        reason:
          "Stanford campus has no public 311; Palo Alto 311 is the closest civic reporting portal for Stanford-area issues.",
        confidence: "medium",
      },
    },
  },

  "city-palo-alto": {
    id: "city-palo-alto",
    displayName: "Palo Alto",
    endpoints: {
      default: {
        url: "https://www.paloalto.gov/Residents/Services/Report-an-Issue/Palo-Alto-311",
        reason: "Palo Alto 311 is the city's unified report-an-issue portal.",
        confidence: "high",
      },
    },
  },

  "city-menlo-park": {
    id: "city-menlo-park",
    displayName: "Menlo Park",
    endpoints: {
      default: {
        url: "https://www.menlopark.gov/Services/ACT-Menlo-Park",
        reason: "Menlo Park's official Report-a-Concern page.",
        confidence: "high",
      },
    },
  },

  "city-mountain-view": {
    id: "city-mountain-view",
    displayName: "Mountain View",
    endpoints: {
      default: {
        url: "https://www.mountainview.gov/our-city/departments/public-works",
        reason: "Mountain View Public Works handles civic service requests.",
        confidence: "low",
      },
    },
  },

  "city-east-palo-alto": {
    id: "city-east-palo-alto",
    displayName: "East Palo Alto",
    // Issue-type-specific intake (issues #195/#198): East Palo Alto splits its
    // intake by program, so we route per issue type rather than via a single
    // `default`. These mirror the seeded agencies in prisma/agencies.ts.
    endpoints: {
      // EPA Public Works handles road damage via the city contact web form
      // (verified per issue #23 agency-research comment, 2026-06-09).
      ROAD_DAMAGE: {
        url: "https://www.cityofepa.org/contact",
        reason:
          "East Palo Alto Public Works handles road maintenance; the city contact form is the verified intake (maintenance@cityofepa.org is the staff fallback).",
        confidence: "medium",
      },
      // EPA Clean City handles illegal dumping; its verified channel is email
      // (cleancity@cityofepa.org) plus the city line (650) 853-3100. There is no
      // verified web form, so we surface the general city contact page as the
      // best web entry point and keep confidence medium.
      ILLEGAL_DUMPING: {
        url: "https://www.cityofepa.org/contact",
        reason:
          "East Palo Alto Clean City handles illegal dumping via cleancity@cityofepa.org / (650) 853-3100; the city contact page is the web entry point.",
        confidence: "medium",
      },
      // Other issue types (e.g. streetlights) have no verified EPA intake yet —
      // leave the default null so callers fall through to the LLM lookup.
      default: null,
    },
  },

  "county-santa-clara-unincorporated": {
    id: "county-santa-clara-unincorporated",
    displayName: "Santa Clara County (unincorporated)",
    endpoints: {
      default: {
        url: "https://publicworks.sccgov.org/services/road-maintenance/report-problem",
        reason:
          "Santa Clara County Public Works handles roads & infrastructure in unincorporated areas.",
        confidence: "medium",
      },
    },
  },
};

export function getPortal(jurisdictionId: JurisdictionId, issueType: string) {
  const jurisdiction = JURISDICTIONS[jurisdictionId];
  if (!jurisdiction) return null;
  const issueSpecific =
    jurisdiction.endpoints[issueType as keyof typeof jurisdiction.endpoints];
  if (issueSpecific !== undefined) return issueSpecific;
  return jurisdiction.endpoints.default ?? null;
}
