import { IssueType } from "@/generated/prisma/enums";
import { ReportStatus } from "@/generated/prisma/enums";
import {
  fetchWithTimeout,
  withRetry,
  TimeoutError,
  isTransientError,
  DEFAULT_HTTP_TIMEOUT_MS,
} from "@/lib/http";

// A POST to Open311 is NOT idempotent: a request that the endpoint already
// accepted but whose response we lost (timeout, dropped connection mid-reply)
// could file a duplicate ticket if we blindly retried. So submit retries ONLY
// on errors that prove the request never reached the server — connection
// refused / DNS failure before any bytes were sent. A timeout is treated as
// terminal precisely because the request may already have been accepted.
const CONNECTION_ONLY_RETRY_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function isPreRequestConnectionError(error: unknown): boolean {
  if (error instanceof TimeoutError) return false;
  const code =
    (error as { code?: unknown })?.code ??
    (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === "string" && CONNECTION_ONLY_RETRY_CODES.has(code);
}

// GET status polling IS idempotent, so it retries any transient failure plus
// 5xx responses. A sentinel error lets us funnel a retryable 5xx through the
// same withRetry path as a thrown network error.
class RetryableHttpError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number) {
    super(`Open311 endpoint returned HTTP ${httpStatus}.`);
    this.name = "RetryableHttpError";
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Open311 GeoReport v2 client
//
// GeoReport v2 is the open standard most US 311 systems expose
// (https://wiki.open311.org/GeoReport_v2/). It is a small REST API:
//   - POST {endpoint}/requests.json   — file a new service request
//   - GET  {endpoint}/requests/{id}.json — read the status of a request
//
// Two pieces are jurisdiction-specific and therefore configured per Agency
// (see `Open311Config` below), never hard-coded here:
//   1. `service_code` — every agency publishes its own taxonomy of codes, so we
//      map our internal IssueType enum onto theirs.
//   2. `api_key` — many production endpoints require one to POST.
// ---------------------------------------------------------------------------

/**
 * Per-agency Open311 configuration. We store this on `Agency.requiredFields`
 * (a Json column) under the `open311` key, and use `Agency.intakeUrl` as the
 * base endpoint. Keeping it data-driven means onboarding a new Open311 city is
 * a DB row, not a code change.
 */
export type Open311Config = {
  // Base endpoint, e.g. "https://sandbox.open311.org/v2". Falls back to the
  // agency's `intakeUrl` when omitted.
  endpoint?: string;
  // API key required by some jurisdictions to POST a request.
  apiKey?: string;
  // GeoReport `jurisdiction_id` query param — only needed on multi-tenant
  // endpoints that host more than one city.
  jurisdictionId?: string;
  // Override the default IssueType -> service_code mapping for this agency.
  serviceCodes?: Partial<Record<IssueType, string>>;
};

/**
 * Best-effort default mapping from our taxonomy to common Open311 service
 * codes. Real codes vary by city, so an agency that publishes its own codes
 * should override these via `Open311Config.serviceCodes`. The strings here
 * mirror the human-readable codes used by the Open311 reference sandbox and the
 * widely-cloned SeeClickFix taxonomy.
 *
 * Partial by design: the taxonomy has more issue types than we have verified
 * default service codes for. A type with no default here resolves to a null
 * service code (see `resolveServiceCode`), so the report falls back to
 * manual/no-agency handling rather than being filed under the wrong code.
 * Filling in codes for the newer types is tracked as routing follow-up work.
 */
const DEFAULT_SERVICE_CODES: Partial<Record<IssueType, string>> = {
  [IssueType.ROAD_DAMAGE]: "POTHOLES",
  [IssueType.STREETLIGHT_OUTAGE]: "STREETLIGHTS",
  [IssueType.ILLEGAL_DUMPING]: "ILLEGALDUMPING",
  [IssueType.VEHICLE_EMISSIONS]: "AIRQUALITY",
  [IssueType.OTHER]: "OTHER",
};

/**
 * Resolves the Open311 `service_code` for a report's issue type, preferring the
 * agency's own mapping and falling back to the generic defaults. Returns null
 * for an unknown/absent issue type so callers can refuse to submit rather than
 * file under the wrong code.
 */
export function resolveServiceCode(
  issueType: IssueType | null | undefined,
  config: Open311Config | undefined,
): string | null {
  if (!issueType) return null;
  return (
    config?.serviceCodes?.[issueType] ??
    DEFAULT_SERVICE_CODES[issueType] ??
    null
  );
}

/** The subset of a Report this client needs to file a request. */
export type SubmittableReport = {
  issueType: IssueType | null;
  description: string | null;
  aiDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
};

/**
 * Builds the application/x-www-form-urlencoded body for POST /requests, per the
 * GeoReport v2 spec. Either a lat/long pair or an address_string is required;
 * we send whichever the report has (both, when available).
 */
export function buildRequestParams(
  report: SubmittableReport,
  serviceCode: string,
  config: Open311Config | undefined,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("service_code", serviceCode);

  // Prefer the citizen's own words; fall back to the AI-generated summary.
  const description =
    report.description?.trim() || report.aiDescription?.trim();
  if (description) params.set("description", description);

  if (
    typeof report.latitude === "number" &&
    typeof report.longitude === "number"
  ) {
    params.set("lat", String(report.latitude));
    params.set("long", String(report.longitude));
  }
  if (report.address?.trim()) {
    params.set("address_string", report.address.trim());
  }

  if (config?.apiKey) params.set("api_key", config.apiKey);
  if (config?.jurisdictionId)
    params.set("jurisdiction_id", config.jurisdictionId);

  return params;
}

/** Discriminated result of a submission attempt — never throws to callers. */
export type SubmitResult =
  | {
      status: "submitted";
      // GeoReport returns either an immediate service_request_id or, for
      // queued requests, a `token` the caller can later exchange for the id.
      serviceRequestId: string | null;
      token: string | null;
    }
  | {
      status: "error";
      // HTTP status when the failure came from the endpoint, else null.
      httpStatus: number | null;
      message: string;
    };

/** Trims a config-or-agency endpoint into a clean base with no trailing slash. */
function resolveEndpoint(
  config: Open311Config | undefined,
  intakeUrl: string | null | undefined,
): string | null {
  const raw = config?.endpoint ?? intakeUrl ?? null;
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

// Multi-tenant Open311 hosts serve many cities behind one base endpoint and key
// every write on a `jurisdiction_id`; POSTing without one 404s. SeeClickFix is
// the canonical example (and the provider behind every seeded API agency). We
// match its hostname so we can tell, BEFORE attempting the POST, whether an
// agency's config is complete enough to actually auto-file. Single-tenant
// endpoints (e.g. a city's own GeoReport server) don't need a jurisdiction_id,
// so they remain auto-fileable without one.
const MULTI_TENANT_OPEN311_HOSTS = new Set([
  "seeclickfix.com",
  "int.seeclickfix.com",
]);

function endpointRequiresJurisdictionId(endpoint: string): boolean {
  try {
    return MULTI_TENANT_OPEN311_HOSTS.has(new URL(endpoint).hostname);
  } catch {
    // An unparseable endpoint can't be matched to a known multi-tenant host;
    // treat it as not-requiring (submitToOpen311 will surface any real failure).
    return false;
  }
}

/**
 * Whether an API agency's Open311 config is complete enough to actually auto-
 * file a request, used by the orchestrator to short-circuit un-fileable agencies
 * straight to manual-assist instead of attempting a doomed POST (issue #250).
 *
 * "Can auto-file" means BOTH:
 *   1. a usable base endpoint resolves (from `config.endpoint` or the agency's
 *      `intakeUrl`), and
 *   2. if that endpoint is a multi-tenant host (SeeClickFix) whose write path
 *      keys on `jurisdiction_id`, the config supplies a `jurisdictionId`.
 *
 * Most seeded SeeClickFix agencies omit `jurisdictionId` (it's an internal org
 * id not available via the public API — see issue #239), so they return false
 * here and the orchestrator degrades them to manual-assist with their intakeUrl.
 * A single-tenant endpoint, or a SeeClickFix agency that has been given a real
 * `jurisdictionId`, returns true and still auto-files.
 */
export function canAutoFileOpen311(
  config: Open311Config | undefined,
  intakeUrl: string | null | undefined,
): boolean {
  const endpoint = resolveEndpoint(config, intakeUrl);
  if (!endpoint) return false;
  if (endpointRequiresJurisdictionId(endpoint)) {
    return Boolean(config?.jurisdictionId);
  }
  return true;
}

/**
 * Files a new service request with an Open311 GeoReport v2 endpoint.
 *
 * The `fetchImpl` parameter exists for testing — pass a stub to exercise the
 * request-building and response-parsing logic without a live endpoint.
 */
export async function submitToOpen311(
  report: SubmittableReport,
  options: {
    config: Open311Config | undefined;
    intakeUrl: string | null | undefined;
    fetchImpl?: typeof fetch;
  },
): Promise<SubmitResult> {
  const endpoint = resolveEndpoint(options.config, options.intakeUrl);
  if (!endpoint) {
    return {
      status: "error",
      httpStatus: null,
      message: "No Open311 endpoint configured for this agency.",
    };
  }

  const serviceCode = resolveServiceCode(report.issueType, options.config);
  if (!serviceCode) {
    return {
      status: "error",
      httpStatus: null,
      message: "No Open311 service code maps to this report's issue type.",
    };
  }

  const params = buildRequestParams(report, serviceCode, options.config);
  // A custom fetchImpl (tests) is used verbatim; otherwise fetchWithTimeout
  // gives the POST a bounded deadline so a hung endpoint can't stall the route.
  const doFetch =
    options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchWithTimeout(input, {
        ...init,
        timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
      }));

  let response: Response;
  try {
    response = await withRetry(
      () =>
        doFetch(`${endpoint}/requests.json`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        }),
      {
        attempts: 2,
        // Retry ONLY when the request provably never reached the server, never
        // after a timeout or any HTTP response — avoids duplicate filings.
        shouldRetry: isPreRequestConnectionError,
      },
    );
  } catch (error) {
    return {
      status: "error",
      httpStatus: null,
      message:
        error instanceof TimeoutError
          ? "Open311 endpoint timed out."
          : error instanceof Error
            ? error.message
            : "Network error contacting Open311 endpoint.",
    };
  }

