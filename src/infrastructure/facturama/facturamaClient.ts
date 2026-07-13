/**
 * Cliente HTTP de bajo nivel para la API de Facturama — adapter de infraestructura.
 *
 * NO importar desde app/ — este módulo es puro servidor, sin deps de Next.js.
 * FiscalValidationService (validarRfc/validarReceptor) — NO es de este paso;
 * se deja aquí tal cual (se extrae en un paso posterior).
 */

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface FacturamaCfdiResponse {
  Id: string
  Folio?: string
  Series?: string
  Date?: string
  Complement?: {
    TaxStamp?: {
      Uuid?: string
      SatSign?: string
      CfdiSign?: string
    }
  }
  Uuid?: string
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
  const env = (process.env.FACTURAMA_ENV ?? 'sandbox').trim().toLowerCase()

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
    let msg: string
    if (typeof data === 'object' && data !== null) {
      const d = data as Record<string, unknown>
      const base = (d.Message ?? d.message) as string | undefined
      let details = ''
      if (d.ModelState && typeof d.ModelState === 'object') {
        details = Object.entries(d.ModelState as Record<string, unknown>)
        .map(([field, m]) => `${field}: ${Array.isArray(m) ? m.join('; ') : String(m)}`)
        .join(' | ')
      }
      msg = details ? `${base ?? 'Facturama'} - ${details}` : (base ?? JSON.stringify(d))
    } else {
      msg = String(data) || `HTTP ${res.status}`
    }

    const err = new Error(msg) as Error & { statusCode: number }
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
      throw err
    }

    if (res.status === 400) return false
    if (!res.ok) {
      const err = new Error(`Facturama /customers/status → HTTP ${res.status}`) as Error & { statusCode: number }
      err.statusCode = res.status
      throw err
    }
    return true
  }

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
        return await request<ReceptorValidation>('POST', '/3/customers/validate', input)
      }
      throw err
    }
  }

  // ─── Operaciones CFDI ─────────────────────────────────────────────────────────

  export async function emitirCFDI(payload: unknown): Promise<FacturamaCfdiResponse> {
    return request<FacturamaCfdiResponse>('POST', '/3/cfdis', payload)
  }

  export async function obtenerCFDI(id: string): Promise<FacturamaCfdiResponse> {
    return request<FacturamaCfdiResponse>('GET', `/cfdi/${encodeURIComponent(id)}/issued`)
  }

  /**
   * Forma real de un elemento del listado `GET /cfdi?type=issued` (confirmada
   * contra el sandbox de Facturama, 2026-07-09 — ver
   * scripts/probe-global-exclusion.mjs). `OrderNumber` se OMITE por completo
   * (no llega como null/"") cuando el CFDI no lo tiene. `Status`/`IsActive`
   * aparecieron ambos en el sondeo — se tipan ambos como opcionales y el
   * consumidor (FacturamaInvoicedOrdersGateway) acepta cualquiera de las dos
   * señales de cancelación.
   */
  export interface FacturamaCfdiListItem {
    Id: string
    Folio?: string
    Date?: string
    OrderNumber?: string
    Status?: string
    IsActive?: boolean
    [k: string]: unknown
  }

  /**
   * Lista los CFDIs YA EMITIDOS de la cuenta (GET /cfdi?type=issued) — usado
   * por el canal Facturama de InvoicedOrdersGateway (Paso 4) para excluir
   * pedidos ya facturados por la app externa de Facturama en Shopify.
   *
   * TODO: investigar params de fecha/paginación del listado (verificar contra
   * sandbox en el Paso 7) — hoy se trae la lista completa y el filtrado por
   * periodo se hace client-side (ver FacturamaInvoicedOrdersGateway).
   */
  export async function listarCfdisEmitidos(): Promise<FacturamaCfdiListItem[]> {
    const data = await request<FacturamaCfdiListItem[] | { Items?: FacturamaCfdiListItem[] }>(
      'GET',
      '/cfdi?type=issued'
    )
    return Array.isArray(data) ? data : data.Items ?? []
  }

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

  // ─── Perfil fiscal del emisor (TaxEntity) ─────────────────────────────────────

  /**
   * Forma real de la respuesta de GET /TaxEntity (confirmada contra el sandbox
   * de Facturama el 2026-07-03). Solo se tipan los campos que consumimos.
   */
  export interface TaxEntityInfo {
    FiscalRegime: string
    Rfc: string
    TaxAddress?: { ZipCode?: string }
    IssuedIn?: { ZipCode?: string }
    [k: string]: unknown
  }

  export async function getTaxEntityInfo(): Promise<TaxEntityInfo> {
    return request<TaxEntityInfo>('GET', '/TaxEntity')
  }

  // Cache en memoria de proceso: el lugar de expedición es config de cuenta,
  // cambia rarísima vez. Un cache simple de módulo + timestamp es suficiente
  // (mismo espíritu KISS que el resto del cliente, sin sobre-diseñar).
  const EXPEDITION_PLACE_TTL_MS = 60 * 60 * 1000 // 1 hora

  let _expeditionPlaceCache: { value: string; expiresAt: number } | null = null

  /**
   * Devuelve el código postal del "Lugar de Expedición" (IssuedIn) registrado
   * en el perfil fiscal del emisor en Facturama. Este es el único valor válido
   * para ExpeditionPlace en un CFDI 4.0 — jamás el CP de un tercero (receptor).
   *
   * Cachea en memoria de proceso con TTL de 1h porque es configuración de
   * cuenta que cambia muy rara vez.
   */
  export async function getExpeditionPlace(): Promise<string> {
    const now = Date.now()
    if (_expeditionPlaceCache && _expeditionPlaceCache.expiresAt > now) {
      return _expeditionPlaceCache.value
    }

    const info = await getTaxEntityInfo()
    const zipCode = info.IssuedIn?.ZipCode?.trim()

    if (!zipCode) {
      throw new Error(
        'Facturama no devolvió un Lugar de Expedición (IssuedIn.ZipCode) registrado en el perfil fiscal del emisor.'
      )
    }

    _expeditionPlaceCache = { value: zipCode, expiresAt: now + EXPEDITION_PLACE_TTL_MS }
    return zipCode
  }

  /** Solo para tests: limpia el cache en memoria de getExpeditionPlace(). */
  export function __resetExpeditionPlaceCache(): void {
    _expeditionPlaceCache = null
  }
