/**
 * Composition root — cablea las dependencias del DownloadInvoiceUseCase.
 *
 * Se llama DENTRO del handler GET en cada request, nunca a nivel de módulo.
 * Esto garantiza que los vi.mock de Vitest (que reemplazan los módulos de lib/)
 * sigan interceptando cuando los tests llaman al handler.
 */

import { DownloadInvoiceUseCase } from '../application/invoice/DownloadInvoiceUseCase'
import type { DownloadInvoiceDeps } from '../application/invoice/DownloadInvoiceUseCase'

import { findById }          from '../infrastructure/db/invoice-repository'
import { getInvoiceService } from './invoiceService'

export function makeDownloadInvoiceUseCase(): DownloadInvoiceUseCase {
  const deps: DownloadInvoiceDeps = {
    repo: {
      findById: (invoiceId) => findById(invoiceId),
    },
    invoiceService: {
      descargar: (facturamaId, format) =>
        getInvoiceService().descargar(facturamaId, format),
    },
  }

  return new DownloadInvoiceUseCase(deps)
}
