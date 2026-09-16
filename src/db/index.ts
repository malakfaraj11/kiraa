import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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
