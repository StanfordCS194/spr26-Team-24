/**
 * Submission-readiness harness (K3).
 *
 *   npx tsx eval/readiness.ts                # full synthetic dataset
 *   npm run eval:readiness
 *
 * Output:
 *   eval/results/readiness.json   — per-case results + metrics
 *   stdout                        — pretty report and pass/fail vs the >=90% target
 *
 * WHAT IT MEASURES (K3): given a synthetic civic report (lat/lng + issue type +
 * report values), can we reach an agency's intake channel and populate EVERY
 * required field WITHOUT performing a real submission? The pass rate over the
 * dataset is the K3 "submission-readiness" metric.
 *
 * A case is READY when all three hold:
 *   (a) routing reaches an intake channel — `resolveAgencyId` resolves a single
 *       agency, OR (when routing is ambiguous, agencyId === null) its
 *       `candidates` list names at least one agency we can file with. Picking a
 *       candidate under ambiguity is exactly the "future caller" disambiguation
 *       that `resolveAgencyId` documents it defers; readiness prefers an API
 *       (machine-submittable) candidate, falling back to the first by id;
 *   (b) every required field for that agency can be populated from the report;
 *   (c) the populated values pass client-side validation (non-empty, right kind).
 *
 * FULLY OFFLINE. No network, no live database, no LLM, no real POST:
 *   - It REUSES the production `resolveAgencyId` (which normally hits Prisma) by
 *     installing an in-memory Prisma stub on `globalThis.prisma` BEFORE the
 *     module is imported. The stub is backed by the SAME seeded `AGENCIES`
 *     array `prisma/seed.ts` writes to the DB, so routing behaves identically.
 *   - For API agencies it REUSES the real `parseOpen311Config`, `resolveServiceCode`
 *     and `buildRequestParams` to assemble the GeoReport v2 body and then checks
 *     the required GeoReport fields are present — it never sends the request.
 *   - For WEB_FORM / EMAIL agencies, "readiness" means the intake channel is
 *     resolvable (a web-form URL, an intake email, or a published hotline number
 *     in `contact_phone.value`) AND every `requiredFields[*].required` field maps
 *     to a non-empty report value. An agency with no URL, email, or phone has no
 *     fillable intake and is flagged not-ready.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { IssueType } from "../src/generated/prisma/enums";
import { AGENCIES, type AgencySeed } from "../prisma/agencies";

// ---------------------------------------------------------------------------
// Offline Prisma stub.
//
// `src/lib/prisma.ts` resolves `prisma` as `globalForPrisma.prisma || <new
// client>`. By setting `globalThis.prisma` to an in-memory stub here, BEFORE
// any module that imports `@/lib/prisma` loads, we avoid instantiating a real
// PG-backed client — so the harness needs no DATABASE_URL and makes no network
// or DB calls. The stub implements exactly the one query `resolveAgencyId`
// makes: `agency.findMany({ where: { jurisdiction, issueTypes: { has } },
// select: { id }, orderBy: { id: 'asc' } })`, served from `AGENCIES`.
// ---------------------------------------------------------------------------

type AgencyRow = AgencySeed & { id: string };

// Deterministic ids derived from the seed key (@@unique([jurisdiction, name])).
const AGENCY_ROWS: AgencyRow[] = AGENCIES.map((a) => ({
  ...a,
  id: `${a.jurisdiction}::${a.name}`,
}));

const agencyById = new Map(AGENCY_ROWS.map((a) => [a.id, a]));

// `resolveAgencyId` queries by { jurisdiction, issueTypes: { has } }, selecting
// only `id`. `resolveAgencyCandidates` (used by the disambiguation robustness
// path) queries the SAME table by { id: { in: candidates } }, selecting
// id/name/jurisdiction/intakeMethod and ordering by name. The stub answers both
// shapes off `AGENCY_ROWS` so the harness can drive either production function
// without a live DB.
type FindManyArgs = {
  where?: {
    jurisdiction?: string;
    issueTypes?: { has?: string };
    id?: { in?: string[] };
  };
  orderBy?: { id?: "asc" | "desc" } | { name?: "asc" | "desc" };
};

const prismaStub = {
  agency: {
    async findMany(args: FindManyArgs) {
      const jurisdiction = args.where?.jurisdiction;
      const issueType = args.where?.issueTypes?.has;
      const idIn = args.where?.id?.in;
      let rows = AGENCY_ROWS.filter(
        (a) =>
          (jurisdiction === undefined || a.jurisdiction === jurisdiction) &&
          (issueType === undefined ||
            a.issueTypes.includes(
              issueType as AgencySeed["issueTypes"][number],
            )) &&
          (idIn === undefined || idIn.includes(a.id)),
      );
      const order = args.orderBy ?? { id: "asc" };
      if ("name" in order && order.name) {
        const dir = order.name;
        rows = rows
          .slice()
          .sort((a, b) =>
            dir === "desc"
              ? b.name.localeCompare(a.name)
              : a.name.localeCompare(b.name),
          );
      } else {
        const dir = ("id" in order && order.id) || "asc";
        rows = rows
          .slice()
          .sort((a, b) =>
            dir === "desc"
              ? b.id.localeCompare(a.id)
              : a.id.localeCompare(b.id),
          );
      }
      // Return the full row; both callers `select` a subset, which is a no-op
      // narrowing over a superset object.
      return rows.map((a) => ({
        id: a.id,
        name: a.name,
        jurisdiction: a.jurisdiction,
        intakeMethod: a.intakeMethod,
      }));
    },
  },
};

(globalThis as unknown as { prisma: unknown }).prisma = prismaStub;

// Production functions, loaded lazily by `loadDeps()` AFTER the stub above is
// installed so the `@/lib/prisma` singleton picks up our stub instead of
// constructing a real client. They are dynamic imports (not top-level await,
// which the CJS eval transform rejects) deferred into async `main()`.
type AgencyModule = typeof import("../src/lib/jurisdictions/agency");
type Open311Module = typeof import("../src/lib/submission/open311");
// `resolveAgencyCandidates` internally calls the production `resolveAgencyId`
// (which our Prisma stub backs), so one call yields BOTH the routing decision
// and the ambiguity candidate set + disambiguating question.
let resolveAgencyCandidates: AgencyModule["resolveAgencyCandidates"];
let parseOpen311Config: Open311Module["parseOpen311Config"];
let resolveServiceCode: Open311Module["resolveServiceCode"];
let buildRequestParams: Open311Module["buildRequestParams"];

async function loadDeps(): Promise<void> {
  const agency = await import("../src/lib/jurisdictions/agency");
  const open311 = await import("../src/lib/submission/open311");
  resolveAgencyCandidates = agency.resolveAgencyCandidates;
  parseOpen311Config = open311.parseOpen311Config;
  resolveServiceCode = open311.resolveServiceCode;
  buildRequestParams = open311.buildRequestParams;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

interface ReadinessReport {
  /** Citizen-supplied free text (may be null to test the AI-summary fallback). */
  description: string | null;
  /** AI-generated summary, used by buildRequestParams when description is null. */
  aiDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  /** Resolved street/photo/contact extras the report carries. */
  photoUrl: string | null;
  contactEmail: string | null;
  contactName: string | null;
  // Emissions-specific fields (CARB smoking-vehicle complaint).
  licensePlate: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  observationDatetime: string | null;
}

