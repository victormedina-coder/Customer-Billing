/**
 * Cliente Drizzle — adapter de infraestructura.
 * Contenido movido de lib/db/client.ts sin cambiar comportamiento.
 * El puente en lib/db/client.ts re-exporta desde aquí.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgresJs from 'postgres'
import * as schema from './schema'

type Schema = typeof schema

let _db: PostgresJsDatabase<Schema> | null = null

/**
 * Returns the shared Drizzle client, creating it on first call.
 * DATABASE_URL is read lazily so importing this module at the top level
 * does not throw during build/test when the env var is absent.
 */
export function getDb(): PostgresJsDatabase<Schema> {
  if (!_db) {
    const client = postgresJs(process.env.DATABASE_URL!, { max: 1 })
    _db = drizzle(client, { schema })
  }
  return _db
}
