import type { Defect, Unit } from '@ic/core';
import type { VisionInput, VisionModel, VisionResult } from './model';

export interface GroundTruth {
  inspectionId: string;
  trueValue: number;
  unit: Unit;
  readable: boolean;
  imageCondition: 'clean' | 'noisy' | 'occluded' | 'unreadable';
  defects: Defect[];
}

/** Deterministic PRNG so demos and tests are repeatable. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stand-in "model" driven by the synthetic dataset's labels. It behaves like a
 * decent but imperfect vision model: noisier on degraded images, occasionally wrong.
 * Lets the whole system run offline, in CI and in a demo with no API key.
 */
export class FakeVisionModel implements VisionModel {
  readonly name = 'fake:synthetic-labels';
  // One random stream per inspection, so results don't depend on the order concurrent calls arrive in.
  private streams = new Map<string, () => number>();
  constructor(private truth: Map<string, GroundTruth & { scaleMin: number; scaleMax: number }>, private seed = 42) {}

  private streamFor(id: string) {
    let r = this.streams.get(id);
    if (!r) {
      let h = this.seed;
      for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
      r = mulberry32(h);
      this.streams.set(id, r);
    }
    return r;
  }

  async readGauge(input: VisionInput): Promise<VisionResult> {
    const t = input.inspectionId ? this.truth.get(input.inspectionId) : undefined;
    if (!t) throw new Error(`fake model has no label for ${input.inspectionId}`);
    const rand = this.streamFor(t.inspectionId);
    const span = t.scaleMax - t.scaleMin;
    const noiseBy = { clean: 0.008, noisy: 0.025, occluded: 0.08, unreadable: 0.3 }[t.imageCondition];
    const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
    const readable = t.imageCondition === 'unreadable' ? rand() < 0.15 : true;
    const value = readable ? Math.round((t.trueValue + gauss() * noiseBy * span) * 100) / 100 : null;
    return {
      reading: {
        readable, value, unit: readable ? t.unit : null, scaleMin: t.scaleMin, scaleMax: t.scaleMax,
        defects: t.defects.filter(() => rand() < 0.85),
        imageQuality: t.imageCondition === 'clean' ? 'good' : t.imageCondition === 'noisy' ? 'fair' : 'poor',
        notes: 'synthetic reading',
      },
      usage: { inputTokens: 1600, outputTokens: 90 },
      model: this.name,
      latencyMs: 5,
    };
  }
}
