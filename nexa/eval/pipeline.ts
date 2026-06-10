/**
 * End-to-end image-pipeline VERIFICATION harness (issue #217).
 *
 *   npx tsx eval/pipeline.ts                 # offline path (no LLM keys needed)
 *   npm run eval:pipeline
 *   npx tsx eval/pipeline.ts --limit=1        # subset for a quick smoke-run
 *
 * Output:
 *   eval/results/pipeline.json   — full collected record per image (machine-readable)
 *   eval/results/pipeline.md     — the same, as a human-readable report
 *   stdout                       — one summary line per image
 *
 * WHAT IT DOES: takes a dataset of REAL images all the way through the REAL
 * production pipeline and DUMPS what was collected at every stage — then STOPS,
 * WITHOUT submitting anything anywhere. For each image:
 *
 *   1. preprocess  — real `preprocessImage` extracts EXIF GPS; we record the
 *                    location SOURCE ("exif" when the photo carried GPS, else
 *                    "provided" from the dataset).
 *   2. classify    — when LLM keys are present, the REAL `classifyWithConsensus`
 *                    (two-stage) produces {issueType, aiDescription}. When keys
 *                    are ABSENT we DO NOT fabricate a classification: we fall
 *                    back to the dataset's provided/expected issueType +
 *                    description and label the source clearly so the offline
 *                    location/routing/payload stages still run.
 *   3. geocode     — real `reverseGeocode` (Nominatim) turns coords into an
 *                    address; offline it degrades to the dataset address / the
 *                    coordinate fallback, so this stage never blocks an offline run.
 *   4. route       — real `resolveAgencyId` + `resolveAgencyCandidates` pick the
 *                    jurisdiction + agency (with disambiguation candidates when
 *                    the match is ambiguous).
 *   5. payload     — the would-be submission payload is assembled with the REAL
 *                    builders for the agency's intake method:
 *                      API   -> `parseOpen311Config` + `resolveServiceCode` +
 *                               `buildRequestParams` (GeoReport v2 body)
 *                      other -> `buildPrefillFields` (web-form/phone copy-over),
 *                               plus `composeSubmissionEmail` for EMAIL intake.
 *   6. report      — emit the full record: image, description + classification
 *                    source, location + source, jurisdiction, agency, intake
 *                    method, the assembled payload, readiness, and the agency it
 *                    WOULD submit to.
 *
 * CRITICAL: nothing is posted. We stop at the assembled payload — no Open311
 * POST, no email send, no DB write. The offline stages (location/routing/payload)
 * run with NO API keys, exactly like `eval/readiness.ts`.
 *
 * OFFLINE BY CONSTRUCTION: like `eval/readiness.ts`, this installs an in-memory
 * Prisma stub on `globalThis.prisma` BEFORE importing any `@/lib/prisma`
 * consumer, so `resolveAgencyId` routes against the SAME seeded `AGENCIES`
 * array `prisma/seed.ts` writes to the DB — no DATABASE_URL, no live DB.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { IssueType } from "../src/generated/prisma/enums";
import { AGENCIES, type AgencySeed } from "../prisma/agencies";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

// ---------------------------------------------------------------------------
// Offline Prisma stub (identical strategy to eval/readiness.ts).
//
// `src/lib/prisma.ts` resolves `prisma` as `globalForPrisma.prisma || <new
// client>`. By installing an in-memory stub on `globalThis.prisma` here — BEFORE
// any module that imports `@/lib/prisma` loads — `resolveAgencyId` /
// `resolveAgencyCandidates` route against the seeded AGENCIES array instead of a
// real PG client, so the harness needs no DATABASE_URL and makes no DB calls.
// ---------------------------------------------------------------------------

type AgencyRow = AgencySeed & { id: string };

// Deterministic ids derived from the seed key (@@unique([jurisdiction, name])).
const AGENCY_ROWS: AgencyRow[] = AGENCIES.map((a) => ({
  ...a,
  id: `${a.jurisdiction}::${a.name}`,
}));
const agencyById = new Map(AGENCY_ROWS.map((a) => [a.id, a]));

type FindManyArgs = {
  where?: {
    jurisdiction?: string;
    issueTypes?: { has?: string };
    id?: { in?: string[] };
  };
  orderBy?: { id?: "asc" | "desc"; name?: "asc" | "desc" };
  select?: Record<string, boolean>;
};

const prismaStub = {
  agency: {
    // Serves both queries the routing layer makes:
    //   resolveAgencyId:        where { jurisdiction, issueTypes:{has} }, select { id }
    //   resolveAgencyCandidates: where { id:{ in } }, select { id,name,jurisdiction,intakeMethod }
    async findMany(args: FindManyArgs) {
      let rows = AGENCY_ROWS.filter((a) => {
        const w = args.where ?? {};
        if (w.jurisdiction !== undefined && a.jurisdiction !== w.jurisdiction)
          return false;
        const has = w.issueTypes?.has;
        if (
          has !== undefined &&
          !a.issueTypes.includes(has as AgencySeed["issueTypes"][number])
        )
          return false;
        if (w.id?.in !== undefined && !w.id.in.includes(a.id)) return false;
        return true;
      });

      if (args.orderBy?.name) {
        const dir = args.orderBy.name;
        rows = rows
          .slice()
          .sort((a, b) =>
            dir === "desc"
              ? b.name.localeCompare(a.name)
              : a.name.localeCompare(b.name),
          );
      } else {
        const dir = args.orderBy?.id ?? "asc";
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

// ---------------------------------------------------------------------------
// Production functions, loaded AFTER the stub is installed (dynamic imports so
// the @/lib/prisma singleton picks up our stub instead of constructing a real
// client). We reuse the REAL pipeline functions — no parallel implementations.
// ---------------------------------------------------------------------------
type PreprocessModule = typeof import("../src/lib/classify/preprocess");
type ConsensusModule = typeof import("../src/lib/classify/consensus");
type GeocodeModule = typeof import("../src/lib/reverse-geocode");
type AgencyModule = typeof import("../src/lib/jurisdictions/agency");
type Open311Module = typeof import("../src/lib/submission/open311");
type PrefillModule = typeof import("../src/lib/submission/prefill");
type EmailModule = typeof import("../src/lib/submission/email");

let preprocessImage: PreprocessModule["preprocessImage"];
let classifyWithConsensus: ConsensusModule["classifyWithConsensus"];
let reverseGeocode: GeocodeModule["reverseGeocode"];
let resolveAgencyId: AgencyModule["resolveAgencyId"];
let resolveAgencyCandidates: AgencyModule["resolveAgencyCandidates"];
let parseOpen311Config: Open311Module["parseOpen311Config"];
let resolveServiceCode: Open311Module["resolveServiceCode"];
let buildRequestParams: Open311Module["buildRequestParams"];
let buildPrefillFields: PrefillModule["buildPrefillFields"];
let composeSubmissionEmail: EmailModule["composeSubmissionEmail"];

async function loadDeps(): Promise<void> {
  const preprocess = await import("../src/lib/classify/preprocess");
  const consensus = await import("../src/lib/classify/consensus");
  const geocode = await import("../src/lib/reverse-geocode");
  const agency = await import("../src/lib/jurisdictions/agency");
  const open311 = await import("../src/lib/submission/open311");
  const prefill = await import("../src/lib/submission/prefill");
  const email = await import("../src/lib/submission/email");

  preprocessImage = preprocess.preprocessImage;
  classifyWithConsensus = consensus.classifyWithConsensus;
  reverseGeocode = geocode.reverseGeocode;
  resolveAgencyId = agency.resolveAgencyId;
  resolveAgencyCandidates = agency.resolveAgencyCandidates;
  parseOpen311Config = open311.parseOpen311Config;
  resolveServiceCode = open311.resolveServiceCode;
  buildRequestParams = open311.buildRequestParams;
  buildPrefillFields = prefill.buildPrefillFields;
  composeSubmissionEmail = email.composeSubmissionEmail;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

interface PipelineCase {
  id: string;
  /** Path (repo-root-relative) to a REAL image on disk. */
  image: string;
  mime: string;
  /** Caller-supplied location, used when the image carries no EXIF GPS. */
  providedLocation: {
    latitude: number;
    longitude: number;
    address: string | null;
  };
  /**
   * Provided/expected classification used ONLY when LLM keys are absent so the
   * offline stages can still run. NEVER used to fabricate a classification when
   * keys ARE present — the live classifier wins then.
   */
  expected: {
    issueType: IssueType;
    description: string | null;
  };
  contactEmail?: string | null;
  note?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const CASES_PATH = path.join(here, "dataset", "pipeline-cases.json");
