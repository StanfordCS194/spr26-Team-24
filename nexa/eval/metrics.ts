import type { IssueType } from "../src/lib/classify/types";

export interface CasePrediction {
  caseId: string;
  expected: IssueType;
  predicted: IssueType;
  confidence: number;
  consensusMethod: string;
  latencyMs: number;
  ok: boolean;
}

export interface AggregateMetrics {
  total: number;
  correct: number;
  accuracy: number;
  perClass: Record<
    string,
    { support: number; correct: number; accuracy: number }
  >;
  confusion: Record<string, Record<string, number>>;
  meanLatencyMs: number;
  p90LatencyMs: number;
  meanConfidence: number;
  consensusBreakdown: Record<string, number>;
}

export function aggregate(predictions: CasePrediction[]): AggregateMetrics {
  const total = predictions.length;
  const correct = predictions.filter((p) => p.ok).length;
  const accuracy = total === 0 ? 0 : correct / total;

  const perClass: AggregateMetrics["perClass"] = {};
  const confusion: AggregateMetrics["confusion"] = {};
  for (const p of predictions) {
    const cls = perClass[p.expected] ?? { support: 0, correct: 0, accuracy: 0 };
    cls.support++;
    if (p.ok) cls.correct++;
    cls.accuracy = cls.support === 0 ? 0 : cls.correct / cls.support;
    perClass[p.expected] = cls;

    const row = confusion[p.expected] ?? {};
    row[p.predicted] = (row[p.predicted] ?? 0) + 1;
    confusion[p.expected] = row;
  }

  const latencies = predictions.map((p) => p.latencyMs).sort((a, b) => a - b);
  const meanLatencyMs =
    latencies.length === 0
      ? 0
      : latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p90LatencyMs =
    latencies.length === 0
      ? 0
      : latencies[
          Math.min(latencies.length - 1, Math.floor(latencies.length * 0.9))
        ];

  const meanConfidence =
    predictions.length === 0
      ? 0
      : predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length;

  const consensusBreakdown: AggregateMetrics["consensusBreakdown"] = {};
  for (const p of predictions) {
    consensusBreakdown[p.consensusMethod] =
      (consensusBreakdown[p.consensusMethod] ?? 0) + 1;
  }

  return {
    total,
    correct,
    accuracy,
    perClass,
    confusion,
    meanLatencyMs,
    p90LatencyMs,
    meanConfidence,
    consensusBreakdown,
  };
}

export function renderReport(label: string, metrics: AggregateMetrics): string {
  const lines: string[] = [];
  lines.push(`\n=== ${label} ===`);
  lines.push(
    `Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%  (${metrics.correct}/${metrics.total})`,
  );
  lines.push(
    `Latency:  mean ${metrics.meanLatencyMs.toFixed(0)}ms  p90 ${metrics.p90LatencyMs.toFixed(0)}ms`,
  );
  lines.push(`Mean confidence: ${metrics.meanConfidence.toFixed(2)}`);

  lines.push("\nPer-class accuracy:");
  const classes = Object.keys(metrics.perClass).sort();
  for (const c of classes) {
    const v = metrics.perClass[c];
    lines.push(
      `  ${c.padEnd(22)} ${(v.accuracy * 100).toFixed(1)}%  (${v.correct}/${v.support})`,
    );
  }

  lines.push("\nConsensus method breakdown:");
  for (const [method, count] of Object.entries(metrics.consensusBreakdown).sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`  ${method.padEnd(22)} ${count}`);
  }

  lines.push("\nConfusion matrix (rows=expected, cols=predicted):");
  const allLabels = new Set<string>();
  for (const expected of Object.keys(metrics.confusion)) {
    allLabels.add(expected);
    for (const predicted of Object.keys(metrics.confusion[expected])) {
      allLabels.add(predicted);
    }
  }
  const labelList = Array.from(allLabels).sort();
  const header = "expected\\predicted";
  lines.push(
    `  ${header.padEnd(22)}${labelList.map((l) => l.slice(0, 8).padStart(10)).join("")}`,
  );
  for (const expected of labelList) {
    const row = metrics.confusion[expected] ?? {};
    const cells = labelList.map((l) => String(row[l] ?? 0).padStart(10));
    lines.push(`  ${expected.padEnd(22)}${cells.join("")}`);
  }

  return lines.join("\n");
}

