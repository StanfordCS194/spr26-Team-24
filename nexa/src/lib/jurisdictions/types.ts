import type { IssueType } from "@/generated/prisma/enums";

export type Confidence = "low" | "medium" | "high";

export type JurisdictionId =
  | "stanford-campus"
  | "city-palo-alto"
  | "city-menlo-park"
  | "city-mountain-view"
  | "city-east-palo-alto"
  | "county-santa-clara-unincorporated";

export type Jurisdiction = {
  id: JurisdictionId;
  displayName: string;
  // Per-issue-type endpoint. `default` is used when no issue-specific URL exists.
  // A `null` URL means "we matched the polygon but don't have a verified portal" —
  // callers should fall through to the LLM lookup.
  endpoints: Partial<Record<IssueType | "default", PortalEntry | null>>;
};

export type PortalEntry = {
  url: string;
  // Why we trust this URL. Shown to the user.
  reason: string;
  confidence: Confidence;
};

export type JurisdictionMatch = {
  jurisdiction: Jurisdiction;
  portal: PortalEntry | null;
};
