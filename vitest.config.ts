import { defineConfig } from 'vitest/config'
import { readFileSync } from 'fs'
import path from 'path'

function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8')
    const env: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key) env[key] = val
    }
    // En tests, redirigir DATABASE_URL a la DB de test para que getDb()
    // (singleton lazy) conecte a la DB de test sin necesidad de vi.mock.
    if (env.DATABASE_URL_TEST) {
      env.DATABASE_URL = env.DATABASE_URL_TEST
    }
    return env
  } catch {
    return {}
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
    env: loadEnvLocal(),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
