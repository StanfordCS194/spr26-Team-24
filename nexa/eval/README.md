# Routing & Classification Eval Harness

This directory contains the evaluation harness for Nexa's classification
pipeline. It exists to answer one question:

> Does the new two-stage classifier (preprocess + observation + grounded
> consensus) actually beat the original single-stage classifier on real-world
> civic-issue photos — and by how much?

It also operationalises **KPI K1** from the project's OKR document
(_"Eval-set pass rate, weekly, as a CI job on every push to main"_), which had
been documented but never built.

## Layout

```
eval/
├── dataset/
│   ├── fetch.ts        # builds cases.json by querying Wikimedia Commons
│   ├── cases.json      # ~60-image manifest (URLs + expected labels + EXIF GPS + license)
│   └── _cache/         # downloaded image bytes (gitignored)
├── metrics.ts          # accuracy / per-class / confusion matrix / latency p90
├── run.ts              # main runner — runs baseline and/or two-stage, writes results
├── results/
│   ├── baseline.json   # single-stage predictions + aggregate metrics
│   └── two-stage.json  # two-stage predictions + aggregate metrics
└── README.md           # this file
```

## Methodology

**Dataset.** Images are sourced programmatically from Wikimedia Commons via
the MediaWiki API (`fetch.ts`). Each image is filtered for size (20KB–4MB) and
type (JPEG/PNG), and we keep the file's licence, attribution, EXIF GPS, and
caption alongside the URL in `cases.json`. The team's three existing
`nexa/test-photos/*.jpg` images are included as ground-truth anchor cases.
Categories queried:

| Wikimedia category      | Expected `IssueType` |
| ----------------------- | -------------------- |
| Potholes                | ROAD_DAMAGE          |
| Road damage             | ROAD_DAMAGE          |
| Damaged street lights   | STREETLIGHT_OUTAGE   |
| Illegal dumping         | ILLEGAL_DUMPING      |
| Litter                  | ILLEGAL_DUMPING      |
| Vehicles emitting smoke | VEHICLE_EMISSIONS    |
| Exhaust smoke           | VEHICLE_EMISSIONS    |

`fetch.ts` throttles requests at 1.1s/call and retries on HTTP 429 with
exponential backoff, per Wikimedia's robot policy.

**Metrics.** For each case we record:

- whether the predicted `issueType` matches the expected one (`ok`)
- consensus method used (unanimous / majority / highest-confidence / fallback)
- model-reported confidence
- wall-clock latency for the full pipeline

Aggregated into:

- overall accuracy
- per-class accuracy (with support counts)
- confusion matrix
- mean + p90 latency
- consensus-method breakdown

**Conditions compared.**

| Run         | Image preprocess                       | Stage-1 observation          | Location in prompt                         |
| ----------- | -------------------------------------- | ---------------------------- | ------------------------------------------ |
| `baseline`  | raw image direct to VLMs               | none                         | none                                       |
| `two-stage` | sharp resize/rotate + EXIF GPS extract | gpt-4o-mini observation pass | EXIF/caller GPS folded into stage-2 prompt |

Both runs hit the same three VLMs (OpenAI gpt-4o-mini, Anthropic
claude-haiku-4-5, Google gemini-2.5-flash) and use the same consensus voting.
The only differences are the inputs the VLMs receive.

## Running the eval

Requires API keys in `nexa/.env.local`:

```
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
```

```bash
# 1. Build / refresh the dataset manifest from Wikimedia Commons
npx tsx eval/dataset/fetch.ts

# 2. (Optional) pre-download image bytes to _cache/ so the eval is offline-friendly
npx tsx eval/dataset/fetch.ts --download

# 3. Run the full eval (both baseline and two-stage)
npx tsx eval/run.ts

# Quick smoke run on a subset
npx tsx eval/run.ts --limit=8

# Only one mode
npx tsx eval/run.ts --mode=two-stage
```

Estimated cost on the full ~60-image dataset:

| Item                                                 | Cost       |
| ---------------------------------------------------- | ---------- |
| Baseline run (3 providers × 60 = 180 calls)          | ~$0.30     |
| Two-stage run (180 stage-2 calls + 60 stage-1 calls) | ~$0.40     |
| **Total per full eval**                              | **~$0.70** |

## Reading the results

`results/baseline.json` and `results/two-stage.json` each contain:

```jsonc
{
  "mode": "two-stage",
  "datasetSize": 63,
  "ranAt": "2026-05-22T16:00:00.000Z",
  "predictions": [ { "caseId": "...", "expected": "...", "predicted": "...", "ok": true, ... } ],
  "metrics": { "accuracy": 0.83, "perClass": {...}, "confusion": {...}, ... }
}
```

