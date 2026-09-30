import type { ConsensusReading, Defect, Unit, VisionReading } from './types';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const mode = <T>(xs: T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

const QUALITY_FACTOR = { good: 1, fair: 0.85, poor: 0.6 } as const;

/**
 * Self-consistency: ask the model N times and merge the answers.
 * Agreement between samples is our confidence signal — LLMs are poor judges
 * of their own certainty, but disagreement between samples is measurable.
 */
export function consensus(samples: VisionReading[], span: number): ConsensusReading {
  if (samples.length === 0) throw new Error('consensus needs at least one sample');

  const readableVotes = samples.filter((s) => s.readable && s.value !== null);
  const readable = readableVotes.length > samples.length / 2;

  const defectCounts = new Map<Defect, number>();
  for (const s of samples) for (const d of new Set(s.defects)) defectCounts.set(d, (defectCounts.get(d) ?? 0) + 1);
  const defects = [...defectCounts.entries()].filter(([, n]) => n > samples.length / 2).map(([d]) => d);

  const quality = Math.min(...samples.map((s) => QUALITY_FACTOR[s.imageQuality]));

  if (!readable) {
    return { readable: false, value: null, unit: null, defects, confidence: 0, samples: samples.length, spread: null };
  }

  const values = readableVotes.map((s) => s.value!) ;
  const spread = Math.max(...values) - Math.min(...values);
  const agreement = Math.max(0, 1 - spread / (span * 0.25)); // 25% of span apart => zero agreement
  const voteShare = readableVotes.length / samples.length;
  const confidence = Math.round(agreement * quality * voteShare * 1000) / 1000;

  return {
    readable: true,
    value: median(values),
    unit: (mode(readableVotes.map((s) => s.unit)) ?? null) as Unit | null,
    defects,
    confidence,
    samples: samples.length,
    spread,
  };
}
