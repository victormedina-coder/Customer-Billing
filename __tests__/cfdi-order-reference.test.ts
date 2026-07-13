/**
 * Tests de OrderNumber en buildCfdiPayload — feature "OrderNumber en la
 * emisión". Archivo separado de cfdi-mapper.test.ts (suite de caracterización
 * numérica delicada) para no tocar sus aserciones existentes.
 *
 * Decisión 2026-07-09: se manda SOLO OrderNumber (no Observations) — el
 * round-trip por API está verificado y así se evita imprimir la referencia
 * como "Observaciones" en el PDF del cliente.
 */
import { describe, it, expect } from 'vitest'
import { buildCfdiPayload } from '../src/infrastructure/facturama/cfdiPayloadBuilder'
import type { NormalizedOrderWithPayment, OrderLine } from '../src/domain/orders/Order'
import type { FiscalInput } from '../src/domain/fiscal/FiscalInput'

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
  { description: 'Item', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'P001' },
]

function makeOrder(overrides: Partial<NormalizedOrderWithPayment> = {}): NormalizedOrderWithPayment {
  return {
    id: 'test-id',
    orderNumber: '#46121',
    createdAt: '2026-06-15T12:00:00Z',
    currency: 'MXN',
    subtotal: 100,
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
    paymentGatewayNames: [],
    sourceIdentifier: '25-4191',
    ...overrides,
  }
}

describe('buildCfdiPayload — OrderNumber', () => {
  it('con sourceIdentifier: OrderNumber === "#name identifier"', () => {
    const payload = buildCfdiPayload(makeOrder(), fiscal, EXPEDITION_PLACE)
    expect(payload.OrderNumber).toBe('#46121 25-4191')
  })

  it('NO manda Observations (decisión 2026-07-09: solo OrderNumber)', () => {
    const payload = buildCfdiPayload(makeOrder(), fiscal, EXPEDITION_PLACE)
    expect(payload).not.toHaveProperty('Observations')
  })

  it('sin sourceIdentifier (null): solo "#name"', () => {
    const payload = buildCfdiPayload(makeOrder({ sourceIdentifier: null }), fiscal, EXPEDITION_PLACE)
    expect(payload.OrderNumber).toBe('#46121')
  })

  it('sin sourceIdentifier (undefined): solo "#name"', () => {
    const payload = buildCfdiPayload(makeOrder({ sourceIdentifier: undefined }), fiscal, EXPEDITION_PLACE)
    expect(payload.OrderNumber).toBe('#46121')
  })

  it('orderNumber sin # → se antepone', () => {
    const payload = buildCfdiPayload(makeOrder({ orderNumber: '46121' }), fiscal, EXPEDITION_PLACE)
    expect(payload.OrderNumber).toBe('#46121 25-4191')
  })

  it('caso real WB: prefijo de marca y sourceIdentifier completo se normalizan', () => {
    const payload = buildCfdiPayload(
      makeOrder({ orderNumber: 'WB#1151', sourceIdentifier: '87008247993-2-1266' }),
      fiscal,
      EXPEDITION_PLACE
    )
    expect(payload.OrderNumber).toBe('#1151 2-1266')
  })

  it('trunca defensivamente a 100 caracteres', () => {
    const longIdentifier = 'x'.repeat(200)
    const payload = buildCfdiPayload(
      makeOrder({ sourceIdentifier: longIdentifier }),
      fiscal,
      EXPEDITION_PLACE
    )
    expect(payload.OrderNumber!.length).toBeLessThanOrEqual(100)
  })
})
