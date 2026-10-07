import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx next dev --webpack -H 127.0.0.1 -p 4173',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'development',
      DEV_NOW_OVERRIDE: '2026-10-06T12:00:00-06:00',
      NEXT_PUBLIC_LOOKUP_MOCK: 'false',
      EMIT_MOCK: 'true',
      GLOBAL_INVOICE_SECRET: '',
      DATABASE_URL: '',
      REDIS_URL: '',
      FACTURAMA_USER: '',
      FACTURAMA_PASS: '',
      ARIAT_SHOPIFY_STORE: '',
      ARIAT_SHOPIFY_ACCESS_TOKEN: '',
      STETSON_SHOPIFY_STORE: '',
      STETSON_SHOPIFY_CLIENT_ID: '',
      STETSON_SHOPIFY_CLIENT_SECRET: '',
      WB_SHOPIFY_STORE: '',
      WB_SHOPIFY_CLIENT_ID: '',
      WB_SHOPIFY_CLIENT_SECRET: '',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
    },
  },
})
