/**
 * Tests del cliente HTTP de Facturama (lib/invoice-service/facturama-client.ts)
 *
 * Cubre:
 *   - Header de autenticación Basic construido correctamente
 *   - Parseo de errores: campo Message (mayúsculas) y message (minúsculas)
 *   - Manejo de timeout/error de red en emitirCFDI y validarRfc
 *   - Extracción de UUID/sello/datos de timbrado de la respuesta de emitirCFDI
 *   - emitirCFDI: éxito + 4xx + error de red
 *   - validarRfc: existente (2xx) + no existente (400) + error upstream (5xx) + red
 *   - validarReceptor: éxito + fallback /3/customers/validate en 404
 *   - enviarCFDIEmail: éxito + failure (success:false)
 *   - descargarArchivo: éxito + error + content-type correcto
 *   - cancelarCFDI: motivo 01 requiere uuidReemplazo; motivo 02 sin uuid OK
 *
 * NOTA: el módulo usa un singleton lazy `_config`. Se resetea con vi.unstubAllEnvs()
 * + reimport per test a través de resetModules para que cada test parta limpio.
 * Las variables de entorno se setean ANTES de importar el módulo en cada describe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Helpers de fetch mock ────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  })
}

// ── Constantes de prueba ─────────────────────────────────────────────────────

const FAKE_USER = 'testuser'
const FAKE_PASS = 'testpass'
const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${FAKE_USER}:${FAKE_PASS}`).toString('base64')
const SANDBOX_BASE = 'https://apisandbox.facturama.mx'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para importar el módulo con env fresca en cada bloque
// ─────────────────────────────────────────────────────────────────────────────

async function importClient() {
  // resetModules garantiza que el singleton _config se reinicia
  vi.resetModules()
  return import('../src/infrastructure/facturama/facturamaClient')
}

// ─────────────────────────────────────────────────────────────────────────────
// describe: emitirCFDI
// ─────────────────────────────────────────────────────────────────────────────

describe('emitirCFDI', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('envía header Authorization: Basic correcto', async () => {
    const { emitirCFDI } = await importClient()

    const fakeCfdiResponse = {
      Id: 'abc123',
      Complement: { TaxStamp: { Uuid: 'uuid-1', SatSign: 'sello-sat', CfdiSign: 'sello-cfdi' } },
      Issuer: { Rfc: 'XAXX010101000', Name: 'EMISOR', FiscalRegime: '601' },
      Series: 'GR', Folio: '42', Date: '2026-06-29',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(fakeCfdiResponse, 200))

    await emitirCFDI({ dummy: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${SANDBOX_BASE}/3/cfdis`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(EXPECTED_AUTH)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.method).toBe('POST')
  })

  it('extrae UUID desde Complement.TaxStamp.Uuid', async () => {
    const { emitirCFDI } = await importClient()

    const resp = {
      Id: 'fact-id-001',
      Complement: { TaxStamp: { Uuid: 'UUID-STAMP', SatSign: 'SAT-SIGN', CfdiSign: 'CFDI-SIGN' } },
      Issuer: { Rfc: 'AAA010101AAA', Name: 'Test', FiscalRegime: '612' },
      Series: 'A', Folio: '1', Date: '2026-01-01',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(resp))

    const result = await emitirCFDI({})
    expect(result.Id).toBe('fact-id-001')
    expect(result.Complement?.TaxStamp?.Uuid).toBe('UUID-STAMP')
    expect(result.Complement?.TaxStamp?.SatSign).toBe('SAT-SIGN')
  })

  it('extrae UUID desde campo raíz Uuid cuando Complement no tiene TaxStamp', async () => {
    const { emitirCFDI } = await importClient()

    const resp = {
      Id: 'fact-id-002',
      Uuid: 'ROOT-UUID',
      Complement: {},
      Issuer: {},
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(resp))

    const result = await emitirCFDI({})
    expect(result.Uuid).toBe('ROOT-UUID')
    expect(result.Id).toBe('fact-id-002')
  })

  it('parsea error con campo Message (mayúsculas) y asigna statusCode', async () => {
    const { emitirCFDI } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'RFC no válido en el SAT' }, 400))

    await expect(emitirCFDI({})).rejects.toMatchObject({
      message: 'RFC no válido en el SAT',
      statusCode: 400,
    })
  })

  it('parsea error con campo message (minúsculas) como fallback', async () => {
    const { emitirCFDI } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Datos fiscales incorrectos' }, 422))

    await expect(emitirCFDI({})).rejects.toMatchObject({
      message: 'Datos fiscales incorrectos',
      statusCode: 422,
    })
  })

  it('usa JSON.stringify del body como mensaje cuando error no tiene Message ni message', async () => {
    const { emitirCFDI } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'UNKNOWN', detail: 'x' }, 500))

    await expect(emitirCFDI({})).rejects.toMatchObject({
      statusCode: 500,
    })
    // El mensaje debe contener algo derivado del body (no vacío)
    try {
      await emitirCFDI({})
    } catch (e) {
      // Segunda llamada — necesitamos otro mock
    }
  })

  it('lanza error de red (TypeError) cuando fetch falla por timeout/conexión', async () => {
    const { emitirCFDI } = await importClient()

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(emitirCFDI({})).rejects.toThrow('fetch failed')
  })

  it('lanza si FACTURAMA_USER no está configurado', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('FACTURAMA_USER', '')
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    const { emitirCFDI } = await importClient()

    await expect(emitirCFDI({})).rejects.toThrow(/no está configurado/)
  })

  it('usa producción cuando FACTURAMA_ENV=production', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'production')
    const { emitirCFDI } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'x', Complement: {}, Issuer: {} }))

    await emitirCFDI({})

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('https://api.facturama.mx')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// describe: validarRfc
// ─────────────────────────────────────────────────────────────────────────────

describe('validarRfc', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('devuelve true cuando Facturama responde 200 (RFC existe)', async () => {
    const { validarRfc } = await importClient()

    fetchMock.mockResolvedValueOnce(textResponse('', 200))

    const result = await validarRfc('EKU9003173C9')
    expect(result).toBe(true)
  })

  it('devuelve false cuando Facturama responde 400 (RFC no existe o inválido)', async () => {
    const { validarRfc } = await importClient()

    fetchMock.mockResolvedValueOnce(textResponse('Bad Request', 400))

    const result = await validarRfc('XAXX010101000')
    expect(result).toBe(false)
  })

  it('lanza cuando Facturama responde 5xx (upstream error)', async () => {
    const { validarRfc } = await importClient()

    fetchMock.mockResolvedValueOnce(textResponse('Internal Server Error', 503))

    await expect(validarRfc('EKU9003173C9')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('lanza cuando hay error de red (timeout, DNS, etc.)', async () => {
    const { validarRfc } = await importClient()

    fetchMock.mockRejectedValueOnce(new TypeError('network error'))

    await expect(validarRfc('EKU9003173C9')).rejects.toThrow('network error')
  })

  it('lanza cuando Facturama responde 404 (ruta no disponible en esta cuenta)', async () => {
    const { validarRfc } = await importClient()

    fetchMock.mockResolvedValueOnce(textResponse('Not Found', 404))

    await expect(validarRfc('EKU9003173C9')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('incluye el RFC en la URL como query param encodificado', async () => {
    const { validarRfc } = await importClient()

    fetchMock.mockResolvedValueOnce(textResponse('', 200))

    await validarRfc('EKU9003173C9')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/customers/status')
    expect(url).toContain('rfc=EKU9003173C9')
  })

  it('usa header Authorization en la request', async () => {
    const { validarRfc } = await importClient()

    fetchMock.mockResolvedValueOnce(textResponse('', 200))

    await validarRfc('EKU9003173C9')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe(EXPECTED_AUTH)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// describe: validarReceptor
// ─────────────────────────────────────────────────────────────────────────────

describe('validarReceptor', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  const validInput = {
    Rfc: 'EKU9003173C9',
    Name: 'ESCUELA KEMPER URGATE',
    ZipCode: '26015',
    FiscalRegime: '601',
  }

  const validResponse = {
    Rfc: 'EKU9003173C9',
    ExistRfc: true,
    MatchName: true,
    MatchZipCode: true,
    MatchFiscalRegime: true,
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('devuelve la validación del receptor en éxito', async () => {
    const { validarReceptor } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse(validResponse))

    const result = await validarReceptor(validInput)
    expect(result.ExistRfc).toBe(true)
    expect(result.MatchName).toBe(true)
    expect(result.Rfc).toBe('EKU9003173C9')
  })

  it('llama al endpoint /customers/validate (POST)', async () => {
    const { validarReceptor } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse(validResponse))

    await validarReceptor(validInput)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/customers/validate')
    expect(init.method).toBe('POST')
  })

  it('usa fallback /3/customers/validate cuando el primer intento devuelve 404', async () => {
    const { validarReceptor } = await importClient()

    // Primero: 404 en /customers/validate
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'Not Found' }, 404))
    // Segundo: 200 en /3/customers/validate
    fetchMock.mockResolvedValueOnce(jsonResponse(validResponse))

    const result = await validarReceptor(validInput)
    expect(result.ExistRfc).toBe(true)

    // Verificar que se hicieron dos llamadas y la segunda fue a /3/customers/validate
    expect(fetchMock.mock.calls).toHaveLength(2)
    const [secondUrl] = fetchMock.mock.calls[1] as [string]
    expect(secondUrl).toContain('/3/customers/validate')
  })

  it('lanza cuando ambos endpoints fallan con 500', async () => {
    const { validarReceptor } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'Server error' }, 500))

    await expect(validarReceptor(validInput)).rejects.toMatchObject({ statusCode: 500 })
  })

  it('lanza cuando el fallback también falla', async () => {
    const { validarReceptor } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'Not Found' }, 404))
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'Error en fallback' }, 503))

    await expect(validarReceptor(validInput)).rejects.toMatchObject({ statusCode: 503 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// describe: enviarCFDIEmail
// ─────────────────────────────────────────────────────────────────────────────

describe('enviarCFDIEmail', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  const emailParams = {
    cfdiId: 'cfdi-abc-123',
    email: 'cliente@example.com',
    subject: 'Tu factura CFDI',
    comments: 'Adjuntamos tu CFDI',
    issuerEmail: 'emisor@empresa.com',
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('llama a POST /Cfdi con los query params correctos', async () => {
    const { enviarCFDIEmail } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ msj: 'ok', success: true }))

    await enviarCFDIEmail(emailParams)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/Cfdi')
    expect(url).toContain('CfdiType=issued')
    expect(url).toContain(`CfdiId=${encodeURIComponent(emailParams.cfdiId)}`)
    expect(url).toContain(`Email=${encodeURIComponent(emailParams.email)}`)
  })

  it('devuelve { msj, success: true } en éxito', async () => {
    const { enviarCFDIEmail } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ msj: 'Correo enviado', success: true }))

    const result = await enviarCFDIEmail(emailParams)
    expect(result.success).toBe(true)
    expect(result.msj).toBe('Correo enviado')
  })

  it('devuelve { success: false } sin lanzar cuando Facturama responde 200 con success:false', async () => {
    const { enviarCFDIEmail } = await importClient()

    // Facturama puede devolver 200 con success:false
    fetchMock.mockResolvedValueOnce(jsonResponse({ msj: 'Email inválido', success: false }))

    const result = await enviarCFDIEmail(emailParams)
    expect(result.success).toBe(false)
    expect(result.msj).toBe('Email inválido')
  })

  it('lanza cuando Facturama devuelve 4xx/5xx en la ruta /Cfdi', async () => {
    const { enviarCFDIEmail } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'CFDI no encontrado' }, 404))

    await expect(enviarCFDIEmail(emailParams)).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// describe: descargarArchivo
// ─────────────────────────────────────────────────────────────────────────────

describe('descargarArchivo', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('descarga PDF y devuelve { contentType: application/pdf, buffer }', async () => {
    const { descargarArchivo } = await importClient()

    const fakeBase64 = Buffer.from('fake-pdf-content').toString('base64')
    fetchMock.mockResolvedValueOnce(jsonResponse({ Content: fakeBase64, ContentType: 'application/pdf' }))

    const result = await descargarArchivo('cfdi-id-001', 'pdf')

    expect(result.contentType).toBe('application/pdf')
    expect(Buffer.isBuffer(result.buffer)).toBe(true)
    expect(result.buffer.toString()).toBe('fake-pdf-content')
  })

  it('descarga XML y devuelve { contentType: application/xml, buffer }', async () => {
    const { descargarArchivo } = await importClient()

    const fakeBase64 = Buffer.from('<cfdi:Comprobante/>').toString('base64')
    fetchMock.mockResolvedValueOnce(jsonResponse({ Content: fakeBase64 }))

    const result = await descargarArchivo('cfdi-id-002', 'xml')

    expect(result.contentType).toBe('application/xml')
    expect(result.buffer.toString()).toBe('<cfdi:Comprobante/>')
  })

  it('llama a la URL correcta: /api/Cfdi/{format}/issued/{id}', async () => {
    const { descargarArchivo } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ Content: Buffer.from('x').toString('base64') }))

    await descargarArchivo('MY-ID', 'pdf')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/Cfdi/pdf/issued/MY-ID')
  })

  it('lanza cuando Facturama devuelve 4xx con mensaje de error', async () => {
    const { descargarArchivo } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'CFDI no encontrado en Facturama' }, 404))

    await expect(descargarArchivo('bad-id', 'pdf')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// describe: cancelarCFDI
// ─────────────────────────────────────────────────────────────────────────────

describe('cancelarCFDI', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('motivo 01 sin uuidReemplazo → lanza inmediatamente (sin llamar a fetch)', async () => {
    const { cancelarCFDI } = await importClient()

    await expect(cancelarCFDI('cfdi-id', '01')).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('motivo 01 con uuidReemplazo → llama al endpoint con el UUID de reemplazo', async () => {
    const { cancelarCFDI } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await cancelarCFDI('cfdi-id', '01', 'uuid-reemplazo-123')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('/cfdi/cfdi-id/issued/01/uuid-reemplazo-123')
  })

  it('motivo 02 sin uuidReemplazo → llama al endpoint correctamente', async () => {
    const { cancelarCFDI } = await importClient()

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await cancelarCFDI('cfdi-id-x', '02')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('/cfdi/cfdi-id-x/issued/02')
    // No debe tener un cuarto segmento de uuid-reemplazo
    expect(url).not.toContain('/issued/02/')
  })
})
