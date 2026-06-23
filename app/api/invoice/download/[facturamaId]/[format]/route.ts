/**
 * GET /api/invoice/download/[facturamaId]/[format]
 *
 * Descarga un CFDI emitido en formato PDF o XML directamente desde Facturama.
 *
 * Params:
 *   facturamaId — ID devuelto por Facturama al emitir el CFDI
 *   format      — 'pdf' | 'xml'
 *
 * Responde:
 *   200 + binario con Content-Type y Content-Disposition attachment
 *   400 FORMAT_INVALID   → format no es 'pdf' ni 'xml'
 *   502 DOWNLOAD_ERROR   → Facturama no pudo servir el archivo
 *   503 SERVICE_ERROR    → error de red u otro error inesperado
 *
 * Runtime: Node.js — necesario para Buffer y fetch con credenciales de servidor.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getInvoiceService } from '@/lib/invoice-service'

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
  _req: Request,
  { params }: { params: Promise<{ facturamaId: string; format: string }> }
): Promise<NextResponse> {
  // En Next.js 15+ los params de rutas dinámicas son Promise
  const { facturamaId, format } = await params

  // ── 1. Validar format ────────────────────────────────────────────────────
  if (!ALLOWED_FORMATS.has(format)) {
    return errorResponse(
      'FORMAT_INVALID',
      `Formato "${format}" no soportado. Use "pdf" o "xml".`,
      400
    )
  }

  const safeFormat = format as 'pdf' | 'xml'

  // ── 2. Descargar desde Facturama ─────────────────────────────────────────
  let buffer: Buffer
  try {
    const invoiceService = getInvoiceService()
    buffer = await invoiceService.descargar(facturamaId, safeFormat)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const statusCode =
      (err as { statusCode?: number }).statusCode

    console.error('[download] Facturama:', { facturamaId, format, error: message })

    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return errorResponse('DOWNLOAD_ERROR', 'No se pudo obtener el archivo de la factura.', 502)
    }
    return errorResponse('SERVICE_ERROR', 'Error al descargar el archivo. Intenta de nuevo más tarde.', 503)
  }

  // ── 3. Responder con el binario ───────────────────────────────────────────
  const contentType = CONTENT_TYPES[safeFormat]
  const filename    = `${facturamaId}.${safeFormat}`

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
