import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VisionModel } from '@ic/vision';
import type { Db } from '../src/lib/db';
import { MemoryImageStore } from '../src/lib/images';
import { drain } from '../src/lib/processor';
import { claimNext, insertInspection } from '../src/lib/repo';
import { freshDb, seedAsset } from './helpers';

const reads = (value: number | null, readable = true): VisionModel => ({
  name: 'stub',
  readGauge: async () => ({
    reading: { readable, value, unit: readable ? 'bar' : null, scaleMin: 0, scaleMax: 16, defects: [], imageQuality: 'good', notes: '' },
    usage: { inputTokens: 1000, outputTokens: 50 }, model: 'stub', latencyMs: 3,
  }),
});

let db: Db;
const images = new MemoryImageStore();
async function enqueue(id: string, robotValue: number | null) {
  const p = await images.put(id, Buffer.from('img'));
  await insertInspection(db, { inspectionId: id, assetId: 'PG-101', robotId: 'r', capturedAt: '2026-09-01T06:00:00Z',
    robotReading: { value: robotValue, unit: robotValue === null ? null : 'bar', confidence: 0.9 } }, p, 'image/jpeg');
}
beforeAll(async () => { db = await freshDb(); await seedAsset(db); });
afterAll(async () => { await db.end(); });

describe('processing pipeline', () => {
  it('turns a queued inspection into an auto-accepted finding with the raw samples stored', async () => {
    await enqueue('a', 8.05);
    expect(await drain({ db, images, model: reads(8), samples: 3 })).toBe(1);
    const f = (await db.query(`SELECT status, value, severity FROM finding WHERE inspection_id='a'`)).rows[0];
    expect(f).toEqual({ status: 'auto_accepted', value: 8, severity: 'none' });
    const r = (await db.query(`SELECT jsonb_array_length(samples) AS n, input_tokens FROM reading WHERE inspection_id='a'`)).rows[0];
    expect(r).toEqual({ n: 3, input_tokens: 3000 });
  });

  it('routes an unreadable image to review', async () => {
    await enqueue('b', 8);
    await drain({ db, images, model: reads(null, false), samples: 1 });
    const f = (await db.query(`SELECT status, reasons FROM finding WHERE inspection_id='b'`)).rows[0];
    expect(f).toEqual({ status: 'needs_review', reasons: ['image_unreadable'] });
  });

  it('re-queues on model failure and gives up after max attempts', async () => {
    await enqueue('c', 8);
    const broken: VisionModel = { name: 'broken', readGauge: async () => { throw new Error('HTTP 503'); } };
    for (let i = 0; i < 3; i++) await drain({ db, images, model: broken, samples: 1, maxAttempts: 3 }, 1);
    const row = (await db.query(`SELECT status, attempts, last_error FROM inspection WHERE id='c'`)).rows[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 3 });
    expect(row.last_error).toMatch(/503/);
  });

  it('never hands the same job to two workers (SKIP LOCKED)', async () => {
    for (const id of ['d1', 'd2', 'd3', 'd4']) await enqueue(id, 8);
    const claimed = await Promise.all([claimNext(db), claimNext(db), claimNext(db), claimNext(db), claimNext(db)]);
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['d1', 'd2', 'd3', 'd4']);
  });
});
