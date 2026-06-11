# Eval Run Summary — 2026-05-22

Headline numbers from running `npm run eval` over the full 76-image
dataset (73 Wikimedia Commons + 3 team test-photos).

## Providers

- OpenAI `gpt-4o-mini`
- Anthropic `claude-haiku-4-5`
- Google `gemini-2.5-flash`

## Headline

|                  | Baseline          | Two-stage     | Δ           |
| ---------------- | ----------------- | ------------- | ----------- |
| Overall accuracy | **92.1%** (70/76) | 89.5% (68/76) | **−2.6 pp** |
| Mean latency     | 5,471 ms          | 7,302 ms      | +1,832 ms   |
| Mean confidence  | 0.938             | 0.950         | +0.012      |

## Per-class accuracy

| Class              | Support | Baseline | Two-stage |
| ------------------ | ------- | -------- | --------- |
| ROAD_DAMAGE        | 25      | 100%     | 92.0%     |
| ILLEGAL_DUMPING    | 25      | 96.0%    | 96.0%     |
| STREETLIGHT_OUTAGE | 12      | 66.7%    | 66.7%     |
| VEHICLE_EMISSIONS  | 14      | 92.9%    | 92.9%     |

## Consensus method

| Method               | Baseline | Two-stage |
| -------------------- | -------- | --------- |
| `unanimous`          | 63       | **67**    |
| `majority`           | 8        | 9         |
| `highest-confidence` | 5        | **0**     |

## Confusion matrices

### Baseline

```
expected\predicted        ILLEGAL_   OTHER  ROAD_DAM  STREETLI  VEHICLE_
ILLEGAL_DUMPING               24       1        0        0        0
ROAD_DAMAGE                    0       0       25        0        0
STREETLIGHT_OUTAGE             0       4        0        8        0
VEHICLE_EMISSIONS              0       1        0        0       13
```

### Two-stage

```
expected\predicted        ILLEGAL_   OTHER  ROAD_DAM  STREETLI  VEHICLE_
ILLEGAL_DUMPING               24       1        0        0        0
ROAD_DAMAGE                    0       2       23        0        0
STREETLIGHT_OUTAGE             0       4        0        8        0
VEHICLE_EMISSIONS              0       1        0        0       13
```

## Per-case crosstab

- Both modes correct: 67
- Both modes wrong: 5
- Baseline wrong → two-stage right: **1**
  - `Broken_4182613125_.jpg`: OTHER → STREETLIGHT_OUTAGE
- Baseline right → two-stage wrong: **3**
  - `Flood_damage_in_American_Fork_Canyon_June_2023.jpg`: ROAD_DAMAGE → OTHER
  - `Vddj-1.jpg`: ROAD_DAMAGE → OTHER
  - `M_Infraestrutura.jpg`: STREETLIGHT_OUTAGE → OTHER

Net: 1 − 3 = **−2 cases** = −2.6 pp.

## Robustness wins (independent of accuracy)

| Failure mode                                                | Baseline | Two-stage |
| ----------------------------------------------------------- | -------- | --------- |
| Anthropic 5 MB image rejections (raw phone-sized photos)    | ~5 cases | 0         |
| Highest-confidence tiebreaker fired (no provider agreement) | 5 cases  | 0         |
| EXIF GPS extracted as fallback location                     | 0        | 24 / 76   |

## How to reproduce

```bash
cd nexa
cp .env.example .env.local && fill in OPENAI/ANTHROPIC/GOOGLE keys
npm run eval:fetch:download
npm run eval
```

Raw per-case predictions land in `eval/results/{baseline,two-stage}.json`
(gitignored).

---

## Investigation: two-stage regression (issue #96)

The headline above shows two-stage regressing −2.6 pp, driven entirely by three
`X → OTHER` flips after the stage-1 observation pass:

| Case                                            | Baseline           | Two-stage |
| ----------------------------------------------- | ------------------ | --------- |
| `Flood_damage_in_American_Fork_Canyon_..._2023` | ROAD_DAMAGE        | OTHER     |
| `Vddj-1.jpg`                                    | ROAD_DAMAGE        | OTHER     |
| `M_Infraestrutura.jpg`                          | STREETLIGHT_OUTAGE | OTHER     |

### Static analysis of plausible causes

