# Routing & Classification Eval Harness

This directory contains the evaluation harness for Nexa's classification
pipeline. It exists to answer one question:

> Does the new two-stage classifier (preprocess + observation + grounded
> consensus) actually beat the original single-stage classifier on real-world
> civic-issue photos — and by how much?

It also operationalises **KPI K1** from the project's OKR document
(*"Eval-set pass rate, weekly, as a CI job on every push to main"*), which had
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

| Wikimedia category | Expected `IssueType`        |
| ------------------ | --------------------------- |
| Potholes           | ROAD_DAMAGE                 |
| Road damage        | ROAD_DAMAGE                 |
| Damaged street lights | STREETLIGHT_OUTAGE       |
| Illegal dumping    | ILLEGAL_DUMPING             |
| Litter             | ILLEGAL_DUMPING             |
| Vehicles emitting smoke | VEHICLE_EMISSIONS      |
| Exhaust smoke      | VEHICLE_EMISSIONS           |

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

| Run | Image preprocess | Stage-1 observation | Location in prompt |
|-----|------------------|---------------------|--------------------|
| `baseline`  | raw image direct to VLMs | none | none |
| `two-stage` | sharp resize/rotate + EXIF GPS extract | gpt-4o-mini observation pass | EXIF/caller GPS folded into stage-2 prompt |

Both runs hit the same three VLMs (OpenAI gpt-4o-mini, Anthropic
claude-haiku-4-5, Google gemini-2.0-flash) and use the same consensus voting.
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

| Item               | Cost  |
|--------------------|-------|
| Baseline run (3 providers × 60 = 180 calls) | ~$0.30 |
| Two-stage run (180 stage-2 calls + 60 stage-1 calls) | ~$0.40 |
| **Total per full eval** | **~$0.70** |

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

## Limitations

- Wikimedia Commons photos are biased toward "good" examples of each
  category — they're curated and well-lit. Real user submissions to Nexa will
  be lower-quality. This eval is a *floor* on what we can expect from the
  models, not a tight estimate of production accuracy.
- EXIF GPS extracted from Commons photos points at the photographer's
  location, which usually correlates with the depicted issue but isn't
  guaranteed. We treat the EXIF GPS as a hint, not as ground truth.
- The "OTHER" class is under-sampled because Commons categories are
  topic-specific. Confusion-matrix off-diagonals involving OTHER should be
  interpreted with that in mind.
