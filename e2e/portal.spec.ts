import { expect, test, type Page, type Request } from '@playwright/test'

const ticket = {
  folio: '15-5333', fecha: '06/10/2026', hora: '12:00',
  sucursal: 'Sucursal de prueba', total: 1898, status: 'ok',
  formaPago: '04 · Tarjeta de crédito',
  items: [{ desc: 'Artículo de prueba', sku: 'SKU-1', qty: 1, unit: 1898 }],
  breakdown: { subtotalSinIVA: 1636.21, descuento: 0, iva: 261.79, total: 1898 },
} as const

const factura = {
  invoiceId: 'invoice-test-1', uuid: '11111111-2222-3333-4444-555555555555',
  serieFolio: 'A/123', fecha: '2026-10-06T12:00:00-06:00', sello: 'SELLO-DE-PRUEBA',
  emisor: { rfc: 'AAA010101AAA', nombre: 'Emisor de prueba', regimen: '601' },
} as const

type MockOptions = {
  lookup?: { status: number; body: object }
  validate?: { status: number; body: object }
  emit?: { status: number; body: object }
  resend?: { status: number; body: object }
  downloadStatus?: number
}

async function mockApi(page: Page, options: MockOptions = {}) {
  const calls: Request[] = []
  const unexpected: string[] = []

  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    calls.push(request)

    const json = (status: number, body: object) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (request.method() === 'POST' && path === '/api/invoice/lookup') {
      const response = options.lookup ?? { status: 200, body: { ticket } }
      return json(response.status, response.body)
    }
    if (request.method() === 'POST' && path === '/api/fiscal/validate') {
      const response = options.validate ?? { status: 200, body: { valid: true } }
      return json(response.status, response.body)
    }
    if (request.method() === 'POST' && path === '/api/invoice/emit') {
      const response = options.emit ?? { status: 200, body: { factura } }
      return json(response.status, response.body)
    }
    if (request.method() === 'POST' && path === '/api/invoice/resend') {
      const response = options.resend ?? { status: 200, body: { success: true } }
      return json(response.status, response.body)
    }
    if (request.method() === 'GET' && path === `/api/invoice/download/${factura.invoiceId}/pdf`) {
      return route.fulfill({ status: options.downloadStatus ?? 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' })
    }
    if (request.method() === 'GET' && path === `/api/invoice/download/${factura.invoiceId}/xml`) {
      return route.fulfill({ status: options.downloadStatus ?? 200, contentType: 'application/xml', body: '<cfdi:Comprobante />' })
    }

    unexpected.push(`${request.method()} ${path}`)
    return json(501, { error: { code: 'UNMOCKED_API' } })
  })

  return { calls, unexpected }
}

async function lookupTicket(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Factura tu compra' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Folio del ticket' }).fill(ticket.folio)
  await page.getByRole('textbox', { name: 'Importe total del ticket' }).fill('1,898.00')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText(`Ticket verificado: ${ticket.folio}`, { exact: false })).toBeVisible()
}

async function fillFiscal(page: Page) {
  await page.getByRole('textbox', { name: 'RFC', exact: true }).fill('XAXX010101000')
  await page.getByRole('textbox', { name: 'Nombre o razón social' }).fill('PUBLICO EN GENERAL')
  await page.getByRole('combobox', { name: 'Régimen fiscal' }).selectOption('616')
  await page.getByRole('textbox', { name: 'Código postal' }).fill('01000')
  await page.getByRole('combobox', { name: 'Uso del CFDI' }).selectOption('S01')
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('cliente@example.com')
}

async function acceptConsent(page: Page) {
  await page.getByRole('checkbox', { name: /He leído y acepto el Aviso de Privacidad/ }).check()
  await page.getByRole('checkbox', { name: /He leído y acepto los Términos y Condiciones/ }).check()
}

async function reachConfirm(page: Page) {
  await lookupTicket(page)
  await fillFiscal(page)
  await acceptConsent(page)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Confirma tu factura' })).toBeVisible()
}