const RESULTS_DIR = path.join(here, "results");

interface Args {
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    }
  }
  return args;
}

function llmKeysPresent(): boolean {
  // Mirror the providers' env gating (src/lib/config.ts). The classifier needs
  // at least one provider key to return a real result; with none, every
  // provider fails and consensus would fall back to OTHER — so we use the
  // dataset's provided classification instead and say so.
  return Boolean(
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_API_KEY,
  );
}

// ---------------------------------------------------------------------------
// Per-image record
// ---------------------------------------------------------------------------

interface AssembledPayload {
  // Discriminated by the agency's intake method.
  kind: "open311" | "prefill" | "none";
  // For API agencies: the GeoReport v2 body we WOULD POST (never sent).
  open311?: {
    endpoint: string | null;
    serviceCode: string | null;
    body: Record<string, string>;
  } | null;
  // For WEB_FORM / PHONE / EMAIL agencies: the per-field copy-over guide.
  prefillFields?: Array<{
    key: string;
    label: string;
    value: string | null;
    required: boolean;
    type: string;
    hint?: string;
  }>;
  // For EMAIL agencies only: the composed (but UNSENT) email.
  email?: { subject: string; text: string } | null;
}

interface PipelineRecord {
  caseId: string;
  image: string;
  note: string | null;

