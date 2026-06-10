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
