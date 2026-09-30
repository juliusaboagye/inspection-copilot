import { describe, it, expect } from 'vitest';
import { score, type EvalCase } from './metrics';

const mk = (over: Partial<EvalCase> & { truthValue?: number; predValue?: number | null } = {}): EvalCase => ({
  inspectionId: 'x', condition: 'clean', span: 100,
  truth: { value: over.truthValue ?? 50, readable: true, defects: [], robotFault: 'ok', ...(over.truth ?? {}) },
  predicted: { readable: true, value: over.predValue === undefined ? 50 : over.predValue, defects: [], confidence: 0.9, ...(over.predicted ?? {}) },
  finding: { status: 'auto_accepted', value: 50, unit: 'bar', severity: 'none', reasons: [], ...(over.finding ?? {}) },
  inputTokens: 100, outputTokens: 10, latencyMs: 100,
});

describe('score', () => {
  it('counts a reading within 3% of span as correct', () => {
    const r = score([mk({ predValue: 52.9 }), mk({ predValue: 54 })]);
    expect(r.accuracyWithinTolerance).toBe(0.5);
    expect(r.meanAbsErrorPctSpan).toBeCloseTo(3.45, 2);
  });

  it('measures refusals on unreadable and readable images', () => {
    const r = score([
      mk({ truth: { value: 0, readable: false, defects: [], robotFault: 'ok' }, predicted: { readable: false, value: null, defects: [], confidence: 0 } }),
      mk({ predicted: { readable: false, value: null, defects: [], confidence: 0 } }),
      mk(),
    ]);
    expect(r.unreadableRecall).toBe(1);
    expect(r.falseRefusalRate).toBe(0.5);
  });

  it('auto-accept error rate counts wrong readings that skipped human review', () => {
    const r = score([mk(), mk({ predValue: 70 }), mk({ predValue: 70, finding: { status: 'needs_review', value: 70, unit: 'bar', severity: 'none', reasons: [] } })]);
    expect(r.autoAcceptRate).toBeCloseTo(0.667, 3);
    expect(r.autoAcceptErrorRate).toBe(0.5);
  });

  it('scores robot-fault detection and false alarms', () => {
    const flagged = { status: 'needs_review' as const, value: 50, unit: 'bar' as const, severity: 'none' as const, reasons: ['robot_ai_disagree'] };
    const r = score([
      mk({ truth: { value: 50, readable: true, defects: [], robotFault: 'wrong_value' }, finding: flagged }),
      mk({ truth: { value: 50, readable: true, defects: [], robotFault: 'missing' } }),
      mk({ finding: flagged }),
      mk(),
    ]);
    expect(r.robotFaultDetection).toBe(0.5);
    expect(r.robotFalseAlarmRate).toBe(0.5);
  });

  it('computes defect precision and recall', () => {
    const r = score([
      mk({ truth: { value: 50, readable: true, defects: ['cracked_glass'], robotFault: 'ok' }, predicted: { readable: true, value: 50, defects: ['cracked_glass', 'leak'], confidence: 1 } }),
      mk({ truth: { value: 50, readable: true, defects: ['cracked_glass'], robotFault: 'ok' } }),
    ]);
    expect(r.defectRecall).toBe(0.5);
    expect(r.defectPrecision).toBe(0.5);
  });
});
