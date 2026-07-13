import { describe, it, expect } from 'vitest'
import { buildGlobalCfdiPayload } from '../src/infrastructure/facturama/globalCfdiPayloadBuilder'
import type { CfdiItem } from '../src/infrastructure/facturama/cfdiPayloadBuilder'
import { createGlobalPeriod } from '../src/domain/global/GlobalPeriod'
import type { MonthlyOrder } from '../src/domain/global/ports/MonthlyOrderSource'
import type { Order, OrderLine } from '../src/domain/orders/Order'

const EXPEDITION_PLACE = '26015'
const PERIOD = createGlobalPeriod(2026, 6)

const baseLine: OrderLine = {
  description: 'Sombrero', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'SKU-1',
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: '#1001',
    createdAt: '2026-06-15T12:00:00Z',
    currency: 'MXN',
    subtotal: 100,
    taxAmount: 16,
    total: 116,
    discountAmount: 0,
    shippingAmount: 0,
    lines: [baseLine],
    customerEmail: 'cliente@example.com',
    alreadyInvoiced: false,
    storeName: 'tienda-ariat',
    refundedAmount: 0,
    financialStatus: 'PAID',
    sourceIdentifier: '87008247993-2-1266',
    ...overrides,
  }
}

function makeMonthlyOrder(overrides: Partial<Order> = {}): MonthlyOrder {
  return { order: makeOrder(overrides), payments: [] }
}

function assertItemIdentities(items: CfdiItem[]): void {
  for (const it of items) {
    const qty = parseFloat(it.Quantity)
    const unit = parseFloat(it.UnitPrice)
    const sub = parseFloat(it.Subtotal)
    const disc = it.Discount !== undefined ? parseFloat(it.Discount) : 0
    const iva = it.Taxes && it.Taxes.length > 0 ? parseFloat(it.Taxes[0].Total) : 0
    const base = it.Taxes && it.Taxes.length > 0 ? parseFloat(it.Taxes[0].Base) : sub - disc
    const total = parseFloat(it.Total)
    expect(Math.round(unit * qty * 100) / 100).toBeCloseTo(sub, 2)
    expect(Math.round((sub - disc) * 100) / 100).toBeCloseTo(base, 2)
    expect(Math.round((base + iva) * 100) / 100).toBeCloseTo(total, 2)
  }
}

describe('buildGlobalCfdiPayload — encabezado', () => {
  const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)

  it('CfdiType === I', () => expect(payload.CfdiType).toBe('I'))
  it('PaymentMethod === PUE', () => expect(payload.PaymentMethod).toBe('PUE'))
  it('Currency === MXN', () => expect(payload.Currency).toBe('MXN'))
  it('ExpeditionPlace viene del parámetro', () => expect(payload.ExpeditionPlace).toBe(EXPEDITION_PLACE))

  it('lanza si expeditionPlace viene vacío', () => {
    expect(() =>
      buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder()], 'tienda-ariat', '')
    ).toThrow(/expeditionPlace es obligatorio/)
  })

  it('lanza si orders viene vacío', () => {
    expect(() => buildGlobalCfdiPayload(PERIOD, 'credito', [], 'tienda-ariat', EXPEDITION_PLACE)).toThrow(
      /orders no puede estar vacío/
    )
  })

  it('NO manda OrderNumber (es exclusivo de las individuales)', () => {
    expect(payload).not.toHaveProperty('OrderNumber')
  })
})

