/**
 * ResendInvoiceUseCase — caso de uso de reenvío de CFDI por correo.
 *
 * Orquesta: buscar fila por invoiceId, verificar que tenga facturamaId,
 * verificar que tenga email guardado, reenviar correo SOLO al email de la DB.
 *
 * Seguridad IDOR: el invoiceId actúa como token de capacidad (UUID de DB).
 * El email destino se toma EXCLUSIVAMENTE de la fila en DB — nunca del request.
 *
 * Devuelve Result<{ ok: true }, ResendError> — nunca lanza para control de flujo.
 * NO importa 'next' ni construye NextResponse.
 */

import { ok, err } from '../shared/Result'
import type { Result } from '../shared/Result'

// ─── Tipos de error ───────────────────────────────────────────────────────────

export type ResendErrorCode =
  | 'NOT_FOUND'
  | 'NO_EMAIL'
  | 'EMAIL_ERROR'

export interface ResendError {
  code: ResendErrorCode
  message: string
}

// ─── Tipo mínimo de fila que necesita el use case ────────────────────────────

export interface ResendInvoiceRow {
  facturamaId: string | null
  email: string | null
}

// ─── Ports mínimos ────────────────────────────────────────────────────────────

export interface ResendRepo {
  findById(invoiceId: string): Promise<ResendInvoiceRow | null>
}

export interface ResendMailer {
  enviarCorreo(facturamaId: string, email: string, opts: Record<string, unknown>): Promise<void>
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface ResendInvoiceDeps {
  repo: ResendRepo
  mailer: ResendMailer
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class ResendInvoiceUseCase {
  constructor(private readonly deps: ResendInvoiceDeps) {}

  async execute(invoiceId: string): Promise<Result<{ ok: true }, ResendError>> {
    const { repo, mailer } = this.deps

    // ── 1. Resolver fila en DB usando el invoiceId como token de capacidad ────
    const row = await repo.findById(invoiceId)
    if (!row || !row.facturamaId) {
      return err({ code: 'NOT_FOUND', message: 'Factura no encontrada.' })
    }

    // ── 2. Usar el email guardado en DB — nunca el del request ───────────────
    if (!row.email) {
      return err({ code: 'NO_EMAIL', message: 'No hay correo registrado para esta factura.' })
    }

    // ── 3. Enviar correo vía InvoiceService ───────────────────────────────────
    try {
      await mailer.enviarCorreo(row.facturamaId, row.email, {})
      return ok({ ok: true as const })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      // No loguear el email en claro — solo el invoiceId y el error
      console.error('[resend] Error al enviar el correo:', { invoiceId, error: message })
      return err({ code: 'EMAIL_ERROR', message: 'No se pudo enviar el correo. Intenta de nuevo más tarde.' })
    }
  }
}
