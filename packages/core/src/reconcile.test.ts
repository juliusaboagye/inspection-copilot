import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import type { AssetSpec, ConsensusReading, RobotPayload } from './types';

const asset: AssetSpec = {
  id: 'PG-101', name: 'Feed pump discharge', unit: 'bar',
  scaleMin: 0, scaleMax: 16, normalMin: 6, normalMax: 10,
};
const ai = (over: Partial<ConsensusReading> = {}): ConsensusReading => ({
  readable: true, value: 8, unit: 'bar', defects: [], confidence: 0.95, samples: 3, spread: 0.1, ...over,
});
const robot = (over: Partial<RobotPayload['robotReading']> = {}): RobotPayload['robotReading'] => ({
  value: 8.05, unit: 'bar', confidence: 0.9, ...over,
});

describe('reconcile', () => {
  it('auto-accepts when robot and AI agree, AI is confident and the value is in band', () => {
    expect(reconcile(asset, robot(), ai())).toEqual({
      status: 'auto_accepted', value: 8, unit: 'bar', severity: 'none', reasons: [],
    });
  });

  it('sends unreadable images to review with no value', () => {
    const f = reconcile(asset, robot(), ai({ readable: false, value: null, unit: null, confidence: 0 }));
    expect(f).toMatchObject({ status: 'needs_review', value: null, reasons: ['image_unreadable'] });
  });

  it('sends low-confidence readings to review', () => {
    const f = reconcile(asset, robot(), ai({ confidence: 0.5 }));
    expect(f.status).toBe('needs_review');
    expect(f.reasons).toContain('low_confidence');
  });

  it('flags a real disagreement between robot and AI for review', () => {
    const f = reconcile(asset, robot({ value: 13 }), ai());
    expect(f.status).toBe('needs_review');
    expect(f.reasons).toContain('robot_ai_disagree');
  });

  it('recognises a decimal-shift fault from the robot and trusts a confident AI', () => {
    const f = reconcile(asset, robot({ value: 80 }), ai());
    expect(f.reasons).toContain('robot_decimal_shift');
    expect(f.status).toBe('auto_accepted');
  });

  it('recognises a mislabelled robot unit when the raw number matches', () => {
    const f = reconcile(asset, robot({ unit: 'psi' }), ai());
    expect(f.reasons).toContain('robot_unit_mismatch');
    expect(f.status).toBe('auto_accepted');
  });

  it('records a missing robot reading without blocking a confident AI reading', () => {
    const f = reconcile(asset, robot({ value: null, unit: null, confidence: 0 }), ai());
    expect(f).toMatchObject({ status: 'auto_accepted', reasons: ['robot_reading_missing'] });
  });

  it('converts the AI reading into the asset unit', () => {
    const f = reconcile(asset, robot({ value: 116, unit: 'psi' }), ai({ value: 116, unit: 'psi' }));
    expect(f.value).toBeCloseTo(8.0, 1);
    expect(f.unit).toBe('bar');
  });

  it('rejects AI values that are off the gauge scale', () => {
    const f = reconcile(asset, robot(), ai({ value: 40 }));
    expect(f.status).toBe('needs_review');
    expect(f.reasons).toContain('ai_value_out_of_scale');
  });

  it('rejects an AI unit that cannot apply to this asset', () => {
    const f = reconcile(asset, robot(), ai({ unit: 'degC' }));
    expect(f.reasons).toContain('ai_unit_mismatch');
    expect(f.status).toBe('needs_review');
  });

  describe('severity from the normal operating band', () => {
    it.each([
      [10.3, 'low'],     // 0.3 over a 4-bar band = 7.5%
      [11, 'medium'],    // 25%
      [13, 'high'],      // 75%
      [4, 'high'],       // 50% under
    ])('value %s is %s severity', (value, severity) => {
      const f = reconcile(asset, robot({ value }), ai({ value }));
      expect(f.severity).toBe(severity);
      expect(f.reasons).toContain('outside_normal_band');
    });

    it('asks a human to confirm high-severity alarms even when confident', () => {
      const f = reconcile(asset, robot({ value: 13 }), ai({ value: 13 }));
      expect(f.status).toBe('needs_review');
      expect(f.reasons).toContain('confirm_alarm');
    });
  });

  it('treats a visible defect as at least medium severity and reviews it', () => {
    const f = reconcile(asset, robot(), ai({ defects: ['cracked_glass'] }));
    expect(f).toMatchObject({ status: 'needs_review', severity: 'medium' });
    expect(f.reasons).toContain('defect:cracked_glass');
  });
});
