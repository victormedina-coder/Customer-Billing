/**
 * Composition root — cablea las dependencias del EmitInvoiceUseCase.
 *
 * Se llama DENTRO del handler POST en cada request, nunca a nivel de módulo.
 * Esto garantiza que los vi.mock de Vitest (que reemplazan estos módulos)
 * sigan interceptando cuando los tests llaman al handler.
 *
 * Regla de wiring:
 *   - Las factories de infra (getOrderSource, getInvoiceService) se invocan
 *     aquí en cada request, no se cachean a nivel módulo.
 *   - Las funciones del repo se importan directamente desde
 *     infrastructure/db/ (donde viven los mocks en los tests).
 */

import { EmitInvoiceUseCase } from '../application/invoice/EmitInvoiceUseCase'
import type { EmitInvoiceDeps } from '../application/invoice/EmitInvoiceUseCase'

// Estas importaciones vienen de lib/ para que los vi.mock de los tests
// intercepten exactamente estos módulos.
import { getOrderSource } from './orderSource'
import { getInvoiceService } from './invoiceService'
import {
  isAlreadyInvoiced,
  createInvoice,
  updateInvoiceStamp,
  deleteById,
} from '../infrastructure/db/invoice-repository'
import { isWithinInvoiceWindow } from '../domain/eligibility/InvoiceWindowPolicy'
import { isFullyRefunded } from '../domain/orders/RefundPolicy'

/**
 * Construye un EmitInvoiceUseCase con todas sus dependencias cableadas.
 * Debe invocarse dentro del handler POST (en cada request).
 */
export function makeEmitInvoiceUseCase(): EmitInvoiceUseCase {
  const deps: EmitInvoiceDeps = {
    orderSource: {
      // getOrderSource() se llama aquí (en tiempo de request) para que el mock
      // de vi.mock('../composition/orderSource') lo intercepte correctamente.
      findOrder: (query) => getOrderSource().findOrder(query),
    },
    stamping: {
      // getInvoiceService() se llama aquí por la misma razón.
      emitir:       (payload)              => getInvoiceService().emitir(payload),
      enviarCorreo: (id, email, opts)      => getInvoiceService().enviarCorreo(id, email, opts),
      obtener:      (id)                   => getInvoiceService().obtener(id),
      descargar:    (id, fmt)              => getInvoiceService().descargar(id, fmt),
      cancelar:     (id)                   => getInvoiceService().cancelar(id),
    },
    repo: {
      // Las funciones del repo se importan desde infrastructure/db/ directamente
      // para que los vi.mock('.../infrastructure/db/invoice-repository') de los
      // tests las intercepten.
      isAlreadyInvoiced: (orderId, storeName) => isAlreadyInvoiced(orderId, storeName),
      createInvoice:     (data)               => createInvoice(data),
      updateInvoiceStamp: (id, data)          => updateInvoiceStamp(id, data),
      deleteById:        (id)                 => deleteById(id),
    },
    refundPolicy: {
      isFullyRefunded: (order) => isFullyRefunded(order),
    },
    windowPolicy: {
      isWithinInvoiceWindow: (createdAt) => isWithinInvoiceWindow(createdAt),
    },
  }

  return new EmitInvoiceUseCase(deps)
}
