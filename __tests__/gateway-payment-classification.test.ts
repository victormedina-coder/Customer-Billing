import { describe, it, expect } from 'vitest'
import { classifyGateway } from '../src/domain/global/GatewayPaymentClassification'
import { buildCfdiPayload } from '../src/infrastructure/facturama/cfdiPayloadBuilder'
import type { NormalizedOrderWithPayment, OrderLine } from '../src/domain/orders/Order'
import type { FiscalInput } from '../src/domain/fiscal/FiscalInput'

/**
 * Consistencia mapPaymentForm (infra) ↔ classifyGateway (dominio): ambos
 * deben derivar de la MISMA tabla de clasificación (single source of truth
 * en src/domain/global/GatewayPaymentClassification.ts). Este test recorre
 * la clave SAT resultante de buildCfdiPayload y verifica que corresponde
 * exactamente a la clase que devuelve classifyGateway para el mismo gateway.
 */

const fiscal: FiscalInput = {
  rfc: 'EKU9003173C9',
  razon: 'ESCUELA KEMPER URGATE',
  regimen: '601',
  cp: '26015',
  uso: 'G01',
  email: 'test@test.com',
}
const EXPEDITION_PLACE = '26015'
const baseLine: OrderLine[] = [
  { description: 'Test', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'T001' },
]

function makeOrder(gateway: string): NormalizedOrderWithPayment {
  return {
    id: 'test-id',
    orderNumber: '1001',
    createdAt: '2026-06-15T12:00:00Z',
    currency: 'MXN',
    subtotal: 0,
    taxAmount: 16,
    total: 116,
    discountAmount: 0,
    shippingAmount: 0,
    lines: baseLine,
    customerEmail: 'buyer@test.com',
    alreadyInvoiced: false,
    storeName: 'Test Store',
    refundedAmount: 0,
    financialStatus: 'PAID',
    paymentGatewayNames: [gateway],
  }
}

const GATEWAY_CLASS_TO_SAT: Record<string, string> = {
  efectivo: '01',
  transferencia: '03',
  credito: '04',
  debito: '28',
}

describe('classifyGateway ↔ mapPaymentForm — misma tabla de clasificación', () => {
  const gateways = [
    'cash', 'efectivo', 'transfer', 'bogus', 'credit_card', 'paypal', 'debit_card', 'unknown_gateway',
    'tarjeta', 'Tarjeta', 'TARJETA',
  ]

  for (const gateway of gateways) {
    it(`"${gateway}": clave SAT de buildCfdiPayload coincide con classifyGateway`, () => {
      const gatewayClass = classifyGateway(gateway)
      const payload = buildCfdiPayload(makeOrder(gateway), fiscal, EXPEDITION_PLACE)

      const expectedSatCode = gatewayClass === 'unmapped' ? '03' : GATEWAY_CLASS_TO_SAT[gatewayClass]
      expect(payload.PaymentForm).toBe(expectedSatCode)
    })
  }

  it('gateway no reconocido → classifyGateway devuelve "unmapped"', () => {
    expect(classifyGateway('unknown_gateway')).toBe('unmapped')
  })

  it('"bogus" clasifica como transferencia (caso especial exacto, no substring)', () => {
    expect(classifyGateway('bogus')).toBe('transferencia')
  })

  it.each(['tarjeta', 'Tarjeta', 'TARJETA'])(
    '"%s" (gateway genérico histórico de la terminal Ariat) clasifica como crédito — decisión finanzas 2026-07-10',
    (gateway) => {
      expect(classifyGateway(gateway)).toBe('credito')
    },
  )

  it('"tarjeta de debito" NO clasifica por el match exacto de "tarjeta" (match sigue siendo substring de "debito")', () => {
    expect(classifyGateway('tarjeta de debito')).toBe('debito')
  })
})
