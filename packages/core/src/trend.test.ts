import { describe, it, expect } from 'vitest';
import { trend } from './trend';

const day = (d: number) => new Date(Date.UTC(2026, 8, 1 + d)).toISOString();

describe('trend', () => {
  it('needs at least three points', () => {
    expect(trend([{ at: day(0), value: 8 }, { at: day(1), value: 7 }], { min: 6, max: 10 })).toBeNull();
  });

  it('reports a flat series as stable with no projected breach', () => {
    const t = trend([0, 1, 2, 3].map((d) => ({ at: day(d), value: 8 })), { min: 6, max: 10 })!;
    expect(t.slopePerDay).toBeCloseTo(0, 6);
    expect(t.direction).toBe('stable');
    expect(t.daysToBreach).toBeNull();
  });

  it('projects when a falling value will leave the normal band', () => {
    // 9, 8, 7 => -1/day; last value 7, lower limit 6 => ~1 day
    const t = trend([{ at: day(0), value: 9 }, { at: day(1), value: 8 }, { at: day(2), value: 7 }], { min: 6, max: 10 })!;
    expect(t.slopePerDay).toBeCloseTo(-1, 6);
    expect(t.direction).toBe('falling');
    expect(t.daysToBreach).toBeCloseTo(1, 6);
    expect(t.limit).toBe('min');
  });

  it('reports 0 days to breach when already outside the band', () => {
    const t = trend([{ at: day(0), value: 9 }, { at: day(1), value: 10.5 }, { at: day(2), value: 11 }], { min: 6, max: 10 })!;
    expect(t.daysToBreach).toBe(0);
    expect(t.limit).toBe('max');
  });

  it('ignores missing values', () => {
    const t = trend([{ at: day(0), value: 9 }, { at: day(1), value: null }, { at: day(2), value: 8 }, { at: day(3), value: 7.5 }], { min: 6, max: 10 });
    expect(t).not.toBeNull();
    expect(t!.points).toBe(3);
  });
});
