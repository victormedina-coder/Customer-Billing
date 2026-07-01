/**
 * Composition root — cablea las dependencias del ResendInvoiceUseCase.
 *
 * Se llama DENTRO del handler POST en cada request, nunca a nivel de módulo.
 * Esto garantiza que los vi.mock de Vitest (que reemplazan los módulos de lib/)
 * sigan interceptando cuando los tests llaman al handler.
 */

import { ResendInvoiceUseCase } from '../application/invoice/ResendInvoiceUseCase'
import type { ResendInvoiceDeps } from '../application/invoice/ResendInvoiceUseCase'

import { findById }          from '../infrastructure/db/invoice-repository'
import { getInvoiceService } from './invoiceService'

export function makeResendInvoiceUseCase(): ResendInvoiceUseCase {
  const deps: ResendInvoiceDeps = {
    repo: {
      findById: (invoiceId) => findById(invoiceId),
    },
    mailer: {
      enviarCorreo: (facturamaId, email, opts) =>
        getInvoiceService().enviarCorreo(facturamaId, email, opts),
    },
  }

  return new ResendInvoiceUseCase(deps)
}