1. **Low-signal observation poisoning the prompt (most likely).** All three
   regressions flip _to_ OTHER, and OTHER is the "doesn't clearly fit"
   bucket. `renderObservation` previously emitted a `Stage-1 visual
observations:` header even when the observation carried no concrete
   objects/conditions/hazards. An empty-but-present block adds no grounding yet
   primes the classifier to expect that "the structured observation didn't find
   anything definitive" — a nudge toward hedging. The stage-1 model
   (`gpt-4o-mini`, `detail: "low"`, 250 max tokens) is exactly the case most
   likely to return a thin observation on a hard image (flood-damaged road,
   distant streetlight).

2. **No quality gate on stage 1.** `observeImage` has no confidence/quality
   threshold — any successfully-parsed observation, however thin, is fed
   forward. A blurry/empty image legitimately yields empty arrays (the prompt
   says so), and that empty result was still rendered into the prompt.

3. **Consensus tie-break was order-dependent.** `pickWinner`'s
   highest-confidence and majority paths used `reduce(... a.confidence >= b.confidence ...)`,
   which on an exact confidence tie keeps whichever provider responded first in
   the `Promise.all` array (openai, anthropic, google). That is an undocumented
   tiebreaker that could move with provider ordering. (Note: the tiebreaker
   fired 5× in baseline and 0× in two-stage, so it is _not_ the direct cause of
   these three flips — but it is a latent determinism bug worth fixing while
   here.)

4. **Preprocessing** (downscale + EXIF) is unlikely to cause classification
   flips on its own — it mainly fixed the Anthropic 5 MB rejections and added
   EXIF GPS. Ruled out as a regression cause.

### Conservative changes shipped in this PR

These are behavior-safe and justifiable _without_ new eval data — none can move
two-stage _away_ from baseline:

- **Observation quality gate** (`observe.ts`): `renderObservation` now drops an
  observation carrying fewer than `MIN_OBSERVATION_SIGNALS` (= 1) concrete
  signals — i.e. a zero-signal observation collapses the stage-2 prompt back to
  the exact baseline single-stage prompt. `scene` is deliberately excluded from
  the signal count (the prompt fills it even for empty images).
  `MIN_OBSERVATION_SIGNALS` is exposed as a tunable constant; raising it trades
  grounding for safety and MUST be validated empirically before changing.
- **Deterministic consensus tie-break** (`consensus.ts`): `pickWinner` now
  breaks exact confidence ties by lexicographic provider name and picks the
  majority block deterministically (votes → peak confidence → issue type),
  removing the dependency on provider call order. Behavior-preserving whenever
  there is a clear confidence max.
- **Measurable eval reporting** (`eval/run.ts`, `eval/metrics.ts`): a new
  per-case flip diff (`flipReport` / `renderFlipReport`) prints, and writes
  `eval/results/flips.json`, the exact gained/regressed cases plus the
  per-category net contribution of the observation stage — so the regression is
  inspectable, not just a single accuracy number.

### REQUIRED empirical validation (human / CI step)

This environment has **no live LLM API keys**, so the numbers above were NOT
re-measured and the gate's effect on the three flips is a hypothesis, not a
result. Before relying on these changes:

```bash
cd nexa
cp .env.example .env.local   # fill in OPENAI / ANTHROPIC / GOOGLE keys
npm run eval:fetch:download
npm run eval                 # --mode=both: emits the flip diff + flips.json
# or run the two modes separately for a clean A/B:
npm run eval:baseline
npm run eval:two-stage
```

Then confirm against the issue-#96 acceptance criteria:

- [ ] The three known regressions (`Flood_damage…`, `Vddj-1`, `M_Infraestrutura`)
      no longer flip to OTHER, OR the trade-off is recorded here.
- [ ] Overall two-stage accuracy ≥ baseline (and ≥ 80% per O1.KR1).
- [ ] ROAD_DAMAGE per-class accuracy not regressed vs the 100% baseline.
- [ ] `eval/results/flips.json` shows the per-category observation delta.

If the gate alone does not recover all three, the next lever to evaluate
(empirically) is raising `MIN_OBSERVATION_SIGNALS`, or adding a stage-1
confidence signal to the observation schema — do **not** ship either without
eval data.

---

## Submission-readiness baseline (K3) — issue #197

`npm run eval:readiness` runs the offline submission-readiness harness
(`eval/readiness.ts`): for each synthetic civic report it reuses the production
`resolveAgencyId` (backed by an in-memory Prisma stub) plus the real Open311
param builders to confirm we can reach an agency's intake channel and populate
every required field — **without any network, DB, or real POST**.

The harness exits non-zero when readiness falls below the **≥90% K3 target**
(same gating pattern as `eval/routing.ts` at 85%), so the eval CI job fails on
regressions. CI now runs this step and a committed baseline lives at
`eval/results/readiness.json` (un-ignored via `nexa/.gitignore`).

