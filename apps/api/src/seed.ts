/**
 * Load the synthetic dataset: register assets, then push every capture through the
 * real ingest API over HTTP, exactly as a robot vendor would.
 */
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { buildApp } from './app';
import { config } from './config';
import { createPool } from './lib/db';
import { imageStoreFromEnv } from './lib/images';
import { upsertAssets } from './lib/repo';

const dir = path.resolve(process.cwd(), '../../data/synthetic');
const db = createPool(config.databaseUrl());
await upsertAssets(db, JSON.parse(await readFile(path.join(dir, 'assets.json'), 'utf8')));

const server = buildApp({ db, images: imageStoreFromEnv(), auth: { mode: 'none' } }).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const inspections = JSON.parse(await readFile(path.join(dir, 'inspections.json'), 'utf8'));
let queued = 0;
for (const i of inspections) {
  const image = await readFile(path.join(dir, i.image));
  const { image: _, ...payload } = i;
  const res = await fetch(`${base}/inspections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, image: { mediaType: 'image/jpeg', base64: image.toString('base64') } }),
  });
  if (res.status === 202) queued++;
  else if (res.status !== 200) console.error(i.inspectionId, res.status, await res.text());
}
console.log(`seeded ${inspections.length} inspections (${queued} newly queued)`);
server.close();
await db.end();
