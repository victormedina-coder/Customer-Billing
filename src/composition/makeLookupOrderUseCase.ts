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
import { getEvaluationNow } from '../infrastructure/time/getEvaluationNow'

export function makeLookupOrderUseCase(): LookupOrderUseCase {
  const deps: LookupOrderDeps = {
    orderSource: {
      findOrder: (query) => getOrderSource().findOrder(query),
    },
    refundPolicy: {
      isFullyRefunded: (order) => isFullyRefunded(order),
    },
    windowPolicy: {
      // getEvaluationNow(): una sola fuente de "ahora" en todo el portal (R3/D7)
      // — en producción siempre new Date() real; fuera de prod respeta
      // DEV_NOW_OVERRIDE para simular el corte de las 21:00 MX en local.
      isWithinInvoiceWindow: (createdAt) => isWithinInvoiceWindow(createdAt, getEvaluationNow()),
    },
    repo: {
      isAlreadyInvoiced: (orderId, storeName) => isAlreadyInvoiced(orderId, storeName),
    },
  }

  return new LookupOrderUseCase(deps)
}
