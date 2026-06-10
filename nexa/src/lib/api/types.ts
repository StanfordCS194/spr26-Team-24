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