interface ReadinessCase {
  id: string;
  issueType: IssueType;
  note?: string;
  report: ReadinessReport;
  /**
   * Optional routing assertion. When set, the harness asserts the report
   * resolves to (confident match) OR has among its ambiguity candidates an
   * agency with this exact `name`; the named agency is the one whose required
   * fields are then assessed. This lets a case pin field-filling to a SPECIFIC
   * agency that loses the default API-preferred disambiguation — e.g. asserting
   * the Menlo Park ACT WEB_FORM desk (not just its Open311 sibling) can be
   * reached and fully filled. A mismatch fails the run.
   */
  expectAgencyName?: string;
  /**
   * Robustness case: the report's location is OUTSIDE all served jurisdictions,
   * so it MUST resolve to no agency. The harness asserts no agency resolves and
   * treats that as the (correct) handled outcome — never a crash. Such a case is
   * recorded as not-ready (there is no intake to fill) but is excluded from the
   * readiness-rate denominator, since "no agency exists" is not a field-filling
   * failure.
   */
  expectNoAgency?: boolean;
}

// Maps an agency `requiredFields` key onto the report value that fills it. This
// is the same value-mapping intent the submission pipeline performs; for API
// agencies the canonical GeoReport mapping comes from buildRequestParams (see
// `assessApiReadiness`), so this table only covers WEB_FORM / EMAIL fields.
function fieldValue(
  key: string,
  report: ReadinessReport,
): string | number | null {
  switch (key) {
    case "description":
      return report.description?.trim() || report.aiDescription?.trim() || null;
    case "location_address":
    case "observation_location":
      return report.address?.trim() || null;
    case "latitude":
      return report.latitude;
    case "longitude":
      return report.longitude;
    case "photo":
      return report.photoUrl?.trim() || null;
    case "contact_email":
      return report.contactEmail?.trim() || null;
    case "contact_name":
      return report.contactName?.trim() || null;
    case "license_plate":
      return report.licensePlate?.trim() || null;
    case "vehicle_make":
      return report.vehicleMake?.trim() || null;
    case "vehicle_model":
      return report.vehicleModel?.trim() || null;
    case "vehicle_color":
      return report.vehicleColor?.trim() || null;
    case "observation_datetime":
      return report.observationDatetime?.trim() || null;
    default:
      return null;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(here, "dataset", "readiness-cases.json");
const RESULTS_DIR = path.join(here, "results");

/** K3 target: >=90% submission-readiness over the synthetic dataset. */
const TARGET_READINESS = 0.9;

// ---------------------------------------------------------------------------
// Per-case assessment
// ---------------------------------------------------------------------------

interface FieldCheck {
  field: string;
  required: boolean;
  satisfied: boolean;
}

interface CaseResult {
  caseId: string;
  issueType: IssueType;
  resolved: boolean;
  /** True when the agency was chosen from `candidates` under routing ambiguity. */
  disambiguated: boolean;
  agencyId: string | null;
  agencyName: string | null;
  intakeMethod: string | null;
  /**
   * The resolved intake channel target the manual/assist or filing step would
   * use — a web-form URL, intake email, or hotline phone — so the dataset proves
   * each agency exposes a usable channel, not just that fields are filled.
   */
  intakeTarget: string | null;
  /** Every covering agency name (the candidate set) for ambiguous routing. */
  candidateNames: string[];
  /** The disambiguating question when routing is ambiguous (>1 candidate). */
  disambiguation: string | null;
  serviceCode: string | null;
  missingFields: string[];
  fieldChecks: FieldCheck[];
  ready: boolean;
  /**
   * True when this case is excluded from the readiness-rate denominator (an
   * outside-all-jurisdictions robustness case, where no agency exists to fill).
   */
  excludedFromRate: boolean;
  reason: string;
}

/**
 * Picks the agency to assess from a routing result. A single confident
 * `agencyId` is used directly. Otherwise — when routing is ambiguous and
 * `resolveAgencyId` returns `agencyId: null` with multiple `candidates` — we
 * apply the disambiguation it defers to callers: prefer an API agency (the
 * machine-submittable channel), else the first candidate by id.
 */
function chooseAgency(
  resolution: {
    agencyId: string | null;
    candidates: string[];
  },
  expectAgencyName?: string,
): { agency: AgencyRow | undefined; disambiguated: boolean } {
  if (resolution.agencyId) {
    return {
      agency: agencyById.get(resolution.agencyId),
      disambiguated: false,
    };
  }
  if (resolution.candidates.length === 0) {
    return { agency: undefined, disambiguated: false };
  }
  const rows = resolution.candidates
    .map((id) => agencyById.get(id))
    .filter((a): a is AgencyRow => a !== undefined);
  // A case may PIN assessment to a specific covering agency (e.g. the Menlo Park
  // ACT WEB_FORM desk) that the default API-preferred disambiguation would skip.
  if (expectAgencyName) {
    const pinned = rows.find((a) => a.name === expectAgencyName);
    if (pinned) return { agency: pinned, disambiguated: true };
  }
  const api = rows.find((a) => a.intakeMethod === "API");
  return { agency: api ?? rows[0], disambiguated: true };
}

/** Resolves an agency's usable intake channel target (URL, email, or hotline). */
function intakeTargetOf(agency: AgencyRow): string | null {
  if (agency.intakeUrl) return agency.intakeUrl;
  if (agency.intakeEmail) return agency.intakeEmail;
  return intakePhone(agency.requiredFields);
}

/** Treats every `requiredFields` entry with `required: true` as a gate. */
function requiredKeys(requiredFields: unknown): string[] {
  if (!requiredFields || typeof requiredFields !== "object") return [];
  const keys: string[] = [];
  for (const [key, spec] of Object.entries(
    requiredFields as Record<string, unknown>,
  )) {
    if (
      spec &&
      typeof spec === "object" &&
      (spec as { required?: unknown }).required === true
    ) {
      keys.push(key);
    }
  }
  return keys;
}

/** Non-empty string or finite number counts as a satisfied value. */
function isFilled(value: string | number | null): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * API (Open311) readiness: build the real GeoReport v2 body via the production
 * `buildRequestParams`, then confirm the GeoReport-required params are present.
 * GeoReport v2 requires `service_code` plus a location (lat/long OR
 * address_string) and a description; we treat those as the required gate.
 */
function assessApiReadiness(
  agency: AgencyRow,
  c: ReadinessCase,
): { serviceCode: string | null; checks: FieldCheck[]; reason: string } {
  const config = parseOpen311Config(agency.requiredFields);
  const serviceCode = resolveServiceCode(c.issueType, config);
  if (!serviceCode) {
    return {
      serviceCode: null,
      checks: [{ field: "service_code", required: true, satisfied: false }],
      reason: "No Open311 service_code maps to this issue type.",
    };
  }

  const params = buildRequestParams(
    {
      issueType: c.issueType,
      description: c.report.description,
      aiDescription: c.report.aiDescription,
      latitude: c.report.latitude,
      longitude: c.report.longitude,
      address: c.report.address,
    },
    serviceCode,
    config,
  );

  const hasLocation =
    (params.has("lat") && params.has("long")) || params.has("address_string");
  const checks: FieldCheck[] = [
    {
      field: "service_code",
      required: true,
      satisfied: params.has("service_code"),
    },
    {
      field: "description",
      required: true,
      satisfied: params.has("description"),
    },
    {
      field: "location(lat+long|address_string)",
      required: true,
      satisfied: hasLocation,
    },
  ];
  const ok = checks.every((ch) => ch.satisfied);
  return {
    serviceCode,
    checks,
    reason: ok
      ? "API intake reached; GeoReport v2 body fully populated."
      : "API body missing a GeoReport-required field.",
  };
}

/** Pulls a hotline number from a `contact_phone.value` requiredFields entry. */
function intakePhone(requiredFields: unknown): string | null {
  if (!requiredFields || typeof requiredFields !== "object") return null;
  const phone = (requiredFields as { contact_phone?: unknown }).contact_phone;
  if (phone && typeof phone === "object") {
    const value = (phone as { value?: unknown }).value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * WEB_FORM / EMAIL readiness: an intake channel must be resolvable AND every
 * `requiredFields[*].required` field must map to a non-empty report value.
 *
 * "Resolvable channel" means a web-form URL, an intake email, OR a published
 * hotline number (`contact_phone.value`) for phone-intake agencies such as the
 * CARB Smoking-Vehicle complaint line — the report just needs every operator-
 * fillable field gathered ("reach intake + fill fields, stop short of submit").
 * An agency with no URL, email, or phone is not fillable and is not-ready.
 */
function assessFormReadiness(
  agency: AgencyRow,
  c: ReadinessCase,
): { checks: FieldCheck[]; reason: string } {
  const phone = intakePhone(agency.requiredFields);
  const channel = agency.intakeUrl
    ? "web form"
    : agency.intakeEmail
      ? "email"
      : phone
        ? "phone hotline"
        : null;
  const checks: FieldCheck[] = requiredKeys(agency.requiredFields).map(
    (key) => ({
      field: key,
      required: true,
      satisfied: isFilled(fieldValue(key, c.report)),
    }),
  );
  if (!channel) {
    return {
      checks,
      reason: `No resolvable intake channel (no URL, email, or hotline).`,
    };
  }
  const ok = checks.every((ch) => ch.satisfied);
  return {
    checks,
    reason: ok
      ? `${channel} intake resolvable; all required fields filled.`
      : "Required field(s) not populated from report.",
  };
}

async function assessCase(c: ReadinessCase): Promise<CaseResult> {
  // Reuse the production candidate resolver so the SAME call yields both the
  // routing decision and (under ambiguity) the candidate set + disambiguating
  // question the UI shows. Its `agencyId`/`candidates` mirror `resolveAgencyId`.
  const disambig = await resolveAgencyCandidates({
    latitude: c.report.latitude,
    longitude: c.report.longitude,
    issueType: c.issueType,
  });
  const resolution = {
    agencyId: disambig.agencyId,
    candidates: disambig.candidates.map((d) => d.id),
  };
  const candidateNames = disambig.candidates.map((d) => d.name);

  // Robustness: an outside-all-jurisdictions location MUST resolve to no agency.
  // This is the correct handled outcome (not a crash), and is excluded from the
  // readiness denominator since there is no intake channel to fill.
  if (c.expectNoAgency) {
    if (disambig.candidates.length > 0) {
      throw new Error(
        `[${c.id}] expected NO agency (outside all jurisdictions) but resolved candidates [${candidateNames.join(", ")}].`,
      );
    }
    return {
      caseId: c.id,
      issueType: c.issueType,
      resolved: false,
      disambiguated: false,
      agencyId: null,
      agencyName: null,
      intakeMethod: null,
      intakeTarget: null,
      candidateNames: [],
      disambiguation: null,
      serviceCode: null,
      missingFields: [],
      fieldChecks: [],
      ready: false,
      excludedFromRate: true,
      reason:
        "Outside all served jurisdictions; resolved to no agency and handled gracefully (manual-assist).",
    };
  }

  const { agency, disambiguated } = chooseAgency(
    resolution,
    c.expectAgencyName,
  );
  if (!agency) {
    return {
      caseId: c.id,
      issueType: c.issueType,
      resolved: false,
      disambiguated: false,
      agencyId: null,
      agencyName: null,
      intakeMethod: null,
      intakeTarget: null,
      candidateNames,
      disambiguation: disambig.disambiguation,
      serviceCode: null,
      missingFields: [],
      fieldChecks: [],
      ready: false,
      excludedFromRate: false,
      reason: "No agency covers this jurisdiction + issue type.",
    };
  }

  // Assert the pinned-agency expectation (when set): the named agency must be
  // the one we resolved/assessed, otherwise the case is asserting nothing.
  if (c.expectAgencyName && agency.name !== c.expectAgencyName) {
    throw new Error(
      `[${c.id}] expected agency "${c.expectAgencyName}" but assessed "${agency.name}" (candidates: [${candidateNames.join(", ")}]).`,
    );
  }

  // Assert the disambiguation contract: ambiguous routing (more than one
  // candidate) MUST carry a question; an unambiguous one MUST NOT.
  if (disambig.candidates.length > 1 && !disambig.disambiguation) {
    throw new Error(
      `[${c.id}] ambiguous routing (${candidateNames.length} candidates) but no disambiguating question.`,
    );
  }
  if (disambig.candidates.length === 1 && disambig.disambiguation) {
    throw new Error(
      `[${c.id}] single confident candidate but a disambiguating question was returned.`,
    );
  }

  let checks: FieldCheck[];
  let serviceCode: string | null = null;
  let reason: string;

  if (agency.intakeMethod === "API") {
    const api = assessApiReadiness(agency, c);
    checks = api.checks;
    serviceCode = api.serviceCode;
    reason = api.reason;
  } else {
    const form = assessFormReadiness(agency, c);
    checks = form.checks;
    reason = form.reason;
  }

  const missingFields = checks
    .filter((ch) => ch.required && !ch.satisfied)
    .map((ch) => ch.field);
  const ready = missingFields.length === 0;

  if (disambiguated) {
    reason = `[ambiguous routing -> chose ${agency.name}] ${reason}`;
  }

  return {
    caseId: c.id,
    issueType: c.issueType,
    resolved: true,
    disambiguated,
    agencyId: agency.id,
    agencyName: agency.name,
    intakeMethod: agency.intakeMethod,
    intakeTarget: intakeTargetOf(agency),
    candidateNames,
    disambiguation: disambig.disambiguation,
    serviceCode,
    missingFields,
    fieldChecks: checks,
    ready,
    excludedFromRate: false,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface ReadinessMetrics {
  total: number;
  /** Cases counted toward the readiness rate (total minus excluded robustness cases). */
  scored: number;
  ready: number;
  readiness: number;
  resolved: number;
  coverage: number;
  /** Robustness cases excluded from the readiness denominator (outside-jurisdiction). */
  excluded: number;
  perCategory: Record<
    string,
    { support: number; ready: number; readiness: number }
  >;
  perIntakeMethod: Record<
    string,
    { support: number; ready: number; readiness: number }
  >;
}

function aggregate(results: CaseResult[]): ReadinessMetrics {
  const total = results.length;
  // Outside-all-jurisdictions robustness cases are excluded from the readiness
  // RATE (there is no intake to fill), but still run to prove graceful handling.
  const scoredResults = results.filter((r) => !r.excludedFromRate);
  const scored = scoredResults.length;
  const ready = scoredResults.filter((r) => r.ready).length;
  const resolved = results.filter((r) => r.resolved).length;

  const perCategory: ReadinessMetrics["perCategory"] = {};
  const perIntakeMethod: ReadinessMetrics["perIntakeMethod"] = {};
  for (const r of scoredResults) {
    const cat = perCategory[r.issueType] ?? {
      support: 0,
      ready: 0,
      readiness: 0,
    };
    cat.support++;
    if (r.ready) cat.ready++;
    cat.readiness = cat.support === 0 ? 0 : cat.ready / cat.support;
    perCategory[r.issueType] = cat;

    const methodKey = r.intakeMethod ?? "<unrouted>";
    const m = perIntakeMethod[methodKey] ?? {
      support: 0,
      ready: 0,
      readiness: 0,
    };
    m.support++;
    if (r.ready) m.ready++;
    m.readiness = m.support === 0 ? 0 : m.ready / m.support;
    perIntakeMethod[methodKey] = m;
  }

  return {
    total,
    scored,
    ready,
    readiness: scored === 0 ? 0 : ready / scored,
    resolved,
    coverage: total === 0 ? 0 : resolved / total,
    excluded: total - scored,
    perCategory,
    perIntakeMethod,
  };
}

function renderReport(metrics: ReadinessMetrics): string {
  const lines: string[] = [];
  lines.push("\n=== Submission readiness (K3) ===");
  lines.push(
    `Readiness: ${(metrics.readiness * 100).toFixed(1)}%  (${metrics.ready}/${metrics.scored})  target >=${(TARGET_READINESS * 100).toFixed(0)}%` +
      (metrics.excluded > 0
        ? `  [${metrics.excluded} outside-jurisdiction robustness case(s) excluded from rate]`
        : ""),
  );
  lines.push(
    `Routed:    ${(metrics.coverage * 100).toFixed(1)}%  (${metrics.resolved}/${metrics.total} reached an agency)`,
  );

  lines.push("\nPer-category readiness:");
  for (const cat of Object.keys(metrics.perCategory).sort()) {
    const v = metrics.perCategory[cat];
    lines.push(
      `  ${cat.padEnd(20)} ${(v.readiness * 100).toFixed(1)}%  (${v.ready}/${v.support})`,
    );
  }

  lines.push("\nPer-intake-method readiness:");
  for (const m of Object.keys(metrics.perIntakeMethod).sort()) {
    const v = metrics.perIntakeMethod[m];
    lines.push(
      `  ${m.padEnd(20)} ${(v.readiness * 100).toFixed(1)}%  (${v.ready}/${v.support})`,
    );
  }

  return lines.join("\n");
}

async function main() {
  await loadDeps();
  const raw = await readFile(CASES_PATH, "utf-8");
  const cases = JSON.parse(raw) as ReadinessCase[];

  console.log(
    `\n>>> Submission-readiness harness (offline, no network/DB/POST), n=${cases.length}`,
  );

  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const r = await assessCase(cases[i]);
    results.push(r);
    const mark = r.ready ? "✓" : "✗";
    const where = r.agencyName ?? "<unrouted>";
    console.log(
      `  [${(i + 1).toString().padStart(2)}/${cases.length}] ${cases[i].id.padEnd(22).slice(0, 22)} ${mark}  ${r.issueType.padEnd(18)} -> ${where}`,
    );
    if (!r.ready) console.log(`        ${r.reason}`);
  }

  const metrics = aggregate(results);

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    path.join(RESULTS_DIR, "readiness.json"),
    JSON.stringify(
      {
        mode: "readiness",
        datasetSize: cases.length,
        target: TARGET_READINESS,
        ranAt: new Date().toISOString(),
        results,
        metrics,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(renderReport(metrics));

  const pass = metrics.readiness >= TARGET_READINESS;
  console.log(
    `\n${pass ? "PASS" : "BELOW TARGET"}: submission readiness ${(metrics.readiness * 100).toFixed(1)}% vs target ${(TARGET_READINESS * 100).toFixed(0)}% (K3).`,
  );

  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
