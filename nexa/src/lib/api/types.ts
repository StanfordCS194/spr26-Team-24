/**
 * Shared API request/response contract types.
 *
 * These describe the over-the-wire shapes that route handlers produce and
 * client consumers (hooks/components) read back. Centralizing them here keeps
 * the two sides from drifting: a contract change is made once and both the
 * server and the client pick it up. Types are named `RouteNameResponse` /
 * `RouteNameRequest` after the endpoint they describe.
 *
 * Note: classification contract types (`ClassificationResult`,
 * `ProviderResult`, `ComparisonResult`) live in `@/lib/classify/types` — the
 * runtime-validated source of truth the classify route already returns. Import
 * them from there; do not re-declare them.
 */

/** Confidence band shared by the official-form lookup contract. */
export type FormLookupConfidence = "low" | "medium" | "high";

/**
 * One agency the report could be filed with, as surfaced to the user when
 * routing is ambiguous (a single location + issue type is covered by more than
 * one agency — e.g. Menlo Park's web-form desk vs. its Open311 API). Carries the
 * minimum a person needs to tell the candidates apart: who they are, the
 * jurisdiction they serve, and how Nexa would file with them.
 */
export type AgencyCandidate = {
  id: string;
  name: string;
  jurisdiction: string;
  intakeMethod: "API" | "WEB_FORM" | "EMAIL" | "PHONE";
};

/**
 * `POST /api/reports/agency-candidates` response payload. `agencyId` is the
 * confident single match (mirrors `resolveAgencyId`) and is null when routing is
 * ambiguous or unresolved. `candidates` lists every agency that covers the
 * location + issue type; when `candidates.length > 1` the match is ambiguous and
 * the UI prompts the user to pick one (using `disambiguation` as the question).
 */
export type AgencyCandidatesResult = {
  agencyId: string | null;
  candidates: AgencyCandidate[];
  /** Short human prompt shown when ambiguous; null when there's nothing to ask. */
  disambiguation: string | null;
};

/**
 * `POST /api/reports/form-link` response payload (the `data` of the success
 * envelope). Either an official city form was located, or none was found (with
 * a human-readable reason). This is the single definition consumed by the route
 * handler that produces it and the hook/component that render it.
 */
export type OfficialFormLookupResult =
  | {
      status: "found";
      cityName: string;
      formUrl: string;
      reason: string;
      confidence: FormLookupConfidence;
    }
  | {
      status: "not_found";
      cityName: string | null;
      message: string;
      reason?: string;
    };
