import type { VisionReading } from '@ic/core';

export interface GaugeContext {
  assetName: string;
  expectedUnit: string;
  scaleMin: number;
  scaleMax: number;
}

export interface VisionInput {
  image: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Optional context from the asset register. Helps accuracy; see docs on anchoring bias. */
  context?: GaugeContext;
  /** Used only by the fake model to look up ground truth. */
  inspectionId?: string;
}

export interface Usage { inputTokens: number; outputTokens: number }

export interface VisionResult {
  reading: VisionReading;
  usage: Usage;
  model: string;
  latencyMs: number;
}

/** Any vision-capable LLM. Swap providers without touching business logic ("no lock-in"). */
export interface VisionModel {
  readonly name: string;
  readGauge(input: VisionInput): Promise<VisionResult>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}
