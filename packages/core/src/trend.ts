export interface TrendPoint { at: string | Date; value: number | null }
export interface Trend {
  points: number;
  slopePerDay: number;
  direction: 'rising' | 'falling' | 'stable';
  latest: number;
  /** Days until the fitted line leaves the normal band (0 = already outside, null = not heading out). */
  daysToBreach: number | null;
  limit: 'min' | 'max' | null;
}

/** Least-squares line through the readings: turns individual AI readings into an early warning. */
export function trend(series: TrendPoint[], band: { min: number; max: number }, stableTolerancePerDay = 0.01): Trend | null {
  const pts = series
    .filter((p): p is { at: string | Date; value: number } => p.value !== null)
    .map((p) => ({ x: new Date(p.at).getTime() / 86_400_000, y: p.value }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 3) return null;

  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const slope = sxx === 0 ? 0 : pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  const latest = pts[n - 1]!.y;
  const fittedLatest = my + slope * (pts[n - 1]!.x - mx);
  const width = band.max - band.min;
  const direction = Math.abs(slope) <= stableTolerancePerDay * width ? 'stable' : slope > 0 ? 'rising' : 'falling';

  let daysToBreach: number | null = null;
  let limit: Trend['limit'] = null;
  if (latest > band.max) { daysToBreach = 0; limit = 'max'; }
  else if (latest < band.min) { daysToBreach = 0; limit = 'min'; }
  else if (direction === 'falling') { daysToBreach = Math.max(0, (fittedLatest - band.min) / -slope); limit = 'min'; }
  else if (direction === 'rising') { daysToBreach = Math.max(0, (band.max - fittedLatest) / slope); limit = 'max'; }

  return { points: n, slopePerDay: slope, direction, latest, daysToBreach, limit };
}