describe('buildGlobalCfdiPayload — Receiver fijo "Público en general"', () => {
  const payload = buildGlobalCfdiPayload(PERIOD, 'debito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)

  it('Rfc === XAXX010101000', () => expect(payload.Receiver.Rfc).toBe('XAXX010101000'))
  it('Name === PUBLICO EN GENERAL', () => expect(payload.Receiver.Name).toBe('PUBLICO EN GENERAL'))
  it('CfdiUse === S01', () => expect(payload.Receiver.CfdiUse).toBe('S01'))
  it('FiscalRegime === 616', () => expect(payload.Receiver.FiscalRegime).toBe('616'))
  it('TaxZipCode === ExpeditionPlace', () => expect(payload.Receiver.TaxZipCode).toBe(EXPEDITION_PLACE))
})

describe('buildGlobalCfdiPayload — GlobalInformation', () => {
  it('Periodicity/Months/Year derivan del GlobalPeriod', () => {
    const payload = buildGlobalCfdiPayload(
      createGlobalPeriod(2026, 3),
      'efectivo',
      [makeMonthlyOrder()],
      'tienda-ariat',
      EXPEDITION_PLACE
    )
    expect(payload.GlobalInformation).toEqual({ Periodicity: '04', Months: '03', Year: '2026' })
  })

  it('diciembre → Months "12"', () => {
    const payload = buildGlobalCfdiPayload(
      createGlobalPeriod(2026, 12),
      'efectivo',
      [makeMonthlyOrder()],
      'tienda-ariat',
      EXPEDITION_PLACE
    )
    expect(payload.GlobalInformation.Months).toBe('12')
  })
})

describe('buildGlobalCfdiPayload — PaymentForm por bucket', () => {
  it("bucket 'credito' → PaymentForm '04'", () => {
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)
    expect(payload.PaymentForm).toBe('04')
  })
  it("bucket 'debito' → PaymentForm '28'", () => {
    const payload = buildGlobalCfdiPayload(PERIOD, 'debito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)
    expect(payload.PaymentForm).toBe('28')
  })
  it("bucket 'efectivo' → PaymentForm '01'", () => {
    const payload = buildGlobalCfdiPayload(PERIOD, 'efectivo', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)
    expect(payload.PaymentForm).toBe('01')
  })
})

describe('buildGlobalCfdiPayload — un Item por pedido', () => {
  it('N pedidos → N items, en el mismo orden', () => {
    const orders = [
      makeMonthlyOrder({ id: 'o1', orderNumber: '#1', sourceIdentifier: 'dev-1-1000' }),
      makeMonthlyOrder({ id: 'o2', orderNumber: '#2', sourceIdentifier: 'dev-1-1001' }),
      makeMonthlyOrder({ id: 'o3', orderNumber: '#3', sourceIdentifier: 'dev-1-1002' }),
    ]
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', orders, 'tienda-ariat', EXPEDITION_PLACE)
    expect(payload.Items).toHaveLength(3)
    expect(payload.Items.map((it) => it.IdentificationNumber)).toEqual(['1-1000', '1-1001', '1-1002'])
  })

  it('IdentificationNumber usa la cola del recibo del sourceIdentifier (formato completo Shopify)', () => {
    const payload = buildGlobalCfdiPayload(
      PERIOD, 'credito',
      [makeMonthlyOrder({ sourceIdentifier: '87008247993-2-1266' })],
      'tienda-ariat', EXPEDITION_PLACE
    )
    expect(payload.Items[0].IdentificationNumber).toBe('2-1266')
  })

  it('sin sourceIdentifier → fallback a order.orderNumber', () => {
    const payload = buildGlobalCfdiPayload(
      PERIOD, 'credito',
      [makeMonthlyOrder({ orderNumber: '#9999', sourceIdentifier: null })],
      'tienda-ariat', EXPEDITION_PLACE
    )
    expect(payload.Items[0].IdentificationNumber).toBe('#9999')
  })

  it('Description === "Venta"', () => {
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)
    expect(payload.Items[0].Description).toBe('Venta')
  })

  it('cada item lleva Quantity "1" (un concepto por pedido, no por línea)', () => {
    const multiLineOrder = makeMonthlyOrder({
      lines: [
        { description: 'A', quantity: 2, unitPrice: 50, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'A' },
        { description: 'B', quantity: 3, unitPrice: 20, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'B' },
      ],
      total: 216,
      taxAmount: 216 * 0.16 / 1.16,
    })
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [multiLineOrder], 'tienda-ariat', EXPEDITION_PLACE)
    expect(payload.Items).toHaveLength(1)
    expect(payload.Items[0].Quantity).toBe('1')
  })
})

