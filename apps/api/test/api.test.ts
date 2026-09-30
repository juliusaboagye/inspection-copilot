import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../src/app';
import type { Db } from '../src/lib/db';
import { MemoryImageStore } from '../src/lib/images';
import { freshDb, payload, seedAsset } from './helpers';

let db: Db;
let app: Express;

beforeEach(async () => {
  if (db) await db.end();
  db = await freshDb();
  await seedAsset(db);
  app = buildApp({ db, images: new MemoryImageStore(), auth: { mode: 'none' } });
});
afterAll(async () => { await db?.end(); });

describe('POST /inspections', () => {
  it('queues a new capture (202) and stores the robot metadata', async () => {
    const res = await request(app).post('/inspections').send(payload());
    expect(res.status).toBe(202);
    const row = (await db.query('SELECT status, robot_value FROM inspection WHERE id = $1', ['insp-1'])).rows[0];
    expect(row).toEqual({ status: 'queued', robot_value: 8 });
  });

  it('is idempotent: re-sending the same inspection returns 200 and does not duplicate', async () => {
    await request(app).post('/inspections').send(payload());
    const res = await request(app).post('/inspections').send(payload());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ queued: false });
    expect((await db.query('SELECT count(*)::int AS n FROM inspection')).rows[0].n).toBe(1);
  });

  it('rejects malformed payloads with 400', async () => {
    const res = await request(app).post('/inspections').send(payload({ capturedAt: 'yesterday' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app).post('/inspections').set('content-type', 'application/json').send('{"broken"');
    expect(res.status).toBe(400);
  });

  it('rejects unknown assets with 422', async () => {
    const res = await request(app).post('/inspections').send(payload({ assetId: 'NOPE' }));
    expect(res.status).toBe(422);
  });
});

describe('findings and review', () => {
  async function insertFinding(status = 'needs_review', severity = 'medium') {
    await request(app).post('/inspections').send(payload());
    const r = await db.query(
      `INSERT INTO finding (inspection_id, asset_id, status, value, unit, confidence, severity, reasons)
       VALUES ('insp-1','PG-101',$1,8.1,'bar',0.6,$2,'{low_confidence}') RETURNING id`, [status, severity]);
    return r.rows[0].id as number;
  }

  it('lists findings filtered by status', async () => {
    await insertFinding();
    const res = await request(app).get('/findings?status=needs_review');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ assetName: 'Feed pump P-101 discharge pressure', robotValue: 8, reasons: ['low_confidence'] });
  });

  it('rejects an invalid filter with 400', async () => {
    expect((await request(app).get('/findings?status=bogus')).status).toBe(400);
  });

  it('records a correction as reviewed, with who and what', async () => {
    const id = await insertFinding();
    const res = await request(app).post(`/findings/${id}/review`).send({ decision: 'correct', value: 7.6, note: 'needle behind glare' });
    expect(res.status).toBe(200);
    const f = (await request(app).get(`/findings/${id}`)).body;
    expect(f).toMatchObject({ status: 'reviewed', reviewDecision: 'correct', reviewedValue: 7.6, reviewedBy: 'local-dev' });
  });

  it('requires a value when correcting', async () => {
    const id = await insertFinding();
    const res = await request(app).post(`/findings/${id}/review`).send({ decision: 'correct' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown finding', async () => {
    expect((await request(app).get('/findings/999')).status).toBe(404);
  });

  it('summarises findings and reason codes', async () => {
    await insertFinding();
    const s = (await request(app).get('/metrics/summary')).body;
    expect(s.findingsByStatus).toEqual({ needs_review: 1 });
    expect(s.reasons).toEqual({ low_confidence: 1 });
  });
});
