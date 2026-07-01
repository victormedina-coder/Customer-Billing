/**
 * Composition root — cablea las dependencias del LookupOrderUseCase.
 *
 * Se llama DENTRO del handler POST en cada request, nunca a nivel de módulo.
 * Esto garantiza que los vi.mock de Vitest (que reemplazan los módulos de lib/)
 * sigan interceptando cuando los tests llaman al handler.
 */

import { LookupOrderUseCase } from '../application/invoice/LookupOrderUseCase'
import type { LookupOrderDeps } from '../application/invoice/LookupOrderUseCase'

import { getOrderSource }    from './orderSource'
import { isAlreadyInvoiced } from '../infrastructure/db/invoice-repository'
import { isFullyRefunded }   from '../domain/orders/RefundPolicy'
import { isWithinInvoiceWindow } from '../domain/eligibility/InvoiceWindowPolicy'

export function makeLookupOrderUseCase(): LookupOrderUseCase {
  const deps: LookupOrderDeps = {
    orderSource: {
      findOrder: (query) => getOrderSource().findOrder(query),
    },
    refundPolicy: {
      isFullyRefunded: (order) => isFullyRefunded(order),
    },
    windowPolicy: {
      isWithinInvoiceWindow: (createdAt) => isWithinInvoiceWindow(createdAt),
    },
    repo: {
      isAlreadyInvoiced: (orderId, storeName) => isAlreadyInvoiced(orderId, storeName),
    },
  }

  return new LookupOrderUseCase(deps)
}