test('consulta ticket y muestra error genérico sin revelar si falló folio o monto', async ({ page }) => {
  const api = await mockApi(page, { lookup: { status: 422, body: { error: { code: 'VALIDATION_FAILED' } } } })
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Folio del ticket' }).fill('15-5333')
  await page.getByRole('textbox', { name: 'Importe total del ticket' }).fill('1898')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('No pudimos validar tu ticket')).toBeVisible()
  expect(api.calls.filter(r => new URL(r.url()).pathname === '/api/invoice/lookup')).toHaveLength(1)
  expect(api.calls[0].postDataJSON()).toEqual({ folio: '15-5333', amount: 1898 })
  await page.getByRole('button', { name: 'Intentar de nuevo' }).click()
  await expect(page.getByRole('textbox', { name: 'Folio del ticket' })).toBeEmpty()
  expect(api.unexpected).toEqual([])
})

for (const scenario of [
  { code: 'RATE_LIMITED', status: 429, title: 'Demasiados intentos' },
  { code: 'ALREADY_INVOICED', status: 409, title: 'Este pedido ya fue facturado' },
  { code: 'DEADLINE_EXCEEDED', status: 422, title: 'Periodo de facturación vencido' },
  { code: 'FULLY_REFUNDED', status: 409, title: 'Pedido reembolsado' },
]) {
  test(`consulta ticket muestra ${scenario.code} sin avanzar`, async ({ page }) => {
    const api = await mockApi(page, {
      lookup: { status: scenario.status, body: { error: { code: scenario.code } } },
    })
    await page.goto('/')
    await page.getByRole('textbox', { name: 'Folio del ticket' }).fill(ticket.folio)
    await page.getByRole('textbox', { name: 'Importe total del ticket' }).fill(String(ticket.total))
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByText(scenario.title, { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'RFC', exact: true })).toHaveCount(0)
    expect(api.unexpected).toEqual([])
  })
}

test('ticket válido avanza y el formulario exige datos fiscales y ambos consentimientos', async ({ page }) => {
  const api = await mockApi(page)
  await lookupTicket(page)
  const continueButton = page.getByRole('button', { name: 'Continuar' })
  await expect(continueButton).toBeDisabled()
  await fillFiscal(page)
  await page.getByRole('textbox', { name: 'RFC', exact: true }).fill('INVALIDO')
  await page.getByRole('textbox', { name: 'RFC', exact: true }).blur()
  await expect(page.getByText('Formato de RFC inválido')).toBeVisible()
  await page.getByRole('checkbox', { name: /He leído y acepto el Aviso de Privacidad/ }).check()
  await expect(continueButton).toBeDisabled()
  await page.getByRole('checkbox', { name: /He leído y acepto los Términos y Condiciones/ }).check()
  await continueButton.click()
  await expect(page.getByText('RFC inválido (12–13 caracteres)')).toBeVisible()
  expect(api.calls.filter(r => new URL(r.url()).pathname === '/api/fiscal/validate')).toHaveLength(0)
  await page.getByRole('textbox', { name: 'RFC', exact: true }).fill('XAXX010101000')
  await continueButton.click()
  await expect(page.getByRole('heading', { name: 'Confirma tu factura' })).toBeVisible()
  const validateCall = api.calls.find(r => new URL(r.url()).pathname === '/api/fiscal/validate')
  expect(validateCall?.postDataJSON()).toEqual({
    rfc: 'XAXX010101000', name: 'PUBLICO EN GENERAL', zipCode: '01000', fiscalRegime: '616',
  })
  expect(api.unexpected).toEqual([])
})

test('rechazo fiscal del SAT conserva formulario y muestra error genérico', async ({ page }) => {
  const api = await mockApi(page, { validate: { status: 200, body: { valid: false } } })
  await lookupTicket(page)
  await fillFiscal(page)
  await acceptConsent(page)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('No pudimos validar tus datos fiscales con el SAT')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'RFC', exact: true })).toHaveValue('XAXX010101000')
  await expect(page.getByRole('heading', { name: 'Confirma tu factura' })).toHaveCount(0)
  expect(api.unexpected).toEqual([])
})

