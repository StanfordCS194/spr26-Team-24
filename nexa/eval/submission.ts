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

type FindManyArgs = {
  where?: {
    jurisdiction?: string;
    issueTypes?: { has?: string };
  };
  orderBy?: { id?: "asc" | "desc" };
};

const prismaStub = {
  agency: {
    async findMany(args: FindManyArgs) {
      const jurisdiction = args.where?.jurisdiction;
      const issueType = args.where?.issueTypes?.has;
      let rows = AGENCY_ROWS.filter(
        (a) =>
          (jurisdiction === undefined || a.jurisdiction === jurisdiction) &&
          (issueType === undefined ||
            a.issueTypes.includes(
              issueType as AgencySeed["issueTypes"][number],
            )),
      );
      const dir = args.orderBy?.id ?? "asc";
      rows = rows
        .slice()
        .sort((a, b) =>
          dir === "desc" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id),
        );
      return rows.map((a) => ({ id: a.id }));
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
let resolveAgencyId: AgencyModule["resolveAgencyId"];
let parseOpen311Config: Open311Module["parseOpen311Config"];
let canAutoFileOpen311: Open311Module["canAutoFileOpen311"];
let submitToOpen311: Open311Module["submitToOpen311"];
let submitViaEmail: EmailModule["submitViaEmail"];

async function loadDeps(): Promise<void> {
  const agency = await import("../src/lib/jurisdictions/agency");
  const open311 = await import("../src/lib/submission/open311");
  const email = await import("../src/lib/submission/email");
  resolveAgencyId = agency.resolveAgencyId;
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

type Outcome = "filed" | "manual_assist" | "failed";

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
function chooseAgency(resolution: {
  agencyId: string | null;
  candidates: string[];
}): { agency: AgencyRow | undefined; disambiguated: boolean } {
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
  const api = rows.find((a) => a.intakeMethod === "API");
  return { agency: api ?? rows[0], disambiguated: true };
}

async function fileCase(c: SubmissionCase): Promise<CaseResult> {
  const resolution = await resolveAgencyId({
    latitude: c.report.latitude,
    longitude: c.report.longitude,
    issueType: c.issueType,
  });

  const { agency, disambiguated } = chooseAgency(resolution);
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
      outcome: "failed",
      reason: "No agency covers this jurisdiction + issue type.",
      trackingId: null,
    };
  }

  const base = {
    caseId: c.id,
    issueType: c.issueType,
    resolved: true,
    disambiguated,
    agencyId: agency.id,
    agencyName: agency.name,
    intakeMethod: agency.intakeMethod,
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
      return {
        ...base,
        channel: null,
        outcome: "manual_assist",
        trackingId: null,
        reason: tag(
          "Open311 config cannot auto-file (no usable jurisdiction_id for multi-tenant endpoint); handed off to manual-assist.",
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
  return {
    ...base,
    channel: null,
    outcome: "manual_assist",
    trackingId: null,
    reason: tag(
      `${agency.intakeMethod} intake has no automated filing agent; handed off to manual-assist.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface ChannelBreakdown {
  filed: number;
  manualAssist: number;
  failed: number;
}

interface SubmissionMetrics {
  total: number;
  filed: number;
  manualAssist: number;
  failed: number;
  autoFileable: number;
  /** filed / (filed + failed) — manual_assist excluded from the denominator. */
  filingSuccessRate: number;
  /** Per intake method: how each channel resolved. */
  perChannel: Record<string, ChannelBreakdown>;
}

function aggregate(results: CaseResult[]): SubmissionMetrics {
  const filed = results.filter((r) => r.outcome === "filed").length;
  const manualAssist = results.filter(
    (r) => r.outcome === "manual_assist",
  ).length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  const autoFileable = filed + failed;

  const perChannel: Record<string, ChannelBreakdown> = {};
  for (const r of results) {
    const key = r.intakeMethod ?? "<unrouted>";
    const c = perChannel[key] ?? { filed: 0, manualAssist: 0, failed: 0 };
    if (r.outcome === "filed") c.filed++;
    else if (r.outcome === "manual_assist") c.manualAssist++;
    else c.failed++;
    perChannel[key] = c;
  }

  return {
    total: results.length,
    filed,
    manualAssist,
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
    `Outcomes: ${metrics.filed} filed · ${metrics.manualAssist} manual-assist · ${metrics.failed} failed  (n=${metrics.total})`,
  );

  lines.push("\nPer-intake-method breakdown:");
  for (const m of Object.keys(metrics.perChannel).sort()) {
    const v = metrics.perChannel[m];
    lines.push(
      `  ${m.padEnd(12)} filed=${v.filed}  manual_assist=${v.manualAssist}  failed=${v.failed}`,
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
      r.outcome === "filed" ? "✓" : r.outcome === "manual_assist" ? "↪" : "✗";
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
