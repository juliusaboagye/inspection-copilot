import pg from 'pg';

export type Db = pg.Pool;
export const createPool = (connectionString: string) => new pg.Pool({ connectionString, max: 10 });

/** Run fn in a transaction on a single client from the pool. */
export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
