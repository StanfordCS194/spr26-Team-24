# Eval Run Summary — 2026-05-22 (325-case dataset)

Headline numbers from `npm run eval` over a 325-case dataset (322
Wikimedia Commons images + 3 team test-photos).

## Providers

- OpenAI `gpt-4o-mini`
- Anthropic `claude-haiku-4-5`
- Google `gemini-2.5-flash`

## Headline

| | Baseline | Two-stage | Δ |
| --- | --- | --- | --- |
| Overall accuracy | **66.8%** (217/325) | 62.2% (202/325) | **−4.6 pp** |
| Mean latency | 6,511 ms | 8,985 ms | +2,473 ms |
| Mean confidence | 0.90 | 0.93 | +0.03 |

## Per-class accuracy

| Class | Support | Baseline | Two-stage | Δ |
| --- | --- | --- | --- | --- |
| ROAD_DAMAGE | 138 | 47.1% | 45.7% | −1.4 |
| ILLEGAL_DUMPING | 119 | 89.1% | 85.7% | −3.4 |
| VEHICLE_EMISSIONS | 52 | 71.2% | 55.8% | **−15.4** |
| STREETLIGHT_OUTAGE | 16 | 56.3% | 50.0% | −6.3 |

## Consensus method

| Method | Baseline | Two-stage |
| --- | --- | --- |
| `unanimous` | 242 | **272** |
| `majority` | 49 | 30 |
| `highest-confidence` | 18 | 23 |
| `fallback` (all 3 providers failed) | **16** | **0** |

## Confusion matrices

### Baseline

```
expected\predicted        ILLEGAL_   OTHER  ROAD_DAM  STREETLI  VEHICLE_
ILLEGAL_DUMPING              106       12        0        0        1
ROAD_DAMAGE                    2       71       65        0        0
STREETLIGHT_OUTAGE             1        6        0        9        0
VEHICLE_EMISSIONS              0       15        0        0       37
```

### Two-stage

```
expected\predicted        ILLEGAL_   OTHER  ROAD_DAM  STREETLI  VEHICLE_
ILLEGAL_DUMPING              102       17        0        0        0
ROAD_DAMAGE                    1       74       63        0        0
STREETLIGHT_OUTAGE             1        7        0        8        0
VEHICLE_EMISSIONS              0       23        0        0       29
```

## Per-case crosstab

- Both modes correct: 193
- Both modes wrong: 98
- Baseline wrong → two-stage right: **9** (6 ROAD_DAMAGE, 2 ILLEGAL_DUMPING, 1 VEHICLE_EMISSIONS)
- Baseline right → two-stage wrong: **24** (9 VEHICLE_EMISSIONS, 8 ROAD_DAMAGE, 6 ILLEGAL_DUMPING, 1 STREETLIGHT_OUTAGE)

Net: 9 − 24 = **−15 cases** = −4.6 pp.

## Robustness wins (independent of accuracy)

| Failure mode | Baseline | Two-stage |
| --- | --- | --- |
| All-3-providers-failed cases (`fallback`) | 16 | **0** |
| Inter-provider unanimity | 242 / 325 (74%) | **272 / 325 (84%)** |
| Anthropic 5 MB image rejections | counted in the 16 fallbacks above | 0 |
| EXIF GPS extracted from image | 0 | 103 / 325 |

## Label-noise caveat (important)

The Wikimedia categories `Subsidence`, `Sinkholes`, and `Flood damage` are
labelled as `ROAD_DAMAGE` in this dataset but actually contain a mix of
satellite imagery, building subsidence, and field sinkholes that are
genuinely not road damage. We measured roughly 28 such cases in the
`ROAD_DAMAGE` support of 138. Both pipelines classify most of these as
`OTHER`, which is arguably the *correct* answer for those images.

Recomputing `ROAD_DAMAGE` accuracy after excluding those ~28
label-noise cases would put baseline ROAD_DAMAGE around **59% (65/110)**
and two-stage around **57% (63/110)** — same shape, less drama.

## How to reproduce

```bash
cd nexa
cp .env.example .env.local && fill in OPENAI/ANTHROPIC/GOOGLE keys
npm run eval:fetch:download
npm run eval
```

Raw per-case predictions land in `eval/results/{baseline,two-stage}.json`
(gitignored).
