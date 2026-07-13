import { defineConfig, defaultExclude } from 'vitest/config'
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

// Estos 3 archivos son integration tests gateados por DATABASE_URL_TEST:
// comparten la MISMA tabla en la MISMA DB Postgres real y cada uno hace
// TRUNCATE ... CASCADE en beforeEach. Si corren en paralelo entre sí (el
// fileParallelism default de Vitest 4), se pisan y el suite queda flaky.
// El resto de los tests usan fakes en memoria (sin DB), así que sí pueden
// correr en paralelo sin conflicto.
const INTEGRATION_TEST_FILES = [
  '__tests__/invoice-repository.test.ts',
  '__tests__/invoiced-orders-gateway.test.ts',
  '__tests__/global-invoice-repository.test.ts',
]

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: loadEnvLocal(),
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['__tests__/**/*.test.ts'],
          exclude: [...defaultExclude, ...INTEGRATION_TEST_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: INTEGRATION_TEST_FILES,
          // Serializa solo estos 3 archivos entre sí; no afecta al proyecto "unit".
          fileParallelism: false,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
