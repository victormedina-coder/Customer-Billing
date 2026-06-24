/**
 * Cliente HTTP de bajo nivel para la API de Facturama.
 *
 * Responsabilidades:
 *   - Construir la URL base a partir de FACTURAMA_ENV
 *   - Manejar autenticación Basic
 *   - Parsear respuestas y lanzar errores tipados
 *   - Exponer operaciones CFDI: emitir, obtener, descargar, cancelar
 *
 * NO importar desde app/ — este módulo es puro servidor, sin deps de Next.js.
 */

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface FacturamaCfdiResponse {
  Id: string
  Folio?: string
  Series?: string
  Date?: string
  /** Complemento de timbrado — estructura variable según versión de Facturama */
  Complement?: {
    TaxStamp?: {
      Uuid?: string
      SatSign?: string
      CfdiSign?: string
    }
  }
  /** Algunos endpoints ponen el UUID directamente en la raíz */
  Uuid?: string
  /** Datos del emisor que Facturama llena desde el CSD de la cuenta */
  Issuer?: {
    Rfc?: string
    Name?: string
    FiscalRegime?: string
  }
  [k: string]: unknown
}

// ─── Configuración (lazy singleton) ──────────────────────────────────────────

interface FacturamaConfig {
  baseUrl: string
  authHeader: string
}

let _config: FacturamaConfig | null | undefined = undefined

function getConfig(): FacturamaConfig | null {
  if (_config !== undefined) return _config

  const user = process.env.FACTURAMA_USER
  const pass = process.env.FACTURAMA_PASS
  const env  = process.env.FACTURAMA_ENV ?? 'sandbox'

  if (!user || !pass) {
    _config = null
    return null
  }

  const baseUrl =
    env === 'production'
      ? 'https://api.facturama.mx'
      : 'https://apisandbox.facturama.mx'

  const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')

  _config = { baseUrl, authHeader }
  return _config
}

export function isFacturamaConfigured(): boolean {
  return getConfig() !== null
}

// ─── Petición genérica ────────────────────────────────────────────────────────

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const cfg = getConfig()
  if (!cfg) {
    throw new Error('Facturama no está configurado: faltan FACTURAMA_USER o FACTURAMA_PASS')
  }

  const url = `${cfg.baseUrl}${path}`
  const headers: Record<string, string> = {
    Authorization: cfg.authHeader,
    Accept: 'application/json',
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })

  const ct = res.headers.get('content-type') ?? ''
  const data: unknown = ct.includes('application/json')
    ? await res.json()
    : await res.text()

  if (!res.ok) {
    const msg =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).Message ??
          (data as Record<string, unknown>).message ??
          JSON.stringify(data)
        : String(data) || `HTTP ${res.status}`

    const err = new Error(String(msg)) as Error & { statusCode: number }
    err.statusCode = res.status
    throw err
  }

  return data as T
}

// ─── Validación de receptores ─────────────────────────────────────────────────

export interface ReceptorValidation {
  Rfc: string
  ExistRfc: boolean
  MatchName: boolean
  MatchZipCode: boolean
  MatchFiscalRegime: boolean
}

/**
 * GET /customers/status?rfc=<RFC>
 * Devuelve true si el RFC existe, está activo y registrado en el SAT (2xx).
 * Devuelve false si el RFC no existe o el formato es inválido (400).
 * Relanza cualquier otro error (5xx, red) para que el caller decida degradar.
 * Si la ruta devuelve 404 (no disponible en esta cuenta) relanza también — el
 * caller en la route handler lo trata como "no se pudo verificar".
 */