  // (1) preprocess
  preprocess: {
    width: number;
    height: number;
    byteLength: number;
    originalWidth: number | null;
    originalHeight: number | null;
    exifGpsPresent: boolean;
  } | null;

  // (2) classify
  classification: {
    source: "llm-consensus" | "provided (no LLM keys)";
    issueType: IssueType;
    description: string | null;
    // Present only on the live path.
    consensusMethod?: string;
    confidence?: number;
  };

  // (3) location + source
  location: {
    latitude: number | null;
    longitude: number | null;
    source: "exif" | "provided";
    address: string | null;
    addressSource: "reverse-geocode" | "provided" | "coordinate-fallback";
  };

  // (4) routing
  routing: {
    agencyId: string | null;
    agencyName: string | null;
    jurisdiction: string | null;
    intakeMethod: string | null;
    intakeUrl: string | null;
    intakeEmail: string | null;
    ambiguous: boolean;
    disambiguation: string | null;
    candidates: Array<{
      id: string;
      name: string;
      jurisdiction: string;
      intakeMethod: string;
    }>;
  };

  // (5) assembled would-be payload (NEVER submitted)
  payload: AssembledPayload;

  // (6) readiness summary
  ready: boolean;
  readinessReason: string;

  // The agency it WOULD submit to, made explicit. null => nothing would be sent.
  wouldSubmitTo: string | null;
  submitted: false;
}

/** Pulls the hotline number out of a `contact_phone.value` requiredFields entry. */
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
 * Picks the agency to assemble a payload for. A single confident `agencyId` is
 * used directly. Under routing ambiguity (`agencyId === null`, multiple
 * candidates) we apply the same disambiguation `resolveAgencyId` defers to
 * callers — prefer the API (machine-submittable) candidate, else the first by
 * id — and flag it. This mirrors eval/readiness.ts so the two harnesses agree.
 */
function chooseAgency(resolution: {
  agencyId: string | null;
  candidates: string[];
}): { agency: AgencyRow | undefined; ambiguous: boolean } {
  if (resolution.agencyId) {
    return { agency: agencyById.get(resolution.agencyId), ambiguous: false };
  }
  if (resolution.candidates.length === 0) {
    return { agency: undefined, ambiguous: false };
  }
  const rows = resolution.candidates
    .map((id) => agencyById.get(id))
    .filter((a): a is AgencyRow => a !== undefined);
  const api = rows.find((a) => a.intakeMethod === "API");
  return { agency: api ?? rows[0], ambiguous: true };
}

