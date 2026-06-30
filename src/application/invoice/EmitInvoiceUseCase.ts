/**
 * EmitInvoiceUseCase — caso de uso de emisión de CFDI.
 *
 * Orquesta los pasos 4–10 que antes vivían en el god-handler de
 * app/api/invoice/emit/route.ts. Recibe sus dependencias por inyección
 * para ser testeable de forma aislada.
 *
 * Devuelve Result<EmitOk, EmitError> — nunca lanza para control de flujo.
 * El handler de Next.js traduce el Result a NextResponse.
 *
 * NO importa 'next' ni construye NextResponse.
 */

import type { Order } from '../../domain/orders/Order'
import type { FiscalInput } from '../../domain/fiscal/FiscalInput'
import type { InvoiceStampingService, EmitResult } from '../../domain/invoicing/ports/InvoiceStampingService'
import type { CreateInvoiceData } from '../../infrastructure/db/invoice-repository'
import { ok, err } from '../shared/Result'
import type { Result } from '../shared/Result'
import { maskEmail } from '../../../lib/log-redact'

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export interface EmitInput {
  folio: string
  amount: number
  fiscal: FiscalInput
}

// ─── Tipos de salida ──────────────────────────────────────────────────────────

export type EmitErrorCode =
  | 'VALIDATION_FAILED'
  | 'ORDER_NOT_FOUND'
  | 'SHOPIFY_ERROR'
  | 'ALREADY_INVOICED'
  | 'FULLY_REFUNDED'
  | 'DEADLINE_EXCEEDED'
  | 'FACTURAMA_ERROR'

export interface EmitError {
  code: EmitErrorCode
  message: string
}

export interface EmitOk {
  invoiceId: string
  uuid: string
  serieFolio: string
  fecha: string
  sello: string
  emisor: EmitResult['emisor']
}

// ─── Port mínimo del repo necesario en este caso de uso ──────────────────────

export interface EmitInvoiceRepo {
  isAlreadyInvoiced(orderId: string, storeName: string): Promise<boolean>
  createInvoice(data: CreateInvoiceData): Promise<
    | { created: true; invoice: { id: string } }
    | { created: false; reason: string }
  >
  updateInvoiceStamp(
    invoiceId: string,
    data: { facturamaId: string; uuidCfdi: string; status: string }
  ): Promise<unknown>
  deleteById(invoiceId: string): Promise<void>
}

// ─── Port mínimo del OrderSource necesario en este caso de uso ───────────────

export interface EmitOrderSource {
  findOrder(query: { orderNumber: string; verifier: string }): Promise<Order | null>
}

// ─── Port mínimo de refund / ventana (domain services puros) ─────────────────

export interface RefundPolicyPort {
  isFullyRefunded(order: Order): boolean
}

export interface WindowPolicyPort {
  isWithinInvoiceWindow(createdAt: string): boolean
}

// ─── Utilidad: comparación de montos al centavo ───────────────────────────────

function toCents(value: number): number {
  return Math.round(value * 100)
}

