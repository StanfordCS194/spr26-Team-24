# Sarah Hashash — Nexa Contributions

This document summarises my individual contributions to Nexa (Stanford CS194,
spr26-Team-24). It's organised by feature so the TA can walk each one
end-to-end.

---

## 1. Two-stage classification pipeline with location grounding (headline contribution)

**Branch:** `feat/two-stage-classification-eval` · **Commit:** `2585875`

### The problem

Nexa's original classifier (`src/lib/classify/`) sent the user's raw photo —
straight off their camera, no preprocessing — to three vision-language models
in parallel, with an identical one-shot prompt asking each to pick a civic
issue type. Three independent gaps fell out of reading the code:

1. **No image preprocessing.** Raw 3–5 MB phone photos went to the VLMs as-is.
   Token cost and latency were higher than necessary, EXIF orientation was
   ignored (sideways photos), and blurry / dark images hit the model
   unfiltered.
2. **No structured visual grounding.** The model saw a photo and had to both
   *describe* it and *classify* it in one shot. No first-pass extraction of
   what objects were actually present.
3. **Location was dropped on the floor at classification time.** The wizard
   collected GPS and an address, but neither was sent to the classifier. A
   photo of "something on a road" was classified identically whether it was
   in a residential block or a county dirt road.

None of this was captured as an issue — I found it by reading
`src/lib/classify/consensus.ts` and `openai-provider.ts` end-to-end.

### What I built

A two-stage pipeline that addresses all three gaps:

```
   ┌────────────────────────┐
   │ raw image + description│
   └─────────┬──────────────┘
             │
   ┌─────────▼──────────────┐
   │ STAGE 0: preprocess    │   sharp resize/auto-rotate
   │  preprocess.ts         │   EXIF GPS extraction
   └─────────┬──────────────┘
             │
   ┌─────────▼──────────────┐
   │ STAGE 1: observe       │   gpt-4o-mini, single call
   │  observe.ts            │   { objects, conditions, hazards, scene }
   └─────────┬──────────────┘
             │
   ┌─────────▼──────────────┐
   │ STAGE 2: classify      │   three VLMs in parallel
   │  consensus.ts (updated)│   each sees stage-1 + location context
   └─────────┬──────────────┘
             │
        consensus winner
```

Concretely:

- **`src/lib/classify/preprocess.ts`** (new). Uses `sharp` to auto-rotate
  from EXIF orientation, downscale to max 1024 px (preserves aspect),
  re-encode as JPEG at quality 80 with mozjpeg. Cuts a typical phone photo
  from ~4 MB → ~200 KB, which directly translates to lower VLM cost and
  latency. Reads EXIF GPS with `exifr` *before* sharp touches the buffer
  (sharp strips EXIF as part of re-encoding).
- **`src/lib/classify/observe.ts`** (new). Stage 1 — one low-cost
  `gpt-4o-mini` call with a prompt that asks for structured observation, not
  classification: `{objects[], conditions[], hazards[], scene}`. Returns
  null on failure so stage 2 still runs.
- **`src/lib/classify/types.ts`** (extended). New `LocationContext` type and
  `buildClassificationPrompt({observationBlock, location})` helper that
  composes the stage-2 prompt from the original guidelines + stage-1
  observations + location lines (address, coordinates to 5 decimals,
  jurisdiction). The original single-stage `CLASSIFICATION_PROMPT` export is
  preserved for back-compat.
- **`src/lib/classify/consensus.ts`** (rewritten). New `classifyWithConsensus`
  signature accepts `{twoStage, location}`. When `twoStage` is true and an
  image is supplied, runs preprocess → observe → build stage-2 prompt →
  three providers. The three providers each take an optional `prompt`
  override so they all share the same grounded stage-2 prompt. Caller GPS
  takes precedence over EXIF GPS; EXIF fills in when caller didn't supply
  coords. Returns an `ExtendedComparisonResult` that surfaces the stage-1
  observation, preprocessing metadata, and which location actually got used,
  so the UI / eval harness can inspect the pipeline.
- **`src/lib/classify/openai-provider.ts`, `anthropic-provider.ts`,
  `google-provider.ts`** (extended). Each accepts an optional `{prompt}` so
  the orchestrator can pass the grounded prompt without each provider having
  to know about observations.
- **`src/app/api/reports/classify/route.ts`** (extended). Accepts optional
  `latitude`, `longitude`, `address`, `jurisdiction` from the wizard and
  passes them through; defaults to `twoStage: true` in production.
- **`src/app/report/page.tsx`** (updated). The report wizard now sends GPS
  and address to `/api/reports/classify`. Previously these were collected
  but only sent on submit.

### Walkthrough for the TA

1. Open `src/lib/classify/consensus.ts:108`. The top-level docstring
   ASCII-diagrams the new pipeline.
2. Step into `preprocessImage()` at `preprocess.ts:35` — note the EXIF read
   happens *before* the sharp re-encode (line 50 vs. line 65), because sharp
   strips orientation metadata and on some encoders also drops GPS.
3. Step into `observeImage()` at `observe.ts:42`. Note the prompt
   explicitly tells the model **not** to classify — only describe. This is
   what keeps stage 1 cheap and accurate.
