import { createPool, type Db } from '../src/lib/db';
import { migrate } from '../src/lib/migrations';
import type { AssetSpec } from '@ic/core';
import { upsertAssets } from '../src/lib/repo';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://ic:ic@localhost:5432/ic_test';

export async function freshDb(): Promise<Db> {
  const db = createPool(TEST_DB);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}

export const pump: AssetSpec = {
  id: 'PG-101', name: 'Feed pump P-101 discharge pressure', unit: 'bar',
  scaleMin: 0, scaleMax: 16, normalMin: 6, normalMax: 10,
};

export async function seedAsset(db: Db, a: AssetSpec = pump) { await upsertAssets(db, [a]); }

export const payload = (over: Record<string, unknown> = {}) => ({
  inspectionId: 'insp-1', assetId: 'PG-101', robotId: 'robot-1', capturedAt: '2026-09-01T06:00:00Z',
  robotReading: { value: 8, unit: 'bar', confidence: 0.9 },
  image: { mediaType: 'image/jpeg', base64: Buffer.from('not-really-a-jpeg').toString('base64') },
  ...over,
});