async function runCase(
  c: PipelineCase,
  hasKeys: boolean,
): Promise<PipelineRecord> {
  // --- (0) load the real image bytes -------------------------------------
  const imgPath = path.join(REPO_ROOT, c.image);
  const bytes = await readFile(imgPath);
  const dataUrl = `data:${c.mime};base64,${bytes.toString("base64")}`;

  // --- (1) preprocess: real EXIF GPS extraction --------------------------
  const pre = await preprocessImage(dataUrl);
  const exifGps = pre.exifGps;

  // Location source: the photo's own EXIF GPS wins; otherwise the dataset's
  // provided coordinate. This is the SAME precedence the real classifier uses
  // (consensus.mergeLocation: caller coords win, else EXIF — here the image has
  // no caller coords baked in, so EXIF wins when present).
  const latitude = exifGps?.latitude ?? c.providedLocation.latitude;
  const longitude = exifGps?.longitude ?? c.providedLocation.longitude;
  const locationSource: "exif" | "provided" = exifGps ? "exif" : "provided";

  // --- (2) classify ------------------------------------------------------
  let classification: PipelineRecord["classification"];
  if (hasKeys) {
    // REAL multi-LLM two-stage classifier. It also re-extracts EXIF GPS and
    // grounds on location; we pass the provided coords so it has location
    // context exactly as production would.
    const result = await classifyWithConsensus(
      c.expected.description ?? "",
      dataUrl,
      {
        twoStage: true,
        location: { latitude, longitude },
      },
    );
    classification = {
      source: "llm-consensus",
      issueType: result.winner.issueType as IssueType,
      description: result.winner.aiDescription,
      consensusMethod: result.method,
      confidence: result.winner.confidence,
    };
  } else {
    // No keys: DO NOT fabricate. Use the dataset's provided classification so
    // the offline location/routing/payload stages still run, and say so.
    classification = {
      source: "provided (no LLM keys)",
      issueType: c.expected.issueType,
      description: c.expected.description,
    };
  }

  // --- (3) reverse-geocode -> address ------------------------------------
  // Best-effort: the REAL reverseGeocode hits Nominatim and already degrades to
  // a coordinate fallback on any failure/timeout, so an offline run never
  // blocks here. We further prefer the dataset address when the geocoder only
  // returns the coordinate fallback, so the report stays readable offline.
  let address: string | null = null;
  let addressSource: PipelineRecord["location"]["addressSource"];
  const coordFallback = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  const geocoded = await reverseGeocode(latitude, longitude);
  if (geocoded && geocoded !== coordFallback) {
    address = geocoded;
    addressSource = "reverse-geocode";
  } else if (c.providedLocation.address) {
    address = c.providedLocation.address;
    addressSource = "provided";
  } else {
    address = coordFallback;
    addressSource = "coordinate-fallback";
  }

  // --- (4) route -> jurisdiction + agency --------------------------------
  const resolution = await resolveAgencyId({
    latitude,
    longitude,
    issueType: classification.issueType,
  });
  const disamb = await resolveAgencyCandidates({
    latitude,
    longitude,
    issueType: classification.issueType,
  });
  const { agency, ambiguous } = chooseAgency(resolution);

  const routing: PipelineRecord["routing"] = {
    agencyId: agency?.id ?? null,
    agencyName: agency?.name ?? null,
    jurisdiction: agency?.jurisdiction ?? null,
    intakeMethod: agency?.intakeMethod ?? null,
    intakeUrl: agency?.intakeUrl ?? null,
    intakeEmail: agency?.intakeEmail ?? null,
    ambiguous,
    disambiguation: disamb.disambiguation,
    candidates: disamb.candidates.map((d) => ({
      id: d.id,
      name: d.name,
      jurisdiction: d.jurisdiction,
      intakeMethod: d.intakeMethod,
    })),
  };

  // --- (5) assemble the would-be payload (NEVER submitted) ---------------
  let payload: AssembledPayload = { kind: "none" };
  let ready = false;
  let readinessReason: string;

  if (!agency) {
    readinessReason =
      "No agency covers this jurisdiction + issue type — nothing would be submitted.";
  } else if (agency.intakeMethod === "API") {
    // REAL Open311 GeoReport v2 body via the production builders.
    const config = parseOpen311Config(agency.requiredFields);
    const serviceCode = resolveServiceCode(classification.issueType, config);
    if (!serviceCode) {
      payload = {
        kind: "open311",
        open311: { endpoint: null, serviceCode: null, body: {} },
      };
      readinessReason = "No Open311 service_code maps to this issue type.";
    } else {
      const params = buildRequestParams(
        {
          issueType: classification.issueType,
          description: classification.description,
          aiDescription: classification.description,
          latitude,
          longitude,
          address,
        },
        serviceCode,
        config,
      );
      const body = Object.fromEntries(params.entries());
      payload = {
        kind: "open311",
        open311: {
          endpoint: config?.endpoint ?? agency.intakeUrl ?? null,
          serviceCode,
          body,
        },
      };
      // GeoReport v2 minimally needs service_code + a location + a description.
      const hasLocation =
        (params.has("lat") && params.has("long")) ||
        params.has("address_string");
      ready =
        params.has("service_code") && params.has("description") && hasLocation;
      readinessReason = ready
        ? "Open311 GeoReport v2 body fully assembled (NOT posted)."
        : "Open311 body missing a GeoReport-required field.";
    }
  } else {
    // WEB_FORM / PHONE / EMAIL: REAL per-field copy-over guide.
    const prefillFields = buildPrefillFields(
      {
        description: classification.description,
        aiDescription: classification.description,
        address,
        latitude,
        longitude,
        imageUrl: c.image,
        createdAt: new Date(),
        contactEmail: c.contactEmail ?? null,
      },
      agency.requiredFields,
    );
    payload = { kind: "prefill", prefillFields };

    // EMAIL: also compose (but DO NOT send) the submission email.
    if (agency.intakeMethod === "EMAIL") {
      const composed = composeSubmissionEmail(
        {
          id: c.id,
          issueType: classification.issueType,
          description: classification.description,
          aiDescription: classification.description,
          latitude,
          longitude,
          address,
          imageUrl: c.image,
        },
        { agencyName: agency.name },
      );
      payload.email = { subject: composed.subject, text: composed.text };
    }

    // Ready when every required field is filled AND a channel resolves.
    const missing = prefillFields.filter((f) => f.required && !f.value);
    const channel =
      agency.intakeUrl ??
      agency.intakeEmail ??
      intakePhone(agency.requiredFields);
    if (!channel) {
      readinessReason =
        "No resolvable intake channel (no URL, email, or hotline).";
    } else if (missing.length > 0) {
      ready = false;
      readinessReason = `Required field(s) not populated: ${missing
        .map((f) => f.key)
        .join(", ")}.`;
    } else {
      ready = true;
      readinessReason = `${agency.intakeMethod} intake reached; all required fields filled (NOT submitted).`;
    }
  }

  return {
    caseId: c.id,
    image: c.image,
    note: c.note ?? null,
    preprocess: {
      width: pre.width,
      height: pre.height,
      byteLength: pre.byteLength,
      originalWidth: pre.originalWidth,
      originalHeight: pre.originalHeight,
      exifGpsPresent: exifGps !== null,
    },
    classification,
    location: {
      latitude,
      longitude,
      source: locationSource,
      address,
      addressSource,
    },
    routing,
    payload,
    ready,
    readinessReason,
    wouldSubmitTo: agency ? agency.name : null,
    submitted: false,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function renderMarkdown(
  records: PipelineRecord[],
  meta: { ranAt: string; mode: string },
): string {
  const lines: string[] = [];
  lines.push("# Image-pipeline verification report");
  lines.push("");
  lines.push(
    "End-to-end run of the REAL Nexa pipeline per image — **stops short of submit, nothing is posted**.",
  );
  lines.push("");
  lines.push(`- Ran at: ${meta.ranAt}`);
  lines.push(`- Classification mode: **${meta.mode}**`);
  lines.push(`- Images: ${records.length}`);
  lines.push(
    "- Submission performed: **NONE** (no Open311 POST, no email send, no DB write)",
  );
  lines.push("");

  for (const r of records) {
    lines.push(`## ${r.caseId}`);
    lines.push("");
    if (r.note) lines.push(`> ${r.note}`);
    lines.push("");
    lines.push(`- **Image:** \`${r.image}\``);
    if (r.preprocess) {
      lines.push(
        `- **Preprocess:** ${r.preprocess.originalWidth}×${r.preprocess.originalHeight} → ${r.preprocess.width}×${r.preprocess.height}, ${r.preprocess.byteLength} bytes; EXIF GPS present: ${r.preprocess.exifGpsPresent}`,
      );
    }
    lines.push(
      `- **Classification (${r.classification.source}):** ${r.classification.issueType}` +
        (r.classification.consensusMethod
          ? ` — method=${r.classification.consensusMethod}, confidence=${r.classification.confidence}`
          : ""),
    );
    lines.push(
      `- **Description:** ${r.classification.description ?? "(none)"}`,
    );
    lines.push(
      `- **Location:** ${r.location.latitude}, ${r.location.longitude} — source: **${r.location.source}**`,
    );
    lines.push(
      `- **Address (${r.location.addressSource}):** ${r.location.address ?? "(none)"}`,
    );
    lines.push(`- **Jurisdiction:** ${r.routing.jurisdiction ?? "(unrouted)"}`);
    lines.push(
      `- **Agency:** ${r.routing.agencyName ?? "(none)"}` +
        (r.routing.ambiguous ? " *(ambiguous routing — disambiguated)*" : ""),
    );
    lines.push(`- **Intake method:** ${r.routing.intakeMethod ?? "(n/a)"}`);
    if (r.routing.disambiguation) {
      lines.push(`- **Disambiguation:** ${r.routing.disambiguation}`);
    }
    if (r.routing.candidates.length > 1) {
      lines.push(
        `- **Candidates:** ${r.routing.candidates
          .map((d) => `${d.name} (${d.intakeMethod})`)
          .join(", ")}`,
      );
    }

    // Assembled payload
    lines.push("");
    lines.push("**Assembled would-be payload (NOT submitted):**");
    lines.push("");
    if (r.payload.kind === "open311" && r.payload.open311) {
      lines.push(
        `Open311 POST → \`${r.payload.open311.endpoint ?? "(no endpoint)"}/requests.json\` (service_code: \`${r.payload.open311.serviceCode}\`)`,
      );
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(r.payload.open311.body, null, 2));
      lines.push("```");
    } else if (r.payload.kind === "prefill" && r.payload.prefillFields) {
      lines.push("| Field | Required | Value | Hint |");
      lines.push("| --- | --- | --- | --- |");
      for (const f of r.payload.prefillFields) {
        lines.push(
          `| ${f.key} | ${f.required ? "yes" : "no"} | ${
            f.value !== null ? f.value.replace(/\|/g, "\\|") : "_(unfilled)_"
          } | ${f.hint ? f.hint.replace(/\|/g, "\\|") : ""} |`,
        );
      }
      if (r.payload.email) {
        lines.push("");
        lines.push(
          `Composed (UNSENT) email — subject: \`${r.payload.email.subject}\``,
        );
        lines.push("");
        lines.push("```");
        lines.push(r.payload.email.text);
        lines.push("```");
      }
    } else {
      lines.push("_(no payload — nothing would be submitted)_");
    }

    lines.push("");
    lines.push(
      `- **Readiness:** ${r.ready ? "READY" : "NOT READY"} — ${r.readinessReason}`,
    );
    lines.push(
      `- **Would submit to:** ${r.wouldSubmitTo ?? "(nothing)"} — **submitted: ${r.submitted}**`,
    );
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

async function main() {
  await loadDeps();
  const args = parseArgs(process.argv);
  const hasKeys = llmKeysPresent();
  const mode = hasKeys
    ? "LLM consensus (live classifier)"
    : "offline (provided classification — no LLM keys)";

  const raw = await readFile(CASES_PATH, "utf-8");
  let cases = JSON.parse(raw) as PipelineCase[];
  if (args.limit !== null) cases = cases.slice(0, args.limit);

  console.log(
    `\n>>> Image-pipeline verification harness — ${mode}, n=${cases.length}`,
  );
  console.log(
    "    (stops short of submit — NOTHING is posted: no Open311 POST, no email, no DB write)\n",
  );

  const records: PipelineRecord[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(
      `  [${(i + 1).toString().padStart(2)}/${cases.length}] ${c.id.padEnd(28).slice(0, 28)} `,
    );
    const r = await runCase(c, hasKeys);
    records.push(r);
    const mark = r.ready ? "✓" : "✗";
    console.log(
      `${mark} ${r.classification.issueType.padEnd(18)} loc:${r.location.source.padEnd(8)} -> ${r.wouldSubmitTo ?? "<unrouted>"}`,
    );
  }

  const ranAt = new Date().toISOString();
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    path.join(RESULTS_DIR, "pipeline.json"),
    JSON.stringify(
      {
        mode,
        classificationMode: hasKeys ? "llm-consensus" : "provided-no-keys",
        datasetSize: cases.length,
        submittedAnything: false,
        ranAt,
        records,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    path.join(RESULTS_DIR, "pipeline.md"),
    renderMarkdown(records, { ranAt, mode }),
  );

  console.log(
    `\nWrote ${records.length} records → eval/results/pipeline.json + pipeline.md`,
  );
  console.log(
    "Confirmation: submittedAnything=false — the harness stopped at the assembled payload.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
