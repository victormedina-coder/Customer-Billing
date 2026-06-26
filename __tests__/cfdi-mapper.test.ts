import { describe, it, expect } from 'vitest'
import { buildCfdiPayload } from '../lib/invoice-service/cfdi-mapper'
import type { CfdiItem } from '../lib/invoice-service/cfdi-mapper'
import type { NormalizedOrderWithPayment } from '../lib/shopify/mapper'
import type { FiscalInput } from '../lib/invoice-service/types'

const fiscal: FiscalInput = {
  rfc: 'EKU9003173C9',
  razon: 'ESCUELA KEMPER URGATE',
  regimen: '601',
  cp: '26015',
  uso: 'G01',
  email: 'test@test.com',
}

function makeOrder(overrides: Partial<NormalizedOrderWithPayment> = {}): NormalizedOrderWithPayment {
  return {
    id: 'test-id',
    orderNumber: '1001',
    createdAt: '2026-06-15T12:00:00Z',
    currency: 'MXN',
    subtotal: 0,
    taxAmount: 0,
    total: 0,
    discountAmount: 0,
    shippingAmount: 0,
    lines: [],
    customerEmail: 'buyer@test.com',
    alreadyInvoiced: false,
    storeName: 'Test Store',
    refundedAmount: 0,
    financialStatus: 'PAID',
    paymentGatewayNames: [],
    ...overrides,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Verifica las 3 invariantes fiscales en TODOS los items del payload.
 *   1. Subtotal === UnitPrice × Quantity  (redondeado a 2)
 *   2. Base    === Subtotal − Discount    (Discount = 0 si no existe)
 *   3. Total   === Base + IVA
 */
function assertItemIdentities(items: CfdiItem[]): void {
  for (const it of items) {
    const qty  = parseFloat(it.Quantity)
    const unit = parseFloat(it.UnitPrice)
    const sub  = parseFloat(it.Subtotal)
    const disc = it.Discount !== undefined ? parseFloat(it.Discount) : 0
    const base = parseFloat(it.Taxes[0].Base)
    const iva  = parseFloat(it.Taxes[0].Total)
    const total = parseFloat(it.Total)
    // 1. Subtotal === UnitPrice × Quantity
    expect(Math.round(unit * qty * 100) / 100).toBeCloseTo(sub, 2)
    // 2. Base === Subtotal − Discount
    expect(Math.round((sub - disc) * 100) / 100).toBeCloseTo(base, 2)
    // 3. Total === Base + IVA
    expect(Math.round((base + iva) * 100) / 100).toBeCloseTo(total, 2)
  }
}

// ── Test 1: línea única sin descuento, IVA inclusivo ─────────────────────────
describe('buildCfdiPayload — línea única sin descuento, IVA inclusivo', () => {
  const order = makeOrder({
    total: 116,
    shippingAmount: 0,
    discountAmount: 0,
    taxAmount: 16,
    lines: [
      { description: 'Sombrero', quantity: 1, unitPrice: 116, unitPriceIncludesTax: true, discount: 0, productCode: 'SKU-001' },
    ],
  })
  const payload = buildCfdiPayload(order, fiscal)
  const items = payload.Items

  it('retorna 1 item', () => expect(items).toHaveLength(1))
  it('CfdiType === I', () => expect(payload.CfdiType).toBe('I'))
  it('PaymentMethod === PUE', () => expect(payload.PaymentMethod).toBe('PUE'))
  it('Currency === MXN', () => expect(payload.Currency).toBe('MXN'))
  it('Total del item ≈ 116 (precio con IVA, sin descuento)', () => {
    // Total en CFDI = base sin IVA + IVA = (116/1.16) + (116/1.16)*0.16 = 116
    expect(parseFloat(items[0].Total)).toBeCloseTo(116, 2)
  })
  it('Tasa de IVA === 0.16', () => {
    expect(parseFloat(items[0].Taxes[0].Rate)).toBe(0.16)
  })
  it('invariante: Subtotal === UnitPrice × Quantity', () => {
    const item = items[0]
    const computed = round2(parseFloat(item.UnitPrice) * parseFloat(item.Quantity))
    expect(computed).toBeCloseTo(parseFloat(item.Subtotal), 2)
  })
})

// ── Test 2: línea única con descuento a nivel pedido (5-1086) ─────────────────
describe('buildCfdiPayload — línea única con descuento a nivel pedido', () => {
  const order = makeOrder({
    total: 480,
    taxAmount: 66.21,
    discountAmount: 320,
    shippingAmount: 0,
    lines: [
      { description: 'Sombrero Test', quantity: 1, unitPrice: 800, unitPriceIncludesTax: true, discount: 0, productCode: 'SKU-001' },
    ],
  })
  const payload = buildCfdiPayload(order, fiscal)
  const items = payload.Items

  it('Total del item ≈ 480', () => {
    expect(parseFloat(items[0].Total)).toBeCloseTo(480, 1)
  })
  it('Discount existe y es > 0', () => {
    expect(items[0].Discount).toBeDefined()
    expect(parseFloat(items[0].Discount!)).toBeGreaterThan(0)
  })
  it('invariante: Subtotal === UnitPrice × Quantity', () => {
    const item = items[0]
    const computed = round2(parseFloat(item.UnitPrice) * parseFloat(item.Quantity))
    expect(computed).toBeCloseTo(parseFloat(item.Subtotal), 2)
  })
  it('suma de totales ≈ 480', () => {
    const sum = items.reduce((acc, it) => acc + parseFloat(it.Total), 0)
    expect(sum).toBeCloseTo(480, 1)
  })
})

// ── Test 3: multi-línea sin descuento (expone el bug del cent-fix) ────────────
describe('buildCfdiPayload — multi-línea sin descuento', () => {
  const order = makeOrder({
    total: 232,
    shippingAmount: 0,
    discountAmount: 0,
    taxAmount: 32,
    lines: [
      { description: 'Sombrero A', quantity: 1, unitPrice: 116, unitPriceIncludesTax: true, discount: 0, productCode: 'A001' },
      { description: 'Sombrero B', quantity: 1, unitPrice: 116, unitPriceIncludesTax: true, discount: 0, productCode: 'B001' },
    ],
  })
  const payload = buildCfdiPayload(order, fiscal)
  const items = payload.Items

  it('suma de totales === 232 (±0.02)', () => {
    const sum = items.reduce((acc, it) => acc + parseFloat(it.Total), 0)
    expect(sum).toBeCloseTo(232, 1)
  })

  it('invariante Subtotal === UnitPrice × Quantity en cada item', () => {
    for (const item of items) {
      const computed = round2(parseFloat(item.UnitPrice) * parseFloat(item.Quantity))
      expect(computed).toBeCloseTo(parseFloat(item.Subtotal), 2)
    }
  })

  it('suma de los dos totales ≈ 232', () => {
    const sum = parseFloat(items[0].Total) + parseFloat(items[1].Total)
    expect(sum).toBeCloseTo(232, 1)
  })

  it('assertItemIdentities: las 3 invariantes en todos los items', () => {
    assertItemIdentities(items)
  })
})

// ── Test 4: multi-línea con descuento a nivel pedido ─────────────────────────
describe('buildCfdiPayload — multi-línea con descuento a nivel pedido', () => {
  const order = makeOrder({
    total: 460,
    discountAmount: 100,
    taxAmount: 63.45,
    shippingAmount: 0,
    lines: [
      { description: 'Sombrero X', quantity: 2, unitPrice: 300, unitPriceIncludesTax: true, discount: 0, productCode: 'X001' },
      { description: 'Sombrero Y', quantity: 1, unitPrice: 260, unitPriceIncludesTax: true, discount: 0, productCode: 'Y001' },
    ],
  })
  const payload = buildCfdiPayload(order, fiscal)
  const items = payload.Items

  it('suma de totales ≈ 460 (±0.05)', () => {
    const sum = items.reduce((acc, it) => acc + parseFloat(it.Total), 0)
    expect(Math.abs(sum - 460)).toBeLessThanOrEqual(0.05)
  })

  it('invariante Subtotal === UnitPrice × Quantity en todos los items', () => {
    for (const item of items) {
      const computed = round2(parseFloat(item.UnitPrice) * parseFloat(item.Quantity))
      expect(computed).toBeCloseTo(parseFloat(item.Subtotal), 2)
    }
  })

  it('assertItemIdentities: las 3 invariantes en todos los items', () => {
    assertItemIdentities(items)
  })
})

// ── Test 5: mapPaymentForm — casos de gateway (via buildCfdiPayload) ──────────
describe('mapPaymentForm — via buildCfdiPayload', () => {
  const baseLine = [{ description: 'Test', quantity: 1, unitPrice: 116, unitPriceIncludesTax: true, discount: 0, productCode: 'T001' }]

  it("['cash'] → PaymentForm === '01'", () => {
    const p = buildCfdiPayload(makeOrder({ total: 116, taxAmount: 16, lines: baseLine, paymentGatewayNames: ['cash'] }), fiscal)
    expect(p.PaymentForm).toBe('01')
  })
  it("['credit_card'] → PaymentForm === '04'", () => {
    const p = buildCfdiPayload(makeOrder({ total: 116, taxAmount: 16, lines: baseLine, paymentGatewayNames: ['credit_card'] }), fiscal)
    expect(p.PaymentForm).toBe('04')
  })
  it("['debit_card'] → PaymentForm === '28'", () => {
    const p = buildCfdiPayload(makeOrder({ total: 116, taxAmount: 16, lines: baseLine, paymentGatewayNames: ['debit_card'] }), fiscal)
    expect(p.PaymentForm).toBe('28')
  })
  it("['bogus'] → PaymentForm === '03'", () => {
    const p = buildCfdiPayload(makeOrder({ total: 116, taxAmount: 16, lines: baseLine, paymentGatewayNames: ['bogus'] }), fiscal)
    expect(p.PaymentForm).toBe('03')
  })
  it('[] → PaymentForm es el default (03 sin env)', () => {
    const p = buildCfdiPayload(makeOrder({ total: 116, taxAmount: 16, lines: baseLine, paymentGatewayNames: [] }), fiscal)
    expect(p.PaymentForm).toBe('03')
  })
  it('undefined → mismo default', () => {
    const p = buildCfdiPayload(makeOrder({ total: 116, taxAmount: 16, lines: baseLine, paymentGatewayNames: undefined }), fiscal)
    expect(p.PaymentForm).toBe('03')
  })
})

// ── Test 7: cent-fix con descuento — verifica las 3 invariantes ───────────────
// Diseño para disparar el cent-fix sobre el último item con descuento:
//   Línea 1: qty=3  × $99.99  con IVA → listGross = 299.97
//   Línea 2: qty=7  × $31.43  con IVA → listGross = 220.01
//   Línea 3: qty=4  × $74.95  con IVA → listGross = 299.80
// total lista bruto = 819.78; descuentoANivPedido = $57.78 con IVA
// total final = 819.78 − 57.78 = 762.00
// Las divisiones por 1.16 y el escalado proporcional generan residuos de
// centavos que activan el cent-fix en la línea 3, que ahora lleva descuento.
describe('buildCfdiPayload — cent-fix en último item CON descuento (C1 regression)', () => {
  const order = makeOrder({
    total: 762.00,
    discountAmount: 57.78,
    taxAmount: 0,   // no lo usa buildCfdiPayload directamente
    shippingAmount: 0,
    lines: [
      { description: 'Producto A', quantity: 3,  unitPrice: 99.99, unitPriceIncludesTax: true, discount: 0, productCode: 'A001' },
      { description: 'Producto B', quantity: 7,  unitPrice: 31.43, unitPriceIncludesTax: true, discount: 0, productCode: 'B001' },
      { description: 'Producto C', quantity: 4,  unitPrice: 74.95, unitPriceIncludesTax: true, discount: 0, productCode: 'C001' },
    ],
  })
  const payload = buildCfdiPayload(order, fiscal)
  const items = payload.Items

  it('retorna 3 items', () => expect(items).toHaveLength(3))

  it('Σ Total === order.total (±0.02)', () => {
    const sum = items.reduce((acc, it) => acc + parseFloat(it.Total), 0)
    expect(Math.abs(sum - 762.00)).toBeLessThanOrEqual(0.02)
  })

  it('el último item tiene Discount definido (el cent-fix lo conservó)', () => {
    // Si el cent-fix se activó, el último item debe conservar su descuento
    const last = items[items.length - 1]
    expect(last.Discount).toBeDefined()
    expect(parseFloat(last.Discount!)).toBeGreaterThan(0)
  })

  it('assertItemIdentities: las 3 invariantes en TODOS los items', () => {
    assertItemIdentities(items)
  })
})

// ── Test 6: Receptor en el payload ────────────────────────────────────────────
describe('buildCfdiPayload — Receiver', () => {
  const order = makeOrder({
    total: 116,
    taxAmount: 16,
    lines: [{ description: 'Item', quantity: 1, unitPrice: 116, unitPriceIncludesTax: true, discount: 0, productCode: 'P001' }],
  })
  const payload = buildCfdiPayload(order, fiscal)

  it('Receiver.Rfc === EKU9003173C9', () => expect(payload.Receiver.Rfc).toBe('EKU9003173C9'))
  it('Receiver.Name === fiscal.razon', () => expect(payload.Receiver.Name).toBe(fiscal.razon))
  it('Receiver.FiscalRegime === 601', () => expect(payload.Receiver.FiscalRegime).toBe('601'))
})
