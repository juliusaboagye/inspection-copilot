import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db';
import { tx } from './db';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Minimal forward-only migration runner: applies each .sql file once, in order, in a transaction. */
export async function migrate(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query('SELECT name FROM schema_migration')).rows.map((r) => r.name));
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = await readFile(path.join(DIR, f), 'utf8');
    await tx(db, async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migration (name) VALUES ($1)', [f]);
    });
    log(`applied ${f}`);
    ran.push(f);
  }
  return ran;
}
