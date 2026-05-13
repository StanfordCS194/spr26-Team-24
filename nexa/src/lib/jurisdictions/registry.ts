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
      // Stanford runs its own infrastructure on campus. LBRE handles
      // facilities/streetlights/sidewalks; SUDPS handles non-emergency safety.
      default: {
        url: "https://lbre.stanford.edu/",
        reason:
          "Stanford campus is private university land; Land, Buildings & Real Estate manages on-campus infrastructure.",
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
        url: "https://www.menlopark.gov/Government/Departments/Public-Works/Report-a-concern",
        reason: "Menlo Park's official Report-a-Concern page.",
        confidence: "medium",
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
    endpoints: {
      // URL not yet verified — let the LLM lookup handle it for now.
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

export function getPortal(
  jurisdictionId: JurisdictionId,
  issueType: string,
) {
  const jurisdiction = JURISDICTIONS[jurisdictionId];
  if (!jurisdiction) return null;
  const issueSpecific =
    jurisdiction.endpoints[issueType as keyof typeof jurisdiction.endpoints];
  if (issueSpecific !== undefined) return issueSpecific;
  return jurisdiction.endpoints.default ?? null;
}
