import { buildApp } from './app';
import { config } from './config';
import { createPool } from './lib/db';
import { imageStoreFromEnv } from './lib/images';

const db = createPool(config.databaseUrl());
const app = buildApp({ db, images: imageStoreFromEnv(), auth: config.auth(), logger: true });
const server = app.listen(config.port(), () => console.log(`API listening on :${config.port()}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(async () => { await db.end(); process.exit(0); }));
}
