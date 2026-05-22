# Eval Run Summary — 2026-05-22

Headline numbers from running `npm run eval` over the full 76-image
dataset (73 Wikimedia Commons + 3 team test-photos). See
`CONTRIBUTIONS.md` § 2 for the full discussion.

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
