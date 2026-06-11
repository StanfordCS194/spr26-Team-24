/**
 * Submission-filing harness (proves the agent FILES reports).
 *
 *   npx tsx eval/submission.ts                # full synthetic dataset
 *   npm run eval:submission
 *
 * Output:
 *   eval/results/submission.json   — per-case results + metrics
 *   stdout                         — pretty report and pass/fail vs the gate
 *
 * WHAT IT MEASURES: where eval/readiness.ts stops short of submitting (it only
 * proves we can REACH an intake channel and POPULATE every required field), this
 * harness goes one step further and actually runs the SUBMISSION AGENT for every
 * auto-fileable channel — it FILES the report — with the network transport
 * STUBBED. For each synthetic report it exercises the real filing path the
 * production orchestrator (`src/lib/submission/orchestrate.ts`) would take:
 *
 *   - API   -> if the agency's Open311 config can actually auto-file
 *              (`canAutoFileOpen311`), build the GeoReport v2 request via the real
 *              `buildRequestParams` and call the real `submitToOpen311` with an
 *              INJECTED fetch stub returning a realistic Open311 success
 *              (service_request_id). Outcome: "filed" with that tracking id.
 *              If `canAutoFileOpen311` is false (most seeded SeeClickFix agencies
 *              lack the internal `jurisdiction_id` their write path needs — issue
 *              #239/#250), the orchestrator degrades to manual-assist BEFORE any
 *              POST, so we classify the case "manual_assist" (the correct, honest
 *              outcome — NOT a failure).
 *   - EMAIL -> set RESEND_API_KEY + SUBMISSION_FROM_EMAIL for the run so the agent
 *              is "configured", then call the real `submitViaEmail` with an
 *              INJECTED `resendClient` stub whose `emails.send` returns a message
 *              id. Outcome: "filed" with that message id as the tracking id.
 *   - WEB_FORM / PHONE -> no automated agent exists (the web-form agent is
 *              separate; PHONE has no machine path), so the orchestrator hands off
 *              to manual-assist. Outcome: "manual_assist" (correct handoff).
 *
 * PRIMARY METRIC — filing success rate among auto-fileable cases:
 *     filed / (filed + failed)
 * The denominator EXCLUDES manual_assist cases (those are honest handoffs, not
 * failures). With a healthy transport the agent must file EVERY case it routes to
 * an auto-fileable channel, so this MUST be 100%. The harness exits non-zero if
 * any auto-fileable case "failed", or if there are ZERO auto-fileable cases (the
 * pipeline must actually exercise filing — the dataset's East Palo Alto illegal-
 * dumping case drives the EMAIL path so there is always >=1 real filed case).
 *
 * FULLY OFFLINE. No network, no live database, no LLM, no real POST/email:
 *   - It REUSES the production `resolveAgencyId` (which normally hits Prisma) by
 *     installing an in-memory Prisma stub on `globalThis.prisma` BEFORE the
 *     module is imported — the SAME pattern eval/readiness.ts uses, backed by the
 *     SAME seeded `AGENCIES` array, so routing behaves identically.
 *   - It REUSES the real `canAutoFileOpen311`, `parseOpen311Config`,
 *     `submitToOpen311`, and `submitViaEmail` filing agents, passing each its
 *     documented injectable transport (`fetchImpl` / `resendClient`) so no bytes
 *     ever leave the process.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { IssueType } from "../src/generated/prisma/enums";
import { AGENCIES, type AgencySeed } from "../prisma/agencies";

// ---------------------------------------------------------------------------
// Offline Prisma stub (same pattern as eval/readiness.ts & eval/end-to-end.ts).
//
// `src/lib/prisma.ts` resolves `prisma` as `globalForPrisma.prisma || <new
// client>`. By setting `globalThis.prisma` to an in-memory stub here, BEFORE any
// module that imports `@/lib/prisma` loads, we avoid instantiating a real
// PG-backed client — so the harness needs no DATABASE_URL and makes no network
// or DB calls. The stub implements exactly the one query `resolveAgencyId`
// makes: `agency.findMany({ where: { jurisdiction, issueTypes: { has } },
// select: { id }, orderBy: { id: 'asc' } })`, served from `AGENCIES`.
// ---------------------------------------------------------------------------

type AgencyRow = AgencySeed & { id: string };

// Deterministic ids derived from the seed key (@@unique([jurisdiction, name])),
// matching prisma/seed.ts, eval/readiness.ts and eval/end-to-end.ts.
const AGENCY_ROWS: AgencyRow[] = AGENCIES.map((a) => ({
  ...a,
  id: `${a.jurisdiction}::${a.name}`,
}));

const agencyById = new Map(AGENCY_ROWS.map((a) => [a.id, a]));

// `resolveAgencyId` queries by { jurisdiction, issueTypes: { has } }, selecting
// only `id`. `resolveAgencyCandidates` (the disambiguation robustness path)
// queries the SAME table by { id: { in: candidates } }, ordering by name. The
// stub answers both shapes off `AGENCY_ROWS` so the harness can drive either
// production function without a live DB.
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
// constructing a real client. Dynamic imports (not top-level await, which the
// CJS eval transform rejects) deferred into async `main()`.
type AgencyModule = typeof import("../src/lib/jurisdictions/agency");
type Open311Module = typeof import("../src/lib/submission/open311");
type EmailModule = typeof import("../src/lib/submission/email");
// `resolveAgencyCandidates` internally calls the production `resolveAgencyId`
// (which our Prisma stub backs), so we drive the candidate resolver directly and
// get both the routing decision and the ambiguity candidate set from one call.
let resolveAgencyCandidates: AgencyModule["resolveAgencyCandidates"];
let parseOpen311Config: Open311Module["parseOpen311Config"];
let canAutoFileOpen311: Open311Module["canAutoFileOpen311"];
let submitToOpen311: Open311Module["submitToOpen311"];
let submitViaEmail: EmailModule["submitViaEmail"];

async function loadDeps(): Promise<void> {
  const agency = await import("../src/lib/jurisdictions/agency");
  const open311 = await import("../src/lib/submission/open311");
  const email = await import("../src/lib/submission/email");
  resolveAgencyCandidates = agency.resolveAgencyCandidates;
  parseOpen311Config = open311.parseOpen311Config;
  canAutoFileOpen311 = open311.canAutoFileOpen311;
  submitToOpen311 = open311.submitToOpen311;
  submitViaEmail = email.submitViaEmail;
}

// ---------------------------------------------------------------------------
// Dataset — reuses eval/dataset/readiness-cases.json, the synthetic-report
// dataset that already carries lat/lng + issueType + the report field values
// (description / aiDescription / address / photo) the filing agents consume.
// It includes the East Palo Alto illegal-dumping case (dump-epa-14) that routes
// to an EMAIL-intake agency, guaranteeing at least one real "filed" case so the
// auto-fileable denominator is never zero.
// ---------------------------------------------------------------------------

interface SubmissionReport {
  description: string | null;
  aiDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  photoUrl: string | null;
  contactEmail: string | null;
  contactName: string | null;
  licensePlate: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  observationDatetime: string | null;
}

interface SubmissionCase {
  id: string;
  issueType: IssueType;
  note?: string;
  report: SubmissionReport;
  /**
   * Optional routing assertion (mirrors eval/readiness.ts). When set, the case
   * resolves to (or has among its ambiguity candidates) an agency with this
   * exact `name`, and that agency is the one filed/handed-off with. Pins the
   * filing path to a SPECIFIC agency that the default API-preferred
   * disambiguation would otherwise skip (e.g. the Menlo Park ACT WEB_FORM desk).
   */
  expectAgencyName?: string;
  /**
   * Robustness case: the location is OUTSIDE all served jurisdictions, so it
   * MUST resolve to no agency. The harness asserts no agency resolves and
   * records a "no_agency" handled outcome — NOT a filing failure (so it does not
   * trip the 100%-of-auto-fileable gate). Proves out-of-area reports degrade
   * gracefully instead of crashing.
   */
  expectNoAgency?: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(here, "dataset", "readiness-cases.json");
