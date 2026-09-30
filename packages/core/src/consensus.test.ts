import { describe, it, expect } from 'vitest';
import { consensus } from './consensus';
import type { VisionReading } from './types';

const sample = (over: Partial<VisionReading> = {}): VisionReading => ({
  readable: true, value: 8, unit: 'bar', scaleMin: 0, scaleMax: 16,
  defects: [], imageQuality: 'good', notes: '', ...over,
});

describe('consensus', () => {
  it('throws when given no samples', () => {
    expect(() => consensus([], 16)).toThrow();
  });

  it('passes a single confident sample straight through', () => {
    const c = consensus([sample()], 16);
    expect(c).toMatchObject({ readable: true, value: 8, unit: 'bar', samples: 1, spread: 0 });
  });

  it('uses the median so one wild sample cannot drag the answer', () => {
    const c = consensus([sample({ value: 8 }), sample({ value: 8.2 }), sample({ value: 15 })], 16);
    expect(c.value).toBe(8.2);
  });

  it('lowers confidence as samples disagree (relative to the gauge span)', () => {
    const tight = consensus([sample({ value: 8 }), sample({ value: 8.1 }), sample({ value: 7.9 })], 16);
    const loose = consensus([sample({ value: 5 }), sample({ value: 8 }), sample({ value: 11 })], 16);
    expect(tight.confidence).toBeGreaterThan(0.9);
    expect(loose.confidence).toBeLessThan(0.5);
  });

  it('is unreadable when most samples say unreadable', () => {
    const c = consensus([sample({ readable: false, value: null }), sample({ readable: false, value: null }), sample()], 16);
    expect(c.readable).toBe(false);
    expect(c.value).toBeNull();
  });

  it('keeps a defect only if a majority of samples report it', () => {
    const c = consensus([
      sample({ defects: ['cracked_glass'] }),
      sample({ defects: ['cracked_glass', 'leak'] }),
      sample({ defects: [] }),
    ], 16);
    expect(c.defects).toEqual(['cracked_glass']);
  });

  it('penalises poor image quality', () => {
    const good = consensus([sample()], 16);
    const poor = consensus([sample({ imageQuality: 'poor' })], 16);
    expect(poor.confidence).toBeLessThan(good.confidence);
  });
});