  if (!response.ok) {
    // GeoReport error bodies are an array of { code, description }.
    const detail = await readErrorDescription(response);
    return {
      status: "error",
      httpStatus: response.status,
      message: detail ?? `Open311 endpoint returned HTTP ${response.status}.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: "error",
      httpStatus: response.status,
      message: "Open311 response was not valid JSON.",
    };
  }

  // A successful POST returns a single-element array of { service_request_id }
  // or { token }.
  const first = Array.isArray(body) ? body[0] : body;
  const record = (first ?? {}) as {
    service_request_id?: unknown;
    token?: unknown;
  };
  const serviceRequestId = stringOrNull(record.service_request_id);
  const token = stringOrNull(record.token);

  if (!serviceRequestId && !token) {
    return {
      status: "error",
      httpStatus: response.status,
      message: "Open311 response contained no service_request_id or token.",
    };
  }

  return { status: "submitted", serviceRequestId, token };
}

/** Discriminated result of a status poll. */
export type StatusResult =
  | {
      status: "ok";
      open311Status: string;
      reportStatus: ReportStatus | null;
      statusNotes: string | null;
    }
  | { status: "not_found" }
  | { status: "error"; httpStatus: number | null; message: string };

/**
 * Reads the current status of a previously-filed request.
 * GeoReport v2 only standardizes two states — "open" and "closed" — so the
 * mapping to our richer lifecycle is intentionally coarse.
 */
export async function fetchOpen311Status(
  serviceRequestId: string,
  options: {
    config: Open311Config | undefined;
    intakeUrl: string | null | undefined;
    fetchImpl?: typeof fetch;
  },
): Promise<StatusResult> {
  const endpoint = resolveEndpoint(options.config, options.intakeUrl);
  if (!endpoint) {
    return {
      status: "error",
      httpStatus: null,
      message: "No Open311 endpoint configured for this agency.",
    };
  }

  const query = new URLSearchParams();
  if (options.config?.apiKey) query.set("api_key", options.config.apiKey);
  if (options.config?.jurisdictionId)
    query.set("jurisdiction_id", options.config.jurisdictionId);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  // A custom fetchImpl (tests) is used verbatim; otherwise fetchWithTimeout
  // bounds each GET. Polling is idempotent, so we retry transient failures
  // (network/timeout) and 5xx responses with capped exponential backoff.
  const doFetch =
    options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchWithTimeout(input, {
        ...init,
        timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
      }));

  const url = `${endpoint}/requests/${encodeURIComponent(serviceRequestId)}.json${suffix}`;

  let response: Response;
  try {
    response = await withRetry(
      async () => {
        const res = await doFetch(url, { method: "GET", cache: "no-store" });
        // Surface 5xx as a retryable error so withRetry backs off and retries;
        // 4xx and 404 are permanent and fall through untouched.
        if (res.status >= 500) throw new RetryableHttpError(res.status);
        return res;
      },
      {
        attempts: 3,
        shouldRetry: (error) =>
          error instanceof RetryableHttpError || isTransientError(error),
      },
    );
  } catch (error) {
    if (error instanceof RetryableHttpError) {
      return {
        status: "error",
        httpStatus: error.httpStatus,
        message: error.message,
      };
    }
    return {
      status: "error",
      httpStatus: null,
      message:
        error instanceof TimeoutError
          ? "Open311 endpoint timed out."
          : error instanceof Error
            ? error.message
            : "Network error contacting Open311 endpoint.",
    };
  }

  if (response.status === 404) return { status: "not_found" };
  if (!response.ok) {
    const detail = await readErrorDescription(response);
    return {
      status: "error",
      httpStatus: response.status,
      message: detail ?? `Open311 endpoint returned HTTP ${response.status}.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: "error",
      httpStatus: response.status,
      message: "Open311 response was not valid JSON.",
    };
  }

