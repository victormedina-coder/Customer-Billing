/**
 * Composition root — cablea las dependencias del EmitInvoiceUseCase.
 *
 * Se llama DENTRO del handler POST en cada request, nunca a nivel de módulo.
 * Esto garantiza que los vi.mock de Vitest (que reemplazan los módulos de lib/)
 * sigan interceptando cuando los tests llaman al handler.
 *
 * Regla de wiring:
 *   - Las factories de infra (getOrderSource, getInvoiceService) se invocan
 *     aquí en cada request, no se cachean a nivel módulo.
 *   - Las funciones del repo se importan directamente desde lib/ (donde viven
 *     los mocks en los tests).
 */

import { EmitInvoiceUseCase } from '../application/invoice/EmitInvoiceUseCase'
import type { EmitInvoiceDeps } from '../application/invoice/EmitInvoiceUseCase'

// Estas importaciones vienen de lib/ para que los vi.mock de los tests
// intercepten exactamente estos módulos.
import { getOrderSource } from '../../lib/order-source'
import { getInvoiceService } from '../../lib/invoice-service'
import {
  isAlreadyInvoiced,
  createInvoice,
  updateInvoiceStamp,
  deleteById,
} from '../../lib/db/invoice-repository'
import { isWithinInvoiceWindow } from '../../lib/invoice-window'
import { isFullyRefunded } from '../../lib/refund'

/**
 * Construye un EmitInvoiceUseCase con todas sus dependencias cableadas.
 * Debe invocarse dentro del handler POST (en cada request).
 */
export function makeEmitInvoiceUseCase(): EmitInvoiceUseCase {
  const deps: EmitInvoiceDeps = {
    orderSource: {
      // getOrderSource() se llama aquí (en tiempo de request) para que el mock
      // de vi.mock('../lib/order-source') lo intercepte correctamente.
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
      // Las funciones del repo se importan desde lib/ (puente) para que los
      // vi.mock('../lib/db/invoice-repository') de los tests las intercepten.
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