const RESULTS_DIR = path.join(here, "results");

// ---------------------------------------------------------------------------
// Stubbed transports — these stand in for the network so the real filing agents
// run end-to-end without a single byte leaving the process.
// ---------------------------------------------------------------------------

/**
 * A realistic Open311 GeoReport v2 success response: a single-element array of
 * `{ service_request_id }`, returned with HTTP 200, exactly as
 * `submitToOpen311` parses it. The id is derived from the request body so each
 * case gets a distinct, deterministic tracking id.
 */
function makeOpen311FetchStub(caseId: string): typeof fetch {
  let counter = 0;
  const stub = async (): Promise<Response> => {
    counter += 1;
    const serviceRequestId = `SR-${caseId}-${counter}`;
    return new Response(
      JSON.stringify([{ service_request_id: serviceRequestId }]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  return stub as unknown as typeof fetch;
}

/**
 * A stubbed Resend client whose `emails.send` returns a deterministic message
 * id, matching the `{ data, error }` shape `submitViaEmail` reads. Structurally
 * compatible with the narrow `EmailSender` slice the agent uses.
 */
function makeResendStub(caseId: string) {
  return {
    emails: {
      send: async () => ({
        data: { id: `email-${caseId}` },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof submitViaEmail>[1]["resendClient"];
}

// ---------------------------------------------------------------------------
// Per-case filing
// ---------------------------------------------------------------------------

type Outcome = "filed" | "manual_assist" | "no_agency" | "failed";

interface CaseResult {
  caseId: string;
  issueType: IssueType;
  resolved: boolean;
  /** True when the agency was chosen from `candidates` under routing ambiguity. */
  disambiguated: boolean;
  agencyId: string | null;
  agencyName: string | null;
  intakeMethod: string | null;
  /** The channel the filing agent actually used, when it filed. */
  channel: "API" | "EMAIL" | null;
  /**
   * For a manual_assist handoff: the intake target the user is pointed at — the
   * agency's form URL, intake email, or hotline phone. Asserted non-null, so the
   * dataset proves every un-fileable channel still surfaces a real destination.
   */
  manualAssistTarget: string | null;
  outcome: Outcome;
  trackingId: string | null;
  reason: string;
}

/**
 * Picks the agency to file with from a routing result — identical disambiguation
 * to eval/readiness.ts. A single confident `agencyId` is used directly;
 * otherwise (ambiguous routing: `agencyId` null with multiple `candidates`) we
 * prefer an API agency (the machine-submittable channel), else the first by id.
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
  // A case may PIN filing to a specific covering agency the default
  // API-preferred disambiguation would otherwise skip (e.g. Menlo Park ACT).
  if (expectAgencyName) {
    const pinned = rows.find((a) => a.name === expectAgencyName);
    if (pinned) return { agency: pinned, disambiguated: true };
  }
  const api = rows.find((a) => a.intakeMethod === "API");
  return { agency: api ?? rows[0], disambiguated: true };
}

/** Resolves an agency's usable manual-assist target (URL, email, or hotline). */
function manualAssistTargetOf(agency: AgencyRow): string | null {
  if (agency.intakeUrl) return agency.intakeUrl;
  if (agency.intakeEmail) return agency.intakeEmail;
  const rf = agency.requiredFields;
  if (rf && typeof rf === "object") {
    const phone = (rf as { contact_phone?: unknown }).contact_phone;
    if (phone && typeof phone === "object") {
      const value = (phone as { value?: unknown }).value;
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

async function fileCase(c: SubmissionCase): Promise<CaseResult> {
  // Reuse the production candidate resolver (same call drives both the routing
  // decision and the ambiguity candidate set), mirroring eval/readiness.ts.
  const disambig = await resolveAgencyCandidates({
    latitude: c.report.latitude,
    longitude: c.report.longitude,
    issueType: c.issueType,
  });
  const resolution = {
    agencyId: disambig.agencyId,
    candidates: disambig.candidates.map((d) => d.id),
  };

  // Robustness: an outside-all-jurisdictions location MUST resolve to no agency.
  // Record a handled "no_agency" outcome — never "failed" — so out-of-area
  // reports degrade gracefully and do not trip the auto-fileable filing gate.
  if (c.expectNoAgency) {
    if (disambig.candidates.length > 0) {
      throw new Error(
        `[${c.id}] expected NO agency (outside all jurisdictions) but resolved candidates [${disambig.candidates
          .map((d) => d.name)
          .join(", ")}].`,
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
      channel: null,
      manualAssistTarget: null,
      outcome: "no_agency",
      reason:
        "Outside all served jurisdictions; no agency resolved — handled gracefully (manual-assist), not a filing failure.",
      trackingId: null,
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
      channel: null,
      manualAssistTarget: null,
      outcome: "failed",
      reason: "No agency covers this jurisdiction + issue type.",
      trackingId: null,
    };
  }

  // Assert the pinned-agency expectation when set.
  if (c.expectAgencyName && agency.name !== c.expectAgencyName) {
    throw new Error(
      `[${c.id}] expected agency "${c.expectAgencyName}" but filed/handed-off with "${agency.name}".`,
    );
  }

  const manualAssistTarget = manualAssistTargetOf(agency);
  const base = {
    caseId: c.id,
    issueType: c.issueType,
    resolved: true,
    disambiguated,
    agencyId: agency.id,
    agencyName: agency.name,
    intakeMethod: agency.intakeMethod,
    // The intake destination a manual handoff would point at. Always resolvable
    // for a submittable agency; asserted non-null on every manual_assist below.
    manualAssistTarget,
  };

  const tag = (reason: string): string =>
    disambiguated
      ? `[ambiguous routing -> chose ${agency.name}] ${reason}`
      : reason;

  // --- API path: the real Open311 GeoReport agent, with a stubbed fetch. -----
  if (agency.intakeMethod === "API") {
    const config = parseOpen311Config(agency.requiredFields);
    // Mirror the orchestrator: un-fileable API agencies (no usable
    // jurisdiction_id on a multi-tenant SeeClickFix endpoint — #239/#250) degrade
    // to manual-assist BEFORE any POST. That is the correct, honest outcome.
    if (!canAutoFileOpen311(config, agency.intakeUrl)) {
      assertManualAssistTarget(c.id, agency.name, manualAssistTarget);
      return {
        ...base,
        channel: null,
        outcome: "manual_assist",
        trackingId: null,
        reason: tag(
          `Open311 config cannot auto-file (no usable jurisdiction_id for multi-tenant endpoint); handed off to manual-assist at ${manualAssistTarget}.`,
        ),
      };
    }

    const result = await submitToOpen311(
      {
        issueType: c.issueType,
        description: c.report.description,
        aiDescription: c.report.aiDescription,
        latitude: c.report.latitude,
        longitude: c.report.longitude,
        address: c.report.address,
      },
      {
        config,
        intakeUrl: agency.intakeUrl,
        fetchImpl: makeOpen311FetchStub(c.id),
      },
    );

    if (result.status === "submitted") {
      const trackingId = result.serviceRequestId ?? result.token;
      if (!trackingId) {
        return {
          ...base,
          channel: "API",
          outcome: "failed",
          trackingId: null,
          reason: tag("Open311 agent returned submitted but no tracking id."),
        };
      }
      return {
        ...base,
        channel: "API",
        outcome: "filed",
        trackingId,
        reason: tag(
          `Filed via Open311 GeoReport v2; service_request_id ${trackingId}.`,
        ),
      };
    }

    return {
      ...base,
      channel: "API",
      outcome: "failed",
      trackingId: null,
      reason: tag(`Open311 agent failed: ${result.message}`),
    };
  }

  // --- EMAIL path: the real email agent, with a stubbed Resend client. -------
  if (agency.intakeMethod === "EMAIL") {
    const result = await submitViaEmail(
      {
        id: c.id,
        issueType: c.issueType,
        description: c.report.description,
        aiDescription: c.report.aiDescription,
        latitude: c.report.latitude,
        longitude: c.report.longitude,
        address: c.report.address,
        // The readiness dataset names the photo `photoUrl`; the email agent reads
        // `imageUrl`. Map it across so the agent composes with the attachment
        // reference exactly as production would.
        imageUrl: c.report.photoUrl,
      },
      {
        agencyName: agency.name,
        intakeEmail: agency.intakeEmail,
        resendClient: makeResendStub(c.id),
      },
    );

    if (result.status === "submitted") {
      return {
        ...base,
        channel: "EMAIL",
        outcome: "filed",
        trackingId: result.messageId,
        reason: tag(
          `Filed via email to ${agency.intakeEmail}; message id ${result.messageId}.`,
        ),
      };
    }
    if (result.status === "not_configured") {
      // Should not happen — we set the env + inject a client — but if it does it
      // is an honest manual-assist handoff, not a filing failure.
      return {
        ...base,
        channel: null,
        outcome: "manual_assist",
        trackingId: null,
        reason: tag(`Email agent not configured: ${result.reason}`),
      };
    }
    return {
      ...base,
      channel: "EMAIL",
      outcome: "failed",
      trackingId: null,
      reason: tag(`Email agent failed: ${result.message}`),
    };
  }

  // --- WEB_FORM / PHONE: no automated agent — correct manual-assist handoff. --
  assertManualAssistTarget(c.id, agency.name, manualAssistTarget);
  return {
    ...base,
    channel: null,
    outcome: "manual_assist",
    trackingId: null,
    reason: tag(
      `${agency.intakeMethod} intake has no automated filing agent; handed off to manual-assist at ${manualAssistTarget}.`,
    ),
  };
}

/**
 * A manual-assist handoff is only useful if it names WHERE to file. Every
 * submittable agency exposes a web-form URL, an intake email, or a published
 * hotline (PHONE intake), so a null target means the seed is broken — fail loud.
 */
function assertManualAssistTarget(
  caseId: string,
  agencyName: string,
  target: string | null,
): void {
  if (!target) {
    throw new Error(
      `[${caseId}] manual-assist handoff to "${agencyName}" has no intake target (URL/email/phone).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface ChannelBreakdown {
  filed: number;
  manualAssist: number;
  noAgency: number;
  failed: number;
}

interface SubmissionMetrics {
  total: number;
  filed: number;
  manualAssist: number;
  /** Outside-all-jurisdictions cases handled gracefully (no agency, not a failure). */
  noAgency: number;
  failed: number;
  autoFileable: number;
  /** filed / (filed + failed) — manual_assist and no_agency excluded from the denominator. */
  filingSuccessRate: number;
  /** Per intake method: how each channel resolved. */
  perChannel: Record<string, ChannelBreakdown>;
}

function aggregate(results: CaseResult[]): SubmissionMetrics {
  const filed = results.filter((r) => r.outcome === "filed").length;
  const manualAssist = results.filter(
    (r) => r.outcome === "manual_assist",
  ).length;
  const noAgency = results.filter((r) => r.outcome === "no_agency").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  const autoFileable = filed + failed;

  const perChannel: Record<string, ChannelBreakdown> = {};
  for (const r of results) {
    const key = r.intakeMethod ?? "<unrouted>";
    const c = perChannel[key] ?? {
      filed: 0,
      manualAssist: 0,
      noAgency: 0,
      failed: 0,
    };
    if (r.outcome === "filed") c.filed++;
    else if (r.outcome === "manual_assist") c.manualAssist++;
    else if (r.outcome === "no_agency") c.noAgency++;
    else c.failed++;
    perChannel[key] = c;
  }

  return {
    total: results.length,
    filed,
    manualAssist,
    noAgency,
    failed,
    autoFileable,
    filingSuccessRate: autoFileable === 0 ? 0 : filed / autoFileable,
    perChannel,
  };
}

function renderReport(metrics: SubmissionMetrics): string {
  const lines: string[] = [];
  lines.push("\n=== Submission filing (agent actually files) ===");
  lines.push(
    `Filing success (auto-fileable): ${(metrics.filingSuccessRate * 100).toFixed(1)}%  (${metrics.filed}/${metrics.autoFileable})  target 100%`,
  );
  lines.push(
    `Outcomes: ${metrics.filed} filed · ${metrics.manualAssist} manual-assist · ${metrics.noAgency} no-agency(out-of-area) · ${metrics.failed} failed  (n=${metrics.total})`,
  );

  lines.push("\nPer-intake-method breakdown:");
  for (const m of Object.keys(metrics.perChannel).sort()) {
    const v = metrics.perChannel[m];
    lines.push(
      `  ${m.padEnd(12)} filed=${v.filed}  manual_assist=${v.manualAssist}  no_agency=${v.noAgency}  failed=${v.failed}`,
    );
  }

  return lines.join("\n");
}

async function main() {
  await loadDeps();
  const raw = await readFile(CASES_PATH, "utf-8");
  const cases = JSON.parse(raw) as SubmissionCase[];

  // Configure the EMAIL agent for the run so it is "wired up" and actually files
  // (via the injected Resend stub) instead of returning not_configured. These
  // are throwaway values used only by submitViaEmail's env gate — no network is
  // touched because we always inject a `resendClient`.
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "eval-stub-key";
  process.env.SUBMISSION_FROM_EMAIL =
    process.env.SUBMISSION_FROM_EMAIL || "nexa-eval@example.com";
  // Never redirect to an override inbox during the eval.
  delete process.env.SUBMISSION_OVERRIDE_EMAIL;

  console.log(
    `\n>>> Submission-filing harness (offline, no network/DB/POST/email), n=${cases.length}`,
  );

  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const r = await fileCase(cases[i]);
    results.push(r);
    const mark =
      r.outcome === "filed"
        ? "✓"
        : r.outcome === "manual_assist" || r.outcome === "no_agency"
          ? "↪"
          : "✗";
    const where = r.agencyName ?? "<unrouted>";
    const idPart = r.trackingId ? ` id=${r.trackingId}` : "";
    console.log(
      `  [${(i + 1).toString().padStart(2)}/${cases.length}] ${cases[i].id.padEnd(22).slice(0, 22)} ${mark} ${r.outcome.padEnd(13)} ${(r.intakeMethod ?? "-").padEnd(8)} -> ${where}${idPart}`,
    );
    if (r.outcome === "failed") console.log(`        ${r.reason}`);
  }

  const metrics = aggregate(results);

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    path.join(RESULTS_DIR, "submission.json"),
    JSON.stringify(
      {
        mode: "submission",
        datasetSize: cases.length,
        target: 1,
        ranAt: new Date().toISOString(),
        results,
        metrics,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(renderReport(metrics));

  // Gate: every auto-fileable case must file (100%), AND there must be at least
  // one auto-fileable case (the pipeline must actually exercise filing).
  const noAutoFileable = metrics.autoFileable === 0;
  const anyFailed = metrics.failed > 0;
  const pass = !noAutoFileable && !anyFailed;

  if (noAutoFileable) {
    console.log(
      "\nFAIL: zero auto-fileable cases — the pipeline never exercised the filing agent.",
    );
  } else {
    console.log(
      `\n${pass ? "PASS" : "FAIL"}: filing success ${(metrics.filingSuccessRate * 100).toFixed(1)}% of ${metrics.autoFileable} auto-fileable case(s); ${metrics.manualAssist} honest manual-assist handoff(s).`,
    );
  }

  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
