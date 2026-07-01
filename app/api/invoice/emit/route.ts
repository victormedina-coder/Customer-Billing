/**
 * POST /api/invoice/emit
 *
 * Recibe: { folio: string, amount: number, fiscal: FiscalData }
 * Responde: { factura: { invoiceId, uuid, serieFolio, fecha, sello, emisor } } en 200,
 *           o error estructurado en 4xx/5xx.
 *
 * Runtime: Node.js (no edge) — secretos de servidor, caché OAuth en memoria.
 *
 * Errores:
 *   400 FISCAL_INVALID    → Zod falla en fiscal o folio
 *   400 INVALID_FOLIO     → folio vacío tras trim
 *   404 ORDER_NOT_FOUND   → Shopify no encuentra el pedido
 *   409 ALREADY_INVOICED  → el pedido ya tiene CFDI (activado en Etapa 3)
 *   409 FULLY_REFUNDED    → pedido reembolsado en su totalidad (neto = 0)
 *   422 DEADLINE_EXCEEDED → fuera de la ventana de facturación
 *   422 VALIDATION_FAILED → monto no coincide con el pedido
 *   502 SHOPIFY_ERROR     → todas las tiendas fallaron / error de conexión
 *   503 FACTURAMA_ERROR   → Facturama lanza error al timbrar
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { RATE_LIMITS } from '@/src/infrastructure/rate-limit'
import { EmitSchema } from '@/lib/api/schemas'
import { makeEmitInvoiceUseCase } from '@/src/composition/makeEmitInvoiceUseCase'
import type { EmitErrorCode } from '@/src/application/invoice/EmitInvoiceUseCase'
import { httpError } from '@/src/interface/http/httpError'
import { enforceRateLimit } from '@/src/interface/http/withRateLimit'

/** Genera un CFDI de prueba sin llamar a Facturama ni Shopify */
function mockCfdi(folio: string) {
  void folio
  const now = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const fecha = `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`
  const folioNum = Math.floor(100000 + Math.random() * 899999)
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/'
  const sello = Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const uuid = crypto.randomUUID()
  return {
    invoiceId: crypto.randomUUID(),
    uuid,
    serieFolio: `GR-${folioNum}`,
    fecha,
    sello,
    emisor: { rfc: 'XAXX010101000', nombre: 'EMISOR DEMO (MOCK)', regimen: '601' },
  }
}

/** Mapa de código de error de dominio → status HTTP */
const ERROR_STATUS: Record<EmitErrorCode, number> = {
  VALIDATION_FAILED:  422,
  ORDER_NOT_FOUND:    404,
  SHOPIFY_ERROR:      502,
  ALREADY_INVOICED:   409,
  FULLY_REFUNDED:     409,
  DEADLINE_EXCEEDED:  422,
  FACTURAMA_ERROR:    503,
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const rateLimited = await enforceRateLimit(req, 'emit', RATE_LIMITS.emit.max, RATE_LIMITS.emit.windowSec)
  if (rateLimited) return rateLimited

  // ── 1. Parsear body ───────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return httpError('INVALID_BODY', 'El cuerpo de la petición no es JSON válido.', 400)
  }

  // ── 2. Validación Zod ─────────────────────────────────────────────────────
  const result = EmitSchema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues.map(i => i.message).join('; ')
    return httpError('FISCAL_INVALID', msg, 400)
  }
  const { folio: rawFolio, amount, fiscal } = result.data
  const folio = rawFolio.trim()
  if (!folio) {
    return httpError('INVALID_FOLIO', 'El folio no puede estar vacío.', 400)
  }

  // ── 3. Mock de emit (desarrollo sin credenciales) ─────────────────────────
  if (process.env.EMIT_MOCK === 'true') {
    const { invoiceId, uuid, serieFolio, fecha, sello, emisor } = mockCfdi(folio)
    const factura = { invoiceId, uuid, serieFolio, fecha, sello, emisor }
    return NextResponse.json({ factura }, { status: 200 })
  }

  // ── 4–10. Orquestación delegada al use case ───────────────────────────────
  const useCase = makeEmitInvoiceUseCase()
  const ucResult = await useCase.execute({ folio, amount, fiscal })

  if (!ucResult.ok) {
    const { code, message } = ucResult.error
    return httpError(code, message, ERROR_STATUS[code])
  }

  const factura = ucResult.value
  return NextResponse.json({ factura }, { status: 200 })
}
