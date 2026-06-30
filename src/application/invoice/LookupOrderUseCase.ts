/**
 * LookupOrderUseCase — caso de uso de búsqueda de pedido para facturación.
 *
 * Orquesta: buscar pedido en Shopify, gate de monto, reembolso total,
 * ventana de facturación y doble-facturación.
 *
 * El rate-limit por IP y por folio se quedan en el handler (dependen de req).
 * El mapeo Order→Ticket también se queda en el handler (es una preocupación de UI).
 *
 * Devuelve Result<Order, LookupError> — nunca lanza para control de flujo.
 * NO importa 'next' ni construye NextResponse.
 */

import type { Order } from '../../domain/orders/Order'
import { ok, err } from '../shared/Result'
import type { Result } from '../shared/Result'
import { amountMatches } from '../../../lib/amount-match'

// ─── Tipos de error ───────────────────────────────────────────────────────────

export type LookupErrorCode =
  | 'VALIDATION_FAILED'
  | 'SHOPIFY_ERROR'
  | 'FULLY_REFUNDED'
  | 'DEADLINE_EXCEEDED'
  | 'ALREADY_INVOICED'

export interface LookupError {
  code: LookupErrorCode
  message: string
}

// ─── Ports mínimos ────────────────────────────────────────────────────────────

export interface LookupOrderSource {
  findOrder(query: { orderNumber: string; verifier: string }): Promise<Order | null>
}

export interface LookupRefundPolicy {
  isFullyRefunded(order: Order): boolean
}

export interface LookupWindowPolicy {
  isWithinInvoiceWindow(createdAt: string): boolean
}

export interface LookupRepo {
  isAlreadyInvoiced(orderId: string, storeName: string): Promise<boolean>
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface LookupOrderDeps {
  orderSource: LookupOrderSource
  refundPolicy: LookupRefundPolicy
  windowPolicy: LookupWindowPolicy
  repo: LookupRepo
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface LookupInput {
  folio: string
  amount: number
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class LookupOrderUseCase {
  constructor(private readonly deps: LookupOrderDeps) {}

  async execute(input: LookupInput): Promise<Result<Order, LookupError>> {
    const { folio, amount } = input
    const { orderSource, refundPolicy, windowPolicy, repo } = this.deps

    // ── 1. Buscar pedido en Shopify ───────────────────────────────────────────
    let order: Order | null
    try {
      order = await orderSource.findOrder({ orderNumber: folio, verifier: '' })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[lookup] Error al consultar Shopify:', { folio, error: message })
      return err({ code: 'SHOPIFY_ERROR', message: 'Error al consultar el pedido. Intenta de nuevo más tarde.' })
    }

    // ── 2. Gate de folio: VALIDATION_FAILED genérico (no revela si folio existe) ──
    if (!order) {
      return err({
        code: 'VALIDATION_FAILED',
        message: 'El folio o el monto no coinciden con un ticket facturable. Verifica los datos de tu ticket e intenta de nuevo.',
      })
    }

    // ── 3. Gate de monto (segundo factor) ────────────────────────────────────
    // Mismo error genérico que folio-no-encontrado para no revelar que el folio existe.
    if (!amountMatches(amount, order.total)) {
      return err({
        code: 'VALIDATION_FAILED',
        message: 'El folio o el monto no coinciden con un ticket facturable. Verifica los datos de tu ticket e intenta de nuevo.',
      })
    }

    // ── Compuerta superada: a partir de aquí podemos revelar estados específicos ──

    // ── 4. Verificar reembolso total ──────────────────────────────────────────
    if (refundPolicy.isFullyRefunded(order)) {
      return err({
        code: 'FULLY_REFUNDED',
        message: 'Este pedido fue reembolsado en su totalidad y no puede facturarse.',
      })
    }

    // ── 5. Validar ventana de facturación ─────────────────────────────────────
    if (!windowPolicy.isWithinInvoiceWindow(order.createdAt)) {
      return err({
        code: 'DEADLINE_EXCEEDED',
        message: 'El periodo de facturación de este ticket ya venció (solo se factura dentro del mes en curso).',
      })
    }

    // ── 6. Verificar doble-facturación ────────────────────────────────────────
    const invoiced = await repo.isAlreadyInvoiced(order.id, order.storeName)
    if (invoiced) {
      return err({
        code: 'ALREADY_INVOICED',
        message: 'Este pedido ya cuenta con un CFDI emitido.',
      })
    }

    return ok(order)
  }
}
