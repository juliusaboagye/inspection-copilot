import { config } from './config';
import { createPool } from './lib/db';
import { migrate } from './lib/migrations';

const db = createPool(config.databaseUrl());
const ran = await migrate(db, console.log);
console.log(ran.length ? `done (${ran.length} applied)` : 'up to date');
await db.end();