### Baseline (after the 11-municipality e2e-coverage expansion)

The dataset was expanded so every one of the 11 served municipalities has each
of its agencies exercised for required-field filling, plus robustness cases
(boundary side-of-seam, missing-required negative controls, and an
outside-all-jurisdictions case). The outside-jurisdiction case is **excluded
from the readiness rate** (there is no intake to fill) but still runs to prove
graceful no-agency handling.

| Metric                  | Value         |
| ----------------------- | ------------- |
| Submission readiness    | **93.9%** (31/33) — PASS vs ≥90% |
| Routed (reached agency) | 97.1% (33/34) |
| Excluded (out-of-area)  | 1 (outside all jurisdictions) |

| Issue type         | Support | Readiness |
| ------------------ | ------- | --------- |
| ROAD_DAMAGE        | 10      | 100.0%    |
| ILLEGAL_DUMPING    | 7       | 100.0%    |
| STREETLIGHT_OUTAGE | 3       | 100.0%    |
| SIDEWALK_DAMAGE    | 2       | 100.0%    |
| GRAFFITI           | 2       | 50.0%     |
| VEHICLE_EMISSIONS  | 3       | 66.7%     |
| ABANDONED_VEHICLE / CODE_ENFORCEMENT / FLOODING_DRAINAGE / PARKING / TRAFFIC_SIGNAL / TREE_MAINTENANCE | 1 each | 100.0% |

| Intake method | Support | Readiness |
| ------------- | ------- | --------- |
| API           | 15      | 100.0%    |
| WEB_FORM      | 14      | 92.9%     |
| EMAIL         | 1       | 100.0%    |
| PHONE         | 3       | 66.7%     |

The not-ready cases are intentional negative controls that keep the dataset
honest about the floor: `emit-pa-12-incomplete` (CARB smoking-vehicle report
missing required vehicle fields, PHONE) and `graffiti-pa-33-missing-required`
(Palo Alto 311 report with no `location_address`, WEB_FORM) — each proves the
required-field gate actually fails when a required value is absent. Above the
90% gate.

### How to reproduce

```bash
cd nexa
npm ci
npx prisma generate   # readiness imports the generated Prisma client
npm run eval:readiness # exits 0 at >=90%, non-zero below
```

---

## Submission-filing baseline (agent actually files)

`npm run eval:submission` runs the offline submission-filing harness
(`eval/submission.ts`): where the readiness eval stops short of submitting, this
one actually runs the submission **agent** and FILES each report for every
auto-fileable channel, with the network transport stubbed. It reuses the same
in-memory Prisma stub + `resolveAgencyId` as the readiness eval, then calls the
real `submitToOpen311` / `submitViaEmail` with injected `fetchImpl` / `resendClient`
stubs — **no real POST, no real email, no DB, no LLM**.

**Primary metric — filing success among auto-fileable cases** = `filed / (filed +
failed)`, with `manual_assist` excluded from the denominator. It must be **100%**,
and there must be ≥1 auto-fileable case; the harness exits non-zero otherwise, so
the CI `eval` job fails on a regression. A committed baseline lives at
`eval/results/submission.json` (un-ignored via `nexa/.gitignore`).

### Baseline (after the 11-municipality e2e-coverage expansion)

| Metric                              | Value                          |
| ----------------------------------- | ------------------------------ |
| Filing success (auto-fileable)      | **100.0%** (1/1) — PASS         |
| Outcomes                            | 1 filed · 32 manual-assist · 1 no-agency(out-of-area) · 0 failed (n=34) |

| Intake method | filed | manual_assist | no_agency | failed |
| ------------- | ----- | ------------- | --------- | ------ |
| API           | 0     | 15            | 0         | 0      |
| EMAIL         | 1     | 0             | 0         | 0      |
| PHONE         | 0     | 3             | 0         | 0      |
| WEB_FORM      | 0     | 14            | 0         | 0      |
| (unrouted)    | 0     | 0             | 1         | 0      |

