import { consensus, type ConsensusReading, type VisionReading } from '@ic/core';
import type { Usage, VisionInput, VisionModel } from './model';

export interface ConsensusResult {
  consensus: ConsensusReading;
  samples: VisionReading[];
  failures: string[];
  usage: Usage;
  model: string;
  latencyMs: number;
}

/**
 * Ask the model `n` times (in parallel) and merge the answers.
 * Individual failures are tolerated; if every sample fails we throw.
 */
export async function readWithConsensus(model: VisionModel, input: VisionInput, n: number, span: number): Promise<ConsensusResult> {
  const started = Date.now();
  const settled = await Promise.allSettled(Array.from({ length: n }, () => model.readGauge(input)));
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const failures = settled.flatMap((s) => (s.status === 'rejected' ? [String((s.reason as Error)?.message ?? s.reason)] : []));
  if (ok.length === 0) throw new Error(`all ${n} vision samples failed: ${failures[0]}`);
  const samples = ok.map((r) => r.reading);
  return {
    consensus: consensus(samples, span),
    samples,
    failures,
    usage: ok.reduce((u, r) => ({ inputTokens: u.inputTokens + r.usage.inputTokens, outputTokens: u.outputTokens + r.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 }),
    model: ok[0]!.model,
    latencyMs: Date.now() - started,
  };
}
