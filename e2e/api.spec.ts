import { expect, test } from '@playwright/test'

const fiscal = {
  rfc: 'EKU9003173C9',
  razon: 'ESCUELA KEMPER URGATE',
  regimen: '601',
  cp: '26015',
  uso: 'G03',
  email: 'e2e@example.com',
}

test('lookup rechaza entrada inválida sin consultar Shopify', async ({ request }) => {
  const response = await request.post('/api/invoice/lookup', {
    data: { folio: '', amount: 0 },
  })
  expect(response.status()).toBe(422)
  expect((await response.json()).error.code).toBe('VALIDATION_FAILED')
})

test('emit exige consentimiento antes de emitir', async ({ request }) => {
  const response = await request.post('/api/invoice/emit', {
    data: {
      folio: '15-5333',
      amount: 116,
      fiscal,
      consent: { acceptedPrivacy: false, acceptedTerms: true },
    },
  })
  expect(response.status()).toBe(400)
  expect((await response.json()).error.code).toBe('FISCAL_INVALID')
})

test('emit mock devuelve factura sin llamar a Shopify ni Facturama', async ({ request }) => {
  const response = await request.post('/api/invoice/emit', {
    data: {
      folio: '15-5333',
      amount: 116,
      fiscal,
      consent: { acceptedPrivacy: true, acceptedTerms: true },
    },
  })
  expect(response.status()).toBe(200)
  const { factura } = await response.json()
  expect(factura.invoiceId).toMatch(/^[0-9a-f-]{36}$/i)
  expect(factura.emisor.nombre).toContain('MOCK')
})

test('validate fiscal rechaza RFC inválido sin consultar SAT', async ({ request }) => {
  const response = await request.post('/api/fiscal/validate', {
    data: { rfc: 'INVALID', name: 'Prueba', zipCode: '26015', fiscalRegime: '601' },
  })
  expect(response.status()).toBe(400)
  expect((await response.json()).error.code).toBe('INVALID_RFC')
})

test('resend rechaza identificador inválido sin consultar BD', async ({ request }) => {
  const response = await request.post('/api/invoice/resend', {
    data: { invoiceId: 'invalid' },
  })
  expect(response.status()).toBe(400)
  expect((await response.json()).error.code).toBe('INVALID_BODY')
})

test('download valida identificador y formato antes de consultar BD', async ({ request }) => {
  const invalidId = await request.get('/api/invoice/download/invalid/pdf')
  expect(invalidId.status()).toBe(400)
  expect((await invalidId.json()).error.code).toBe('INVALID_ID')

  const invalidFormat = await request.get('/api/invoice/download/00000000-0000-4000-8000-000000000001/txt')
  expect(invalidFormat.status()).toBe(400)
  expect((await invalidFormat.json()).error.code).toBe('FORMAT_INVALID')
})

test('cron global queda deshabilitado sin secreto en E2E', async ({ request }) => {
  const response = await request.post('/api/global/emit', {
    data: { year: 2026, month: 10, dryRun: true },
  })
  expect(response.status()).toBe(503)
  expect((await response.json()).error.code).toBe('FEATURE_NOT_CONFIGURED')
})
