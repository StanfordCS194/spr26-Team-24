import { IssueType } from "@/generated/prisma/enums";
import { ReportStatus } from "@/generated/prisma/enums";

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
 */
const DEFAULT_SERVICE_CODES: Record<IssueType, string> = {
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
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${endpoint}/requests.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (error) {
    return {
      status: "error",
      httpStatus: null,
      message:
        error instanceof Error
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

  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(
      `${endpoint}/requests/${encodeURIComponent(serviceRequestId)}.json${suffix}`,
      { method: "GET", cache: "no-store" },
    );
  } catch (error) {
    return {
      status: "error",
      httpStatus: null,
      message:
        error instanceof Error
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
 * Maps a GeoReport v2 status onto our ReportStatus lifecycle. The spec only
 * guarantees "open" and "closed"; some endpoints emit richer notes, but we
 * stay conservative and treat anything non-closed as acknowledged-but-open.
 * Returns null for an unrecognized value so callers leave the record untouched.
 */
export function mapOpen311Status(open311Status: string): ReportStatus | null {
  switch (open311Status.trim().toLowerCase()) {
    case "open":
      return ReportStatus.ACKNOWLEDGED;
    case "closed":
      return ReportStatus.RESOLVED;
    default:
      return null;
  }
}

/**
 * Monotonic rank of our lifecycle states, used by the poller to avoid moving a
 * report *backwards* (e.g. an endpoint that reports "open" should never demote
 * a report a human already marked IN_PROGRESS).
 */
export const STATUS_RANK: Record<ReportStatus, number> = {
  [ReportStatus.DRAFT]: 0,
  [ReportStatus.CLASSIFYING]: 1,
  [ReportStatus.CONFIRMED]: 2,
  [ReportStatus.SUBMITTING]: 3,
  [ReportStatus.SUBMITTED]: 4,
  [ReportStatus.ACKNOWLEDGED]: 5,
  [ReportStatus.IN_PROGRESS]: 6,
  [ReportStatus.RESOLVED]: 7,
  [ReportStatus.CLOSED]: 8,
};

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
