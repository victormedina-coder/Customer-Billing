/**
 * GET /api/invoice/download/[invoiceId]/[format]
 *
 * Descarga un CFDI emitido en formato PDF o XML directamente desde Facturama.
 * El invoiceId (UUID de la fila en DB) actúa como token de capacidad: el cliente
 * solo conoce su UUID propio, nunca el facturamaId interno de Facturama.
 *
 * Params:
 *   invoiceId — UUID de la fila en la tabla invoices (token de capacidad)
 *   format    — 'pdf' | 'xml'
 *
 * Responde:
 *   200 + binario con Content-Type y Content-Disposition attachment
 *   400 INVALID_ID       → invoiceId no es un UUID válido
 *   400 FORMAT_INVALID   → format no es 'pdf' ni 'xml'
 *   404 NOT_FOUND        → no existe fila con ese invoiceId o no tiene facturamaId
 *   502 DOWNLOAD_ERROR   → Facturama no pudo servir el archivo
 *   503 SERVICE_ERROR    → error de red u otro error inesperado
 *
 * Runtime: Node.js — necesario para Buffer y fetch con credenciales de servidor.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getInvoiceService } from '@/lib/invoice-service'
import { findById } from '@/lib/db/invoice-repository'
import { InvoiceIdParamSchema } from '@/lib/api/schemas'

const ALLOWED_FORMATS = new Set(['pdf', 'xml'])

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  xml: 'application/xml',
}

/** Forma canónica de error de la API */
function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string; format: string }> }
): Promise<NextResponse> {
  // En Next.js 15+ los params de rutas dinámicas son Promise
  const { invoiceId, format } = await params

  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const ip = getClientIp(req)
  const rl = await rateLimit(`download:${ip}`, RATE_LIMITS.download.max, RATE_LIMITS.download.windowSec)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' } },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  // ── 1. Validar invoiceId (UUID) ──────────────────────────────────────────
  const idParse = InvoiceIdParamSchema.safeParse(invoiceId)
  if (!idParse.success) {
    return errorResponse('INVALID_ID', 'El identificador de factura no es válido.', 400)
  }

  // ── 2. Validar format ────────────────────────────────────────────────────
  if (!ALLOWED_FORMATS.has(format)) {
    return errorResponse(
      'FORMAT_INVALID',
      `Formato "${format}" no soportado. Use "pdf" o "xml".`,
      400
    )
  }

  const safeFormat = format as 'pdf' | 'xml'

  // ── 3. Resolver facturamaId desde la DB usando el invoiceId como token ───
  const row = await findById(invoiceId)
  if (!row || !row.facturamaId) {
    return errorResponse('NOT_FOUND', 'Factura no encontrada.', 404)
  }

  // ── 4. Descargar desde Facturama (con el facturamaId interno, nunca expuesto) ─
  let buffer: Buffer
  try {
    const invoiceService = getInvoiceService()
    buffer = await invoiceService.descargar(row.facturamaId, safeFormat)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const statusCode = (err as { statusCode?: number }).statusCode

    console.error('[download] Facturama:', { invoiceId, format: safeFormat, error: message })

    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return errorResponse('DOWNLOAD_ERROR', 'No se pudo obtener el archivo de la factura.', 502)
    }
    return errorResponse('SERVICE_ERROR', 'Error al descargar el archivo. Intenta de nuevo más tarde.', 503)
  }

  // ── 5. Responder con el binario ───────────────────────────────────────────
  const contentType = CONTENT_TYPES[safeFormat]
  // Sanitizar el nombre de archivo para evitar header injection en Content-Disposition
  const safeName = (row.uuidCfdi ?? row.id).replace(/[^A-Za-z0-9._-]/g, '')
  const filename = `Factura_${safeName}.${safeFormat}`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(buffer.length),
      // Evitar que el navegador cachee archivos fiscales
      'Cache-Control':       'no-store',
    },
  })
}
