import { config, visionModelFromEnv } from './config';
import { createPool } from './lib/db';
import { imageStoreFromEnv } from './lib/images';
import { drain } from './lib/processor';

const db = createPool(config.databaseUrl());
const model = visionModelFromEnv();
const deps = { db, images: imageStoreFromEnv(), model, samples: config.samples(), log: (m: string, e?: object) => console.log(JSON.stringify({ msg: m, ...e })) };
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; });

console.log(`worker started with model ${model.name}, ${config.samples()} samples per image`);
while (!stopping) {
  const n = await drain(deps);
  if (n === 0) await new Promise((r) => setTimeout(r, 2000));
}
await db.end();