export function diffReport(
  baselineLabel: string,
  baseline: AggregateMetrics,
  candidateLabel: string,
  candidate: AggregateMetrics,
): string {
  const lines: string[] = [];
  lines.push(`\n=== ${candidateLabel} vs ${baselineLabel} ===`);
  const acc = (m: AggregateMetrics) => (m.accuracy * 100).toFixed(1);
  const delta = (candidate.accuracy - baseline.accuracy) * 100;
  lines.push(
    `Accuracy: ${acc(baseline)}% → ${acc(candidate)}% (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp)`,
  );
  const dlat = candidate.meanLatencyMs - baseline.meanLatencyMs;
  lines.push(
    `Mean latency: ${baseline.meanLatencyMs.toFixed(0)}ms → ${candidate.meanLatencyMs.toFixed(0)}ms (${dlat >= 0 ? "+" : ""}${dlat.toFixed(0)}ms)`,
  );
  return lines.join("\n");
}

/** A single case whose correctness flipped between two eval modes. */
export interface FlipCase {
  caseId: string;
  expected: IssueType;
  baselinePredicted: IssueType;
  candidatePredicted: IssueType;
}

export interface FlipReport {
  /** baseline wrong → candidate right (the candidate's wins) */
  gained: FlipCase[];
  /** baseline right → candidate wrong (the candidate's regressions) */
  regressed: FlipCase[];
  /** per-expected-class net accuracy delta the candidate introduced */
  perClassDelta: Record<
    string,
    { support: number; gained: number; regressed: number; netCases: number }
  >;
}

/**
 * Diff two modes' per-case predictions to surface the exact cases that flipped
 * and the per-category contribution of those flips. This is what makes the
 * two-stage regression in issue #96 measurable and inspectable: the headline
 * accuracy delta alone hides which categories the observation stage helped vs
 * hurt. Acceptance criterion: an ablation/diff documenting the observation's
 * per-category accuracy delta.
 *
 * Both prediction arrays must come from the same dataset; cases present in only
 * one are ignored (a mode may SKIP a case on a transient API error).
 */
export function flipReport(
  baseline: CasePrediction[],
  candidate: CasePrediction[],
): FlipReport {
  const candById = new Map(candidate.map((p) => [p.caseId, p]));
  const gained: FlipCase[] = [];
  const regressed: FlipCase[] = [];
  const perClassDelta: FlipReport["perClassDelta"] = {};

  for (const b of baseline) {
    const c = candById.get(b.caseId);
    if (!c) continue;
    const cls = (perClassDelta[b.expected] ??= {
      support: 0,
      gained: 0,
      regressed: 0,
      netCases: 0,
    });
    cls.support++;
    if (!b.ok && c.ok) {
      gained.push({
        caseId: b.caseId,
        expected: b.expected,
        baselinePredicted: b.predicted,
        candidatePredicted: c.predicted,
      });
      cls.gained++;
      cls.netCases++;
    } else if (b.ok && !c.ok) {
      regressed.push({
        caseId: b.caseId,
        expected: b.expected,
        baselinePredicted: b.predicted,
        candidatePredicted: c.predicted,
      });
      cls.regressed++;
      cls.netCases--;
    }
  }

  return { gained, regressed, perClassDelta };
}

export function renderFlipReport(
  candidateLabel: string,
  report: FlipReport,
): string {
  const lines: string[] = [];
  lines.push(`\n=== ${candidateLabel}: per-case flips vs baseline ===`);
  lines.push(
    `Gained (baseline wrong → ${candidateLabel} right): ${report.gained.length}`,
  );
  for (const f of report.gained) {
    lines.push(
      `  + ${f.caseId.slice(0, 50).padEnd(50)} ${f.baselinePredicted} → ${f.candidatePredicted}  (expected ${f.expected})`,
    );
  }
  lines.push(
    `Regressed (baseline right → ${candidateLabel} wrong): ${report.regressed.length}`,
  );
  for (const f of report.regressed) {
    lines.push(
      `  - ${f.caseId.slice(0, 50).padEnd(50)} ${f.baselinePredicted} → ${f.candidatePredicted}  (expected ${f.expected})`,
    );
  }

  lines.push("\nPer-class net contribution of the candidate stage:");
  const classes = Object.keys(report.perClassDelta).sort();
  for (const cls of classes) {
    const d = report.perClassDelta[cls];
    const sign = d.netCases > 0 ? "+" : "";
    lines.push(
      `  ${cls.padEnd(22)} support=${String(d.support).padStart(3)}  +${d.gained} −${d.regressed}  net=${sign}${d.netCases} case(s)`,
    );
  }
  return lines.join("\n");
}