  const first = Array.isArray(body) ? body[0] : body;
  if (!first || typeof first !== "object") return { status: "not_found" };

  const record = first as { status?: unknown; status_notes?: unknown };
  const open311Status = stringOrNull(record.status);
  if (!open311Status) {
    return {
      status: "error",
      httpStatus: response.status,
      message: "Open311 response had no status field.",
    };
  }

  return {
    status: "ok",
    open311Status,
    reportStatus: mapOpen311Status(open311Status),
    statusNotes: stringOrNull(record.status_notes),
  };
}

/**
 * Maps a GeoReport v2 / SeeClickFix status onto our ReportStatus lifecycle.
 *
 * The GeoReport spec only guarantees "open" and "closed", but SeeClickFix (the
 * provider behind every seeded API agency) and other vendors emit a richer set
 * of intermediate states. We fold the common ones into our lifecycle:
 *   - open / received          -> ACKNOWLEDGED (filed, agency aware, not started)
 *   - acknowledged             -> ACKNOWLEDGED (agency has acknowledged it)
 *   - in_progress / started    -> IN_PROGRESS  (agency is actively working it)
 *   - closed / resolved        -> RESOLVED     (issue resolved)
 *
 * The returned status is only ever *applied* through the poller's monotonic
 * STATUS_RANK + isForwardTransition guard (see the poll-status route), so a
 * vendor reporting an earlier state (e.g. "open" after a human moved the report
 * to IN_PROGRESS) can never demote it; this function just normalizes the vendor
 * vocabulary. Returns null for an unrecognized value so callers leave the
 * record untouched.
 */