export async function validarRfc(rfc: string): Promise<boolean> {
  const cfg = getConfig()
  if (!cfg) {
    throw new Error('Facturama no está configurado: faltan FACTURAMA_USER o FACTURAMA_PASS')
  }

  const url = `${cfg.baseUrl}/customers/status?rfc=${encodeURIComponent(rfc)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: cfg.authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    throw err // error de red — el caller degradará
  }

  if (res.status === 400) return false
  if (!res.ok) {
    const err = new Error(`Facturama /customers/status → HTTP ${res.status}`) as Error & { statusCode: number }
    err.statusCode = res.status
    throw err
  }
  return true
}

/**
 * POST /customers/validate
 * Si ese endpoint devuelve 404 (no existe en esta cuenta) intenta el fallback
 * POST /3/customers/validate antes de relanzar.
 */
export async function validarReceptor(input: {
  Rfc: string
  Name: string
  ZipCode: string
  FiscalRegime: string
}): Promise<ReceptorValidation> {
  try {
    return await request<ReceptorValidation>('POST', '/customers/validate', input)
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    if (e.statusCode === 404) {
      // Fallback: algunos planes de Facturama exponen la ruta bajo /3/
      return await request<ReceptorValidation>('POST', '/3/customers/validate', input)
    }
    throw err
  }
}

// ─── Operaciones CFDI ─────────────────────────────────────────────────────────

/** POST /3/cfdis — emite un CFDI 4.0 */
export async function emitirCFDI(payload: unknown): Promise<FacturamaCfdiResponse> {
  return request<FacturamaCfdiResponse>('POST', '/3/cfdis', payload)
}

/** GET /cfdi/{id}/issued — obtiene el detalle de un CFDI emitido */
export async function obtenerCFDI(id: string): Promise<FacturamaCfdiResponse> {
  return request<FacturamaCfdiResponse>('GET', `/cfdi/${encodeURIComponent(id)}/issued`)
}

/**
 * GET /api/Cfdi/{format}/issued/{id}
 * Facturama devuelve { Content: "<base64>", ContentType: "...", FileName: "..." }
 */
export async function descargarArchivo(
  id: string,
  format: 'pdf' | 'xml'
): Promise<{ contentType: string; buffer: Buffer }> {
  const data = await request<{ Content: string; ContentType?: string }>(
    'GET',
    `/api/Cfdi/${format}/issued/${encodeURIComponent(id)}`
  )
  const buffer = Buffer.from(data.Content, 'base64')
  const contentType = format === 'pdf' ? 'application/pdf' : 'application/xml'
  return { contentType, buffer }
}

// ─── Correo CFDI ─────────────────────────────────────────────────────────────

export interface SendEmailResult { msj: string; success: boolean }

/**
 * POST /Cfdi?CfdiType=issued&CfdiId=...&Email=...&Subject=...&Comments=...
 *       &IssuerEmail=...&IncludePayBtn=false
 *
 * Todos los parámetros van en query string; el cuerpo es vacío.
 * Devuelve { msj: string, success: boolean }.
 */
export async function enviarCFDIEmail(params: {
  cfdiId: string
  email: string
  subject: string
  comments: string
  issuerEmail: string
}): Promise<SendEmailResult> {
  const qs = [
    `CfdiType=issued`,
    `CfdiId=${encodeURIComponent(params.cfdiId)}`,
    `Email=${encodeURIComponent(params.email)}`,
    `Subject=${encodeURIComponent(params.subject)}`,
    `Comments=${encodeURIComponent(params.comments)}`,
    `IssuerEmail=${encodeURIComponent(params.issuerEmail)}`,
    `IncludePayBtn=false`,
  ].join('&')

  return request<SendEmailResult>('POST', `/Cfdi?${qs}`, undefined)
}

/**
 * DELETE /cfdi/{id}/issued/{motivo}[/{uuidReemplazo}]
 * motivo '01' requiere uuidReemplazo obligatorio (sustitución).
 */
export async function cancelarCFDI(
  id: string,
  motivo: string,
  uuidReemplazo?: string
): Promise<unknown> {
  if (motivo === '01' && !uuidReemplazo) {
    const err = new Error(
      'uuidReemplazo es obligatorio cuando el motivo de cancelación es "01".'
    ) as Error & { statusCode: number }
    err.statusCode = 400
    throw err
  }
  const base = `/cfdi/${encodeURIComponent(id)}/issued/${motivo}`
  const path = uuidReemplazo ? `${base}/${encodeURIComponent(uuidReemplazo)}` : base
  return request('DELETE', path)
}