The runner also prints a human-readable report and a baseline-vs-two-stage
delta to stdout. Capture that into the contributions doc / PR description.

## Submission-filing eval (`eval:submission`)

```bash
npm run eval:submission        # writes eval/results/submission.json
```

The classification evals above answer "did we reach the right agency / can we
populate its fields?". `eval/submission.ts` answers the next question: **does the
submission AGENT actually FILE the report?** It runs the real filing path the
production orchestrator (`src/lib/submission/orchestrate.ts`) takes for every
auto-fileable channel, with the network transport stubbed — no real POST, no real
email, no DB, no LLM.

**Fully offline, same stub as the other submission evals.** It installs the same
in-memory Prisma stub on `globalThis.prisma` (backed by the seeded `AGENCIES`
array) before importing anything, so the production `resolveAgencyId` routes
identically with no `DATABASE_URL`. It reuses the synthetic-report dataset
`dataset/readiness-cases.json` (lat/lng + issueType + report field values).

**Per case** it resolves the agency, then dispatches by `intakeMethod` and runs
the real agent:

- **API** — if `canAutoFileOpen311` says the agency's Open311 config can
  auto-file, it calls the real `submitToOpen311` with an **injected `fetchImpl`**
  that returns a realistic GeoReport v2 success (a `service_request_id`) and
  asserts the agent returns `submitted` with a non-empty tracking id (`filed`).
  When `canAutoFileOpen311` is false — most seeded SeeClickFix agencies omit the
  internal `jurisdiction_id` their multi-tenant write path needs (issues
  #239/#250) — the orchestrator degrades to manual-assist _before_ any POST, so
  the case is classified `manual_assist` (the correct, honest outcome — not a
  failure).
- **EMAIL** — sets `RESEND_API_KEY` + `SUBMISSION_FROM_EMAIL` for the run so the
  agent is "configured", then calls the real `submitViaEmail` with an **injected
  `resendClient`** stub whose `emails.send` returns a message id, asserting
  `submitted` with that id as the tracking id (`filed`).
- **WEB_FORM / PHONE** — no automated agent exists, so the report is handed off to
  manual-assist (`manual_assist`, a correct handoff).

**Primary metric — filing success rate among auto-fileable cases:**

```
filed / (filed + failed)        # manual_assist EXCLUDED from the denominator
```

With a healthy transport the agent must file **every** case it routes to an
auto-fileable channel, so this must be **100%**. The runner exits non-zero if any
auto-fileable case `failed`, or if there are **zero** auto-fileable cases (the
pipeline must actually exercise filing). The dataset's East Palo Alto
illegal-dumping case (`dump-epa-14`) routes to an EMAIL-intake agency, so there is
always at least one real `filed` case. The runner also prints a per-intake-method
breakdown so the report is honest about what auto-files today vs degrades to
manual-assist.

`results/submission.json` records every case (agency, intakeMethod, outcome ∈
{`filed`, `manual_assist`, `failed`}, trackingId, reason) plus the aggregate
metrics, matching how the other evals write their results. (The `eval/results`
directory is prettier-ignored — it is machine-written, not hand-formatted.)

**Honest channel breakdown (current seed).** EMAIL is the only channel that
auto-files today: East Palo Alto Clean City (EMAIL) files via Resend. Every seeded
SeeClickFix API agency degrades to manual-assist because none carries the internal
SeeClickFix organization id required as `jurisdiction_id` (issue #239); add that id
to a seed row and that city's API cases flip to `filed`. WEB_FORM and PHONE intake
always hand off to manual-assist (no automated agent). This is the truthful
picture, not a number inflated by pretending un-fileable channels file.

This eval gates every push (CI `eval` job, alongside `eval:routing`,
`eval:readiness`, and `eval:end-to-end`).

## Limitations

- Wikimedia Commons photos are biased toward "good" examples of each
  category — they're curated and well-lit. Real user submissions to Nexa will
  be lower-quality. This eval is a _floor_ on what we can expect from the
  models, not a tight estimate of production accuracy.
- EXIF GPS extracted from Commons photos points at the photographer's
  location, which usually correlates with the depicted issue but isn't
  guaranteed. We treat the EXIF GPS as a hint, not as ground truth.
- The "OTHER" class is under-sampled because Commons categories are
  topic-specific. Confusion-matrix off-diagonals involving OTHER should be
  interpreted with that in mind.