export function mapOpen311Status(open311Status: string): ReportStatus | null {
  switch (open311Status.trim().toLowerCase()) {
    case "open":
    case "received":
    case "acknowledged":
      return ReportStatus.ACKNOWLEDGED;
    case "in_progress":
    case "in progress":
    case "started":
      return ReportStatus.IN_PROGRESS;
    case "closed":
    case "resolved":
      return ReportStatus.RESOLVED;
    default:
      return null;
  }
}

// Monotonic rank of our lifecycle states, used by the poller to avoid moving a
// report *backwards* (e.g. an endpoint that reports "open" should never demote
// a report a human already marked IN_PROGRESS). The canonical definition lives
// in the report status machine; re-exported here for existing importers.
export { STATUS_RANK } from "@/lib/reports/status-machine";

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

async function readErrorDescription(
  response: Response,
): Promise<string | null> {
  try {
    const body = await response.json();
    const first = Array.isArray(body) ? body[0] : body;
    const record = (first ?? {}) as { description?: unknown };
    return stringOrNull(record.description);
  } catch {
    return null;
  }
}

/**
 * Reads and validates the `open311` block off an Agency.requiredFields Json
 * column. Returns undefined when absent or malformed.
 */
export function parseOpen311Config(
  requiredFields: unknown,
): Open311Config | undefined {
  if (!requiredFields || typeof requiredFields !== "object") return undefined;
  const block = (requiredFields as { open311?: unknown }).open311;
  if (!block || typeof block !== "object") return undefined;

  const raw = block as Record<string, unknown>;
  const config: Open311Config = {};

  if (typeof raw.endpoint === "string") config.endpoint = raw.endpoint;
  if (typeof raw.apiKey === "string") config.apiKey = raw.apiKey;
  if (typeof raw.jurisdictionId === "string")
    config.jurisdictionId = raw.jurisdictionId;
  if (raw.serviceCodes && typeof raw.serviceCodes === "object") {
    const codes: Partial<Record<IssueType, string>> = {};
    for (const [key, value] of Object.entries(
      raw.serviceCodes as Record<string, unknown>,
    )) {
      if (
        Object.values(IssueType).includes(key as IssueType) &&
        typeof value === "string"
      ) {
        codes[key as IssueType] = value;
      }
    }
    config.serviceCodes = codes;
  }

  return config;
}
