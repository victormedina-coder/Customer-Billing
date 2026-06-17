import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

type Schema = typeof schema

let _db: NeonHttpDatabase<Schema> | null = null

/**
 * Returns the shared Drizzle client, creating it on first call.
 * The DATABASE_URL env var is read lazily so that importing this
 * module at the top level does not throw during build/test.
 */
export function getDb(): NeonHttpDatabase<Schema> {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!)
    _db = drizzle(sql, { schema })
  }
  return _db
}