4. Step into `buildClassificationPrompt()` at `types.ts:67`. Show how the
   stage-2 prompt is composed from three sources.
5. Show the API route at `route.ts:30` passing `{twoStage: true, location}`.
6. Run the dev server and submit a report with a photo from a known
   location. Open DevTools → Network → `/api/reports/classify` response.
   Note the new fields: `observation`, `preprocess`, `locationUsed`.

---

## 2. Eval harness for KPI K1 (companion to contribution #1)

**Branch:** `feat/two-stage-classification-eval` · **Files:** `eval/`

The OKR document (`Measure-For-Success.md`, KPI K1) commits the team to a
weekly eval pass rate run as a CI job. The harness for that didn't exist.
I built it.

### What's here

- **`eval/dataset/fetch.ts`** — programmatic dataset builder. Queries
  Wikimedia Commons categories (`Potholes`, `Road damage`,
  `Damaged street lights`, `Illegal dumping`, `Litter`,
  `Vehicles emitting smoke`, `Exhaust smoke`) via the MediaWiki API,
  filters for size/type, captures licence + attribution + EXIF GPS per
  image, and writes a manifest. Throttled at 1.1s/call with exponential
  backoff on 429.
- **`eval/dataset/cases.json`** — the dataset manifest, ~60 images +
  the team's 3 existing `test-photos/*.jpg` as ground-truth anchors.
  Tracked in git for reproducibility; the actual image bytes are
  downloaded on demand into `_cache/` (gitignored).
- **`eval/run.ts`** — the runner. Loads cases, hits the classifier in
  both `baseline` and `two-stage` modes, writes per-case predictions and
  aggregate metrics to `results/baseline.json` and `results/two-stage.json`,
  and prints a delta report.
- **`eval/metrics.ts`** — accuracy, per-class accuracy with support, full
  confusion matrix, mean + p90 latency, mean reported confidence, consensus
  method breakdown. Pretty-printer included.
- **`eval/README.md`** — methodology, how to run, cost estimate, known
  limitations of the dataset.

### Results

> Run `npm run eval` locally with `.env.local` populated to populate this
> section with real numbers. Output will be saved at `eval/results/`.

After the eval runs the table below will be filled in:

| Metric | Baseline (single-stage) | Two-stage | Δ |
|---|---|---|---|
| Overall accuracy | _TBD_ | _TBD_ | _TBD_ |
| ROAD_DAMAGE accuracy | _TBD_ | _TBD_ | _TBD_ |
| STREETLIGHT_OUTAGE accuracy | _TBD_ | _TBD_ | _TBD_ |
| ILLEGAL_DUMPING accuracy | _TBD_ | _TBD_ | _TBD_ |
| VEHICLE_EMISSIONS accuracy | _TBD_ | _TBD_ | _TBD_ |
| Mean latency | _TBD_ ms | _TBD_ ms | _TBD_ ms |
| Mean payload size sent to VLMs | _TBD_ KB | _TBD_ KB | _TBD_ KB |

### Walkthrough for the TA

1. `eval/README.md` — explain dataset sourcing, attribution, throttling.
2. `eval/dataset/fetch.ts:60` — show the categories array and how the
   manifest is composed.
3. `cat eval/dataset/cases.json | jq '.[0]'` — show a single case with
   its licence + attribution + EXIF GPS.
4. `eval/run.ts:103` — show the per-case loop calling
   `classifyWithConsensus` with `twoStage` toggling between baseline and
   the new pipeline.
5. `eval/metrics.ts:120` — show the confusion-matrix pretty-printer.
6. `cat eval/results/two-stage.json | jq '.metrics'` — read the actual
   numbers off disk.

---

## 3. Other contributions in this repo

These are smaller, already-merged or open PRs that aren't the headline story
but are part of my contribution to the project:

- **PR #66 / `feat/relative-timestamps`** — relative timestamps on the
  dashboard ("2 days ago" instead of full ISO).
- **PR #72 / `feat/is-it-fixed-prompt`** — "Was this fixed?" prompt for
  reports older than 14 days without API tracking. Closes issue #39.
  Schema change (`Report.userResolved`, `Report.userResolvedAt`),
  `/api/reports/[id]/resolution` endpoint, dashboard prompt component.
- **`feat/agency-seed-data`** — agency intake-methods seed for Palo Alto
  and neighbouring jurisdictions. Adds `requiredFields` JSON column,
  `prisma/seed.ts`, and a deterministic seed for issue #25.
- **`fix/auth-login-password-verification`** — discovered and fixed: the
  login route was upserting users by email and never checking the
  password. Anyone who knew an email could sign in as that user, and the
  bug had silently created passwordless `User` rows for every email
  anyone had ever typed into the form. Fix verifies via
  `bcrypt.compare`, adds `/claim` flow for legitimate owners of orphaned
  accounts, and ships `scripts/audit-passwordless-users.ts` for cleanup.

## How to verify

```bash
# Switch to the headline branch
git checkout feat/two-stage-classification-eval

# Confirm the commit
git log --oneline -1   # 2585875 feat(classify): two-stage classification...

# See exactly what changed
git diff main...feat/two-stage-classification-eval --stat

# Run the eval (needs API keys in .env.local)
npm run eval
```
