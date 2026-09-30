import type { Finding } from '@ic/core';

export interface EvalCase {
  inspectionId: string;
  condition: string;
  span: number;
  truth: { value: number; readable: boolean; defects: string[]; robotFault: string };
  predicted: { readable: boolean; value: number | null; defects: string[]; confidence: number };
  finding: Finding;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface Report {
  cases: number;
  readableCases: number;
  /** Of truly readable gauges, share the model read within tolerance. */
  accuracyWithinTolerance: number;
  meanAbsErrorPctSpan: number;
  /** Of truly unreadable images, share the model correctly refused to read. */
  unreadableRecall: number;
  /** Of readable images, share the model wrongly refused. */
  falseRefusalRate: number;
  autoAcceptRate: number;
  /** THE safety metric: of readings the system accepted without a human, share that were wrong. */
  autoAcceptErrorRate: number;
  robotFaultDetection: number;
  robotFalseAlarmRate: number;
  defectRecall: number;
  defectPrecision: number;
  byCondition: Record<string, { cases: number; accuracy: number | null }>;
  tokens: { input: number; output: number };
  latencyMs: { p50: number; p95: number };
}

const ratio = (a: number, b: number) => (b === 0 ? 1 : Math.round((a / b) * 1000) / 1000);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

export function score(cases: EvalCase[], tolerancePctSpan = 0.03): Report {
  const correct = (c: EvalCase) => c.predicted.readable && c.predicted.value !== null
    && Math.abs(c.predicted.value - c.truth.value) <= tolerancePctSpan * c.span;
  const readable = cases.filter((c) => c.truth.readable);
  const unreadable = cases.filter((c) => !c.truth.readable);
  const readAttempts = readable.filter((c) => c.predicted.readable && c.predicted.value !== null);
  const auto = cases.filter((c) => c.finding.status === 'auto_accepted');
  const faulty = cases.filter((c) => c.truth.robotFault !== 'ok');
  const cleanRobot = cases.filter((c) => c.truth.robotFault === 'ok' && c.truth.readable);
  const robotFlag = (c: EvalCase) => c.finding.reasons.some((r) => r.startsWith('robot_'));

  let tp = 0, fp = 0, fn = 0;
  for (const c of cases) {
    const t = new Set(c.truth.defects), p = new Set(c.predicted.defects);
    for (const d of p) (t.has(d) ? tp++ : fp++);
    for (const d of t) if (!p.has(d)) fn++;
  }

  const byCondition: Report['byCondition'] = {};
  for (const cond of [...new Set(cases.map((c) => c.condition))].sort()) {
    const cs = cases.filter((c) => c.condition === cond && c.truth.readable);
    byCondition[cond] = { cases: cases.filter((c) => c.condition === cond).length, accuracy: cs.length ? ratio(cs.filter(correct).length, cs.length) : null };
  }

  return {
    cases: cases.length,
    readableCases: readable.length,
    accuracyWithinTolerance: ratio(readable.filter(correct).length, readable.length),
    meanAbsErrorPctSpan: readAttempts.length
      ? Math.round((readAttempts.reduce((s, c) => s + Math.abs(c.predicted.value! - c.truth.value) / c.span, 0) / readAttempts.length) * 10000) / 100
      : 0,
    unreadableRecall: ratio(unreadable.filter((c) => !c.predicted.readable).length, unreadable.length),
    falseRefusalRate: ratio(readable.filter((c) => !c.predicted.readable).length, readable.length),
    autoAcceptRate: ratio(auto.length, cases.length),
    autoAcceptErrorRate: auto.length ? ratio(auto.filter((c) => !c.truth.readable || !correct(c)).length, auto.length) : 0,
    robotFaultDetection: ratio(faulty.filter(robotFlag).length, faulty.length),
    robotFalseAlarmRate: cleanRobot.length ? ratio(cleanRobot.filter(robotFlag).length, cleanRobot.length) : 0,
    defectRecall: ratio(tp, tp + fn),
    defectPrecision: ratio(tp, tp + fp),
    byCondition,
    tokens: { input: cases.reduce((s, c) => s + c.inputTokens, 0), output: cases.reduce((s, c) => s + c.outputTokens, 0) },
    latencyMs: { p50: pct(cases.map((c) => c.latencyMs), 50), p95: pct(cases.map((c) => c.latencyMs), 95) },
  };
}
