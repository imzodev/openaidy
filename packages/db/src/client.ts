import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export function createDatabaseClient(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool);
}