Every `manual_assist` handoff is now asserted to carry a non-null intake target
(the agency's form URL, intake email, or hotline phone), so the dataset proves
each un-fileable channel still surfaces a real destination to file at. The
`no_agency` case is the outside-all-jurisdictions robustness report (Pacific
Ocean off the California coast): it resolves to no agency and is handled
gracefully — counted separately, NOT as a filing failure, so it does not trip
the 100%-of-auto-fileable gate.

Honest channel breakdown: **EMAIL is the only channel that auto-files today** —
East Palo Alto Clean City files via Resend (`dump-epa-14`). Every seeded
SeeClickFix API agency degrades to manual-assist because none carries the internal
SeeClickFix organization id needed as `jurisdiction_id` (issue #239); adding that
id to a seed row flips that city's API cases to `filed`. WEB_FORM and PHONE intake
always hand off to manual-assist (no automated agent). These manual-assist
outcomes are correct handoffs, not failures, so they are excluded from the metric.

### How to reproduce

```bash
cd nexa
npm ci
npx prisma generate   # submission imports the generated Prisma client
npm run eval:submission # exits 0 at 100% of auto-fileable, non-zero on any failure
```

---

## Continuous-verification strategy for the classification eval (K1) — issue #209

K1 is _"eval-set pass rate, weekly, ≥70%"_. The classification eval that serves
K1 (`npm run eval` → `eval/run.ts`) is **intentionally not run in CI**, so this
section documents how it is verified on a cadence instead.

### Why classification is out of CI

`eval/run.ts` calls `classifyWithConsensus`, which makes live calls to three
paid VLM providers (OpenAI `gpt-4o-mini`, Anthropic `claude-haiku-4-5`, Google
`gemini-2.5-flash`). Running it in CI would (a) require committing/secret-loading
paid API keys, and (b) break pull requests from forks, which never get repo
secrets. The CI `eval` job therefore gates only the **offline** evals — routing
(`eval:routing`, O2.KR1 ≥85%), boundary validation (`eval:validate-boundaries`),
and submission-readiness (`eval:readiness`, K3 ≥90%) — none of which touch an LLM
or the network. See `.github/workflows/ci.yml` (the `eval` job comments make the
exclusion explicit).

These offline evals **complement** the classification eval rather than replace
it: routing/readiness verify that _once an issue is classified_ the report is
routed to a real agency and every required intake field is populated, while the
classification eval verifies the upstream step — that the VLM consensus actually
assigns the correct `IssueType` to a real photo. K1 specifically covers the
classification step, which only the LLM eval can measure.

### Cadence, owner, threshold, results location

| Aspect              | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Cadence             | Weekly (out of CI; manual run or a scheduled/gated job with secrets)  |
| Owner               | Eval maintainer (`@sarahhashash`) — reassign as the team rotates       |
| Threshold (K1)      | Weekly eval pass rate **≥70%**; classification accuracy floor **≥80%** (O1.KR1) |
| Results location    | This file — append a dated row to the table below each run            |
| Baseline of record  | **92.1%** overall accuracy (70/76), 2026-05-22 (see Headline, top)    |

### How / when to run it

Run weekly from a machine that has the three API keys (a maintainer's laptop or a
scheduled out-of-CI job, e.g. a scheduled cloud agent, that injects the keys as
secrets — keys must never enter the public CI workflow):

```bash
cd nexa
cp .env.example .env.local   # fill in OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY
npm run eval:fetch:download  # refresh/pre-cache the dataset (offline-friendly)
npm run eval                 # both modes over the full dataset; ~$0.70/run
```

`eval/run.ts` prints overall accuracy, per-class accuracy, the confusion matrix,
and the baseline-vs-two-stage flip diff, and writes
`eval/results/{baseline,two-stage}.json` (gitignored). Read the overall accuracy
off stdout, then record it in the table below.

> Note: unlike `eval:routing` / `eval:readiness`, `eval/run.ts` does **not** yet
> exit non-zero below a threshold — it is a reporter, not a gate. The weekly
> check is therefore a human read of the printed accuracy against the ≥70% /
> ≥80% thresholds. If/when the eval is wired into a scheduled job with secrets,
> add an accuracy gate there (mirroring the `TARGET_ACCURACY` pattern in
> `eval/routing.ts`) so the run fails the cadence below target.

### Weekly K1 log

> Append one row per weekly run. Do not fabricate — only record accuracy actually
> printed by `npm run eval`. The 2026-05-22 baseline row is the run captured in
> the Headline section above.

| Date (UTC) | Overall accuracy | n     | Pass (≥70% / ≥80%)? | Run by | Notes              |
| ---------- | ---------------- | ----- | ------------------- | ------ | ------------------ |
| 2026-05-22 | 92.1%            | 76    | PASS                | team   | Baseline (Headline) |
| _TODO_     | _TODO_           | _TODO_| _TODO_              | _TODO_ | _TODO_             |
