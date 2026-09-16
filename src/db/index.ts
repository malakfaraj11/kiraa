import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const connStr = process.env.DATABASE_URL || '';
    const isLocal = connStr.includes('localhost') || connStr.includes('127.0.0.1') || connStr.includes('kiraa_postgres');
    const pool = new Pool({
      connectionString: connStr,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
    _db = drizzle(pool, { schema });
  }
  return _db;
}

// Keep default export for compatibility with Next.js API routes (env is already set there)
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const targetDb = getDb();
    return (targetDb as unknown as Record<string | symbol, unknown>)[prop];
  },
});