// ── ClaveProdServ/ClaveUnidad del GLOBAL — normativas y FIJAS (2026-07-10) ───
// Regla SAT 2.7.1.21: el CFDI global usa 01010101/ACT siempre, sin importar
// el default configurado para el individual. NO deben seguir las env
// FACTURAMA_DEFAULT_PRODUCT_CODE/FACTURAMA_DEFAULT_UNIT_CODE.
describe('buildGlobalCfdiPayload — ClaveProdServ/ClaveUnidad fijas (normativas)', () => {
  it('ProductCode === "01010101" y UnitCode === "ACT" (constantes de código, no env)', () => {
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)
    expect(payload.Items[0].ProductCode).toBe('01010101')
    expect(payload.Items[0].UnitCode).toBe('ACT')
    expect(payload.Items[0].Unit).toBe('Actividad')
  })

  it('IGNORA las env FACTURAMA_DEFAULT_PRODUCT_CODE/UNIT_CODE del flujo individual, aunque estén seteadas a otros valores', () => {
    const prevProd = process.env.FACTURAMA_DEFAULT_PRODUCT_CODE
    const prevUnit = process.env.FACTURAMA_DEFAULT_UNIT_CODE
    process.env.FACTURAMA_DEFAULT_PRODUCT_CODE = '53102500'
    process.env.FACTURAMA_DEFAULT_UNIT_CODE = 'H87'
    try {
      const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)
      expect(payload.Items[0].ProductCode).toBe('01010101')
      expect(payload.Items[0].UnitCode).toBe('ACT')
    } finally {
      if (prevProd === undefined) delete process.env.FACTURAMA_DEFAULT_PRODUCT_CODE
      else process.env.FACTURAMA_DEFAULT_PRODUCT_CODE = prevProd
      if (prevUnit === undefined) delete process.env.FACTURAMA_DEFAULT_UNIT_CODE
      else process.env.FACTURAMA_DEFAULT_UNIT_CODE = prevUnit
    }
  })
})

describe('buildGlobalCfdiPayload — desglose de IVA por pedido (delegado a FiscalCalculator)', () => {
  it('pedido gravado 16%: Taxes presente con Rate "0.16"', () => {
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder()], 'tienda-ariat', EXPEDITION_PLACE)
    const item = payload.Items[0]
    expect(item.TaxObject).toBe('02')
    expect(item.Taxes).toBeDefined()
    expect(item.Taxes![0].Rate).toBe('0.16')
  })

  it('Total del item ≈ order.total (sin envío)', () => {
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [makeMonthlyOrder({ total: 116 })], 'tienda-ariat', EXPEDITION_PLACE)
    expect(parseFloat(payload.Items[0].Total)).toBeCloseTo(116, 2)
  })

  it('pedido totalmente exento (taxObject 01): sin nodo Taxes', () => {
    const exemptOrder = makeMonthlyOrder({
      total: 100,
      taxAmount: 0,
      lines: [{ description: 'Exento', quantity: 1, unitPrice: 100, taxRate: 0, taxObject: '01', discount: 0, productCode: 'E1' }],
    })
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [exemptOrder], 'tienda-ariat', EXPEDITION_PLACE)
    const item = payload.Items[0]
    expect(item.TaxObject).toBe('01')
    expect(item.Taxes).toBeUndefined()
    expect(parseFloat(item.Total)).toBeCloseTo(parseFloat(item.Subtotal), 2)
  })

  it('pedido con descuento a nivel pedido: Discount > 0', () => {
    const discountedOrder = makeMonthlyOrder({
      total: 480,
      taxAmount: 66.21,
      discountAmount: 320,
      lines: [{ description: 'Sombrero', quantity: 1, unitPrice: 800, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'SKU-1' }],
    })
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', [discountedOrder], 'tienda-ariat', EXPEDITION_PLACE)
    const item = payload.Items[0]
    expect(item.Discount).toBeDefined()
    expect(parseFloat(item.Discount!)).toBeGreaterThan(0)
  })

  it('múltiples pedidos: la suma de Total de items ≈ suma de order.total y cumplen las 3 invariantes', () => {
    const orders = [
      makeMonthlyOrder({ id: 'o1', total: 116, taxAmount: 16 }),
      makeMonthlyOrder({
        id: 'o2', total: 480, taxAmount: 66.21, discountAmount: 320,
        lines: [{ description: 'X', quantity: 1, unitPrice: 800, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'X' }],
      }),
    ]
    const payload = buildGlobalCfdiPayload(PERIOD, 'credito', orders, 'tienda-ariat', EXPEDITION_PLACE)
    const sum = payload.Items.reduce((acc, it) => acc + parseFloat(it.Total), 0)
    expect(sum).toBeCloseTo(116 + 480, 0)
    assertItemIdentities(payload.Items)
  })
})
