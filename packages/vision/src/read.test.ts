import { describe, it, expect } from 'vitest';
import { readWithConsensus } from './read';
import { FakeVisionModel } from './fake';
import type { VisionModel, VisionResult } from './model';

const result = (value: number): VisionResult => ({
  reading: { readable: true, value, unit: 'bar', scaleMin: 0, scaleMax: 16, defects: [], imageQuality: 'good', notes: '' },
  usage: { inputTokens: 100, outputTokens: 10 }, model: 'm', latencyMs: 1,
});
const scripted = (outcomes: Array<number | Error>): VisionModel => {
  let i = 0;
  return { name: 'scripted', readGauge: async () => { const o = outcomes[i++]!; if (o instanceof Error) throw o; return result(o); } };
};
const input = { image: Buffer.from(''), mediaType: 'image/png' as const };

describe('readWithConsensus', () => {
  it('merges n samples and sums token usage', async () => {
    const r = await readWithConsensus(scripted([8, 8.1, 7.9]), input, 3, 16);
    expect(r.consensus.value).toBe(8);
    expect(r.usage).toEqual({ inputTokens: 300, outputTokens: 30 });
  });

  it('tolerates a failed sample', async () => {
    const r = await readWithConsensus(scripted([8, new Error('timeout'), 8.2]), input, 3, 16);
    expect(r.samples).toHaveLength(2);
    expect(r.failures).toEqual(['timeout']);
  });

  it('throws when every sample fails', async () => {
    await expect(readWithConsensus(scripted([new Error('down'), new Error('down')]), input, 2, 16)).rejects.toThrow(/all 2 vision samples failed/);
  });
});

describe('FakeVisionModel', () => {
  const truth = new Map([['i1', { inspectionId: 'i1', trueValue: 8, unit: 'bar' as const, readable: true, imageCondition: 'clean' as const, defects: [], scaleMin: 0, scaleMax: 16 }]]);
  it('is deterministic for a given seed', async () => {
    const a = await new FakeVisionModel(truth, 1).readGauge({ ...input, inspectionId: 'i1' });
    const b = await new FakeVisionModel(truth, 1).readGauge({ ...input, inspectionId: 'i1' });
    expect(a.reading.value).toBe(b.reading.value);
    expect(Math.abs(a.reading.value! - 8)).toBeLessThan(0.5);
  });
});