test('confirmación envía monto, datos y consentimientos; muestra error de emisión', async ({ page }) => {
  const api = await mockApi(page, { emit: { status: 502, body: { error: { code: 'EMIT_ERROR' } } } })
  await reachConfirm(page)
  await expect(page.getByText('Artículo de prueba')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar y generar factura' }).click()
  await expect(page.getByText('Error al generar la factura. Intenta de nuevo más tarde.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Confirma tu factura' })).toBeVisible()
  const emitCall = api.calls.find(r => new URL(r.url()).pathname === '/api/invoice/emit')
  expect(emitCall?.postDataJSON()).toEqual({
    folio: ticket.folio, amount: 1898,
    fiscal: { rfc: 'XAXX010101000', razon: 'PUBLICO EN GENERAL', regimen: '616', cp: '01000', uso: 'S01', email: 'cliente@example.com' },
    consent: { acceptedPrivacy: true, acceptedTerms: true },
  })
  expect(api.unexpected).toEqual([])
})

test('emisión simulada permite descargar, reenviar y comenzar otra compra', async ({ page }) => {
  const api = await mockApi(page)
  await reachConfirm(page)
  await page.getByRole('button', { name: 'Confirmar y generar factura' }).click()
  await expect(page.getByRole('heading', { name: 'Factura generada' })).toBeVisible()

  const pdf = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar PDF' }).click()
  expect((await pdf).suggestedFilename()).toBe('Factura_A_123.pdf')
  const xml = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar XML' }).click()
  expect((await xml).suggestedFilename()).toBe('Factura_A_123.xml')

  await page.getByRole('button', { name: 'Reenviar por correo' }).click()
  await expect(page.getByText('Factura enviada a cliente@example.com')).toBeVisible()
  expect(api.calls.find(r => new URL(r.url()).pathname === '/api/invoice/resend')?.postDataJSON())
    .toEqual({ invoiceId: factura.invoiceId })

  await page.getByRole('button', { name: 'Facturar otra compra' }).click()
  await expect(page.getByRole('heading', { name: 'Factura tu compra' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Folio del ticket' })).toBeEmpty()
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('portal:state') ?? '{}').fiscal?.rfc))
    .toBe('')
  expect(api.unexpected).toEqual([])
})

test('fallos simulados de descarga y reenvío mantienen visible la factura', async ({ page }) => {
  const api = await mockApi(page, {
    downloadStatus: 503,
    resend: { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } },
  })
  await reachConfirm(page)
  await page.getByRole('button', { name: 'Confirmar y generar factura' }).click()
  await expect(page.getByRole('heading', { name: 'Factura generada' })).toBeVisible()
  await page.getByRole('button', { name: 'Descargar PDF' }).click()
  await expect(page.getByText('No se pudo descargar el archivo. Intenta de nuevo.')).toBeVisible()
  await page.getByRole('button', { name: 'Reenviar por correo' }).click()
  await expect(page.getByText('No se pudo enviar el correo. Intenta de nuevo.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Factura generada' })).toBeVisible()
  expect(api.unexpected).toEqual([])
})

test('datos y consentimientos sobreviven navegación legal y recarga en la misma pestaña', async ({ page }) => {
  const api = await mockApi(page)
  await lookupTicket(page)
  await fillFiscal(page)
  await acceptConsent(page)
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('portal:state') ?? '{}').termsAccepted))
    .toBe(true)

  const legal = page.getByRole('navigation', { name: 'Vínculos legales' })
  await legal.getByRole('link', { name: 'Aviso de Privacidad' }).click()
  await expect(page).toHaveURL(/\/aviso-privacidad$/)
  await page.getByRole('button', { name: 'Volver al portal' }).click()
  await expect(page.getByRole('textbox', { name: 'RFC', exact: true })).toHaveValue('XAXX010101000')
  await expect(page.getByRole('checkbox', { name: /He leído y acepto el Aviso de Privacidad/ })).toBeChecked()

  await legal.getByRole('link', { name: 'Términos y Condiciones' }).click()
  await expect(page).toHaveURL(/\/terminos-y-condiciones$/)
  await page.getByRole('button', { name: 'Volver al portal' }).click()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('cliente@example.com')
  await expect(page.getByRole('checkbox', { name: /He leído y acepto los Términos y Condiciones/ })).toBeChecked()
  expect(api.unexpected).toEqual([])
})