function amountMatchesOrder(clientAmount: number, orderTotal: number): boolean {
  return toCents(clientAmount) === toCents(orderTotal)
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface EmitInvoiceDeps {
  orderSource: EmitOrderSource
  stamping: InvoiceStampingService
  repo: EmitInvoiceRepo
  refundPolicy: RefundPolicyPort
  windowPolicy: WindowPolicyPort
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class EmitInvoiceUseCase {
  constructor(private readonly deps: EmitInvoiceDeps) {}

  async execute(input: EmitInput): Promise<Result<EmitOk, EmitError>> {
    const { folio, amount, fiscal } = input
    const { orderSource, stamping, repo, refundPolicy, windowPolicy } = this.deps

    // ── 4. Re-lookup en Shopify ────────────────────────────────────────────
    let order: Order | null
    try {
      order = await orderSource.findOrder({ orderNumber: folio, verifier: '' })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[emit] Error al consultar Shopify:', { folio, error: message })
      return err({ code: 'SHOPIFY_ERROR', message: 'Error al consultar el pedido. Intenta de nuevo más tarde.' })
    }

    if (!order) {
      return err({ code: 'ORDER_NOT_FOUND', message: `No se encontró ningún pedido con el folio "${folio}".` })
    }

    // ── Segunda barrera de monto ───────────────────────────────────────────
    // Aunque el lookup ya validó el monto, un atacante puede llamar a emit
    // directamente sin pasar por lookup. La re-validación aquí es obligatoria:
    // si el monto no coincide → mismo error genérico que en lookup (VALIDATION_FAILED)
    // para no revelar que el folio sí existe.
    if (!amountMatchesOrder(amount, order.total)) {
      return err({
        code: 'VALIDATION_FAILED',
        message: 'El folio o el monto no coinciden con un ticket facturable. Verifica los datos de tu ticket e intenta de nuevo.',
      })
    }

    // ── Etapa 3: verificación real de doble-facturación ───────────────────
    const alreadyInvoiced = await repo.isAlreadyInvoiced(order.id, order.storeName)
    if (alreadyInvoiced) {
      return err({ code: 'ALREADY_INVOICED', message: 'Este pedido ya cuenta con un CFDI emitido.' })
    }

    if (refundPolicy.isFullyRefunded(order)) {
      return err({ code: 'FULLY_REFUNDED', message: 'Este pedido fue reembolsado en su totalidad y no puede facturarse.' })
    }

    // ── 5. Validar ventana de facturación ──────────────────────────────────
    if (!windowPolicy.isWithinInvoiceWindow(order.createdAt)) {
      return err({
        code: 'DEADLINE_EXCEEDED',
        message: 'El periodo de facturación de este ticket ya venció (solo se factura dentro del mes en curso).',
      })
    }

    // ── 6. Insert-first: adquirir el cerrojo UNIQUE antes de timbrar ───────
    // Insertamos una fila 'pending' que adquiere el cerrojo UNIQUE(order_id, store_name).
    // Si otro request ya lo tiene (carrera), createInvoice devuelve already_invoiced.
    // Esto serializa el timbrado: solo quien gana el INSERT gasta dinero en Facturama.
    // NOTA: una fila 'pending' también hará que isAlreadyInvoiced (paso anterior) devuelva
    // true — comportamiento conservador correcto. Un job de conciliación futuro deberá
    // limpiar filas 'pending' viejas (timbrados iniciados pero nunca completados).
    const pending = await repo.createInvoice({
      orderId: order.id,
      orderNumber: order.orderNumber,
      storeName: order.storeName,
      rfcReceptor: fiscal.rfc,
      razonSocial: fiscal.razon,
      email: fiscal.email,
      status: 'pending',
      invoiceType: 'individual',
    })
    if (!pending.created) {
      return err({ code: 'ALREADY_INVOICED', message: 'Este pedido ya cuenta con un CFDI emitido.' })
    }
    const invoiceId = pending.invoice.id

    // ── 7. Timbrar en Facturama ────────────────────────────────────────────
    let emitResult: EmitResult
    try {
      emitResult = await stamping.emitir({ order, fiscal })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[emit] Facturama:', message)
      // El timbrado falló: liberamos el cerrojo borrando la fila pendiente para
      // permitir que el cliente reintente.
      try {
        await repo.deleteById(invoiceId)
      } catch (delErr: unknown) {
        const delMsg = delErr instanceof Error ? delErr.message : String(delErr)
        console.error('[emit] No se pudo limpiar la fila pendiente tras fallo de timbrado:', {
          invoiceId, error: delMsg,
        })
      }
      return err({ code: 'FACTURAMA_ERROR', message: 'Error al generar la factura. Intenta de nuevo más tarde.' })
    }

    // ── 8. Persistir los datos del CFDI en la fila ya bloqueada ─────────────
    // El cerrojo ya está tomado; este UPDATE no puede fallar por carrera.
    // Si la DB falla aquí (raro), el CFDI YA está timbrado y el pedido sigue
    // bloqueado contra doble-timbre — se concilia manualmente. No tumbamos la respuesta.
    try {
      await repo.updateInvoiceStamp(invoiceId, {
        facturamaId: emitResult.facturamaId,
        uuidCfdi: emitResult.uuid,
        status: 'emitted',
      })
    } catch (dbErr: unknown) {
      const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr)
      console.error('[emit] CFDI timbrado pero no se pudo actualizar la fila (conciliar):', {
        invoiceId, error: dbMsg,
      })
    }

    // ── 9. Enviar el CFDI por correo (best-effort) ─────────────────────────
    try {
      await stamping.enviarCorreo(emitResult.facturamaId, fiscal.email, {
        serieFolio: emitResult.serieFolio,
      })
    } catch (mailErr: unknown) {
      const mailMsg = mailErr instanceof Error ? mailErr.message : String(mailErr)
      console.error('[emit] Correo automático falló (CFDI ya timbrado):', {
        facturamaId: emitResult.facturamaId, email: maskEmail(fiscal.email), error: mailMsg,
      })
    }

    // ── 10. Devolver resultado exitoso ─────────────────────────────────────
    return ok({
      invoiceId,
      uuid:       emitResult.uuid,
      serieFolio: emitResult.serieFolio,
      fecha:      emitResult.fecha,
      sello:      emitResult.sello,
      emisor:     emitResult.emisor,
    })
  }
}
