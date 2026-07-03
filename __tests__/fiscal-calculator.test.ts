/**
 * Tests de caracterización para FiscalCalculator.
 *
 * Fijan los valores numéricos exactos que produce el domain service en casos
 * representativos, incluyendo el caso con cent-fix activo. Esto protege la
 * identidad numérica si el builder o la serialización cambian en el futuro.
 *
 * NO reemplaza a cfdi-mapper.test.ts (que verifica la salida Facturama completa);
 * este archivo verifica los números puros del dominio.
 */

import { describe, it, expect } from 'vitest'
import { FiscalCalculator } from '../src/domain/fiscal/FiscalCalculator'
import type { Order } from '../src/domain/orders/Order'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function makeOrder(overrides: Partial<Order> = {}): Order {
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
    ...overrides,
  }
}

// ── Caso 1: línea única sin descuento, IVA inclusivo ─────────────────────────
describe('FiscalCalculator — línea única sin descuento, IVA inclusivo', () => {
  const order = makeOrder({
    total: 116,
    shippingAmount: 0,
    lines: [
      { description: 'Sombrero', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'SKU-001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('totales.total === 116', () => expect(bd.totales.total).toBe(116))
  it('totales.iva ≈ 16', () => expect(bd.totales.iva).toBeCloseTo(16, 2))
  it('totales.subtotalSinIVA ≈ 100', () => expect(bd.totales.subtotalSinIVA).toBeCloseTo(100, 2))
  it('totales.descuento === 0', () => expect(bd.totales.descuento).toBe(0))

  it('porLinea tiene 1 elemento', () => expect(bd.porLinea).toHaveLength(1))
  it('línea 0: total === 116', () => expect(bd.porLinea[0].total).toBe(116))
  it('línea 0: hasDiscount === false', () => expect(bd.porLinea[0].hasDiscount).toBe(false))
  it('línea 0: invariante subtotal === round2(unitPriceSinIva × qty)', () => {
    const l = bd.porLinea[0]
    expect(round2(l.unitPriceSinIva * l.quantity)).toBeCloseTo(l.subtotal, 2)
  })
  it('línea 0: invariante base === subtotal − discount', () => {
    const l = bd.porLinea[0]
    expect(round2(l.subtotal - l.discount)).toBeCloseTo(l.base, 2)
  })
  it('línea 0: invariante total === base + iva', () => {
    const l = bd.porLinea[0]
    expect(round2(l.base + l.iva)).toBeCloseTo(l.total, 2)
  })
})

// ── Caso 2: descuento a nivel pedido (caso 5-1086) ───────────────────────────
describe('FiscalCalculator — línea única con descuento a nivel pedido (5-1086)', () => {
  const order = makeOrder({
    total: 480,
    shippingAmount: 0,
    lines: [
      { description: 'Sombrero Test', quantity: 1, unitPrice: 800, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'SKU-001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('totales.total ≈ 480', () => expect(bd.totales.total).toBeCloseTo(480, 1))
  it('línea 0: total ≈ 480', () => expect(bd.porLinea[0].total).toBeCloseTo(480, 1))
  it('línea 0: discount > 0', () => expect(bd.porLinea[0].discount).toBeGreaterThan(0))
  it('línea 0: hasDiscount === true', () => expect(bd.porLinea[0].hasDiscount).toBe(true))
  it('línea 0: invariante base === subtotal − discount', () => {
    const l = bd.porLinea[0]
    expect(round2(l.subtotal - l.discount)).toBeCloseTo(l.base, 2)
  })
})

// ── Caso 3: multi-línea con cent-fix activo ───────────────────────────────────
// Mismo caso que el Test 7 de cfdi-mapper.test.ts para poder comparar números.
describe('FiscalCalculator — cent-fix en último item CON descuento (C1 regression)', () => {
  const order = makeOrder({
    total: 762.00,
    shippingAmount: 0,
    lines: [
      { description: 'Producto A', quantity: 3,  unitPrice: 99.99, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'A001' },
      { description: 'Producto B', quantity: 7,  unitPrice: 31.43, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'B001' },
      { description: 'Producto C', quantity: 4,  unitPrice: 74.95, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'C001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('porLinea tiene 3 elementos', () => expect(bd.porLinea).toHaveLength(3))

  it('totales.total === 762 (post cent-fix)', () => {
    expect(Math.abs(bd.totales.total - 762.00)).toBeLessThanOrEqual(0.02)
  })

  it('Σ porLinea.total === totales.total', () => {
    const sum = round2(bd.porLinea.reduce((acc, l) => acc + l.total, 0))
    expect(sum).toBeCloseTo(bd.totales.total, 2)
  })

  it('el último item tiene discount > 0 (cent-fix conservó el descuento)', () => {
    const last = bd.porLinea[bd.porLinea.length - 1]
    expect(last.discount).toBeGreaterThan(0)
    expect(last.hasDiscount).toBe(true)
  })

  it('invariante base === subtotal − discount en TODOS los items', () => {
    for (const l of bd.porLinea) {
      expect(round2(l.subtotal - l.discount)).toBeCloseTo(l.base, 2)
    }
  })

  it('invariante total === base + iva en TODOS los items', () => {
    for (const l of bd.porLinea) {
      expect(round2(l.base + l.iva)).toBeCloseTo(l.total, 2)
    }
  })

  it('invariante subtotal === round2(unitPriceSinIva × qty) en TODOS los items', () => {
    for (const l of bd.porLinea) {
      expect(round2(l.unitPriceSinIva * l.quantity)).toBeCloseTo(l.subtotal, 2)
    }
  })
})

// ── Caso 4: multi-línea sin descuento ────────────────────────────────────────
describe('FiscalCalculator — multi-línea sin descuento', () => {
  const order = makeOrder({
    total: 232,
    shippingAmount: 0,
    lines: [
      { description: 'Sombrero A', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'A001' },
      { description: 'Sombrero B', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'B001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('totales.total ≈ 232', () => expect(bd.totales.total).toBeCloseTo(232, 1))
  it('ningún item tiene discount', () => {
    for (const l of bd.porLinea) expect(l.hasDiscount).toBe(false)
  })
  it('invariantes en todos los items', () => {
    for (const l of bd.porLinea) {
      expect(round2(l.base + l.iva)).toBeCloseTo(l.total, 2)
      expect(round2(l.subtotal - l.discount)).toBeCloseTo(l.base, 2)
      expect(round2(l.unitPriceSinIva * l.quantity)).toBeCloseTo(l.subtotal, 2)
    }
  })
})

// ── Caso 5: línea con tasa 0% (tasa cero real, gravada) ──────────────────────
describe('FiscalCalculator — línea con tasa 0% (tasa cero, gravada)', () => {
  const order = makeOrder({
    total: 100,
    shippingAmount: 0,
    lines: [
      { description: 'Producto tasa 0', quantity: 1, unitPrice: 100, taxRate: 0, taxObject: '02', discount: 0, productCode: 'Z001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('iva === 0', () => expect(bd.porLinea[0].iva).toBe(0))
  it('subtotal === 100 (no se divide entre 1+tasa)', () => expect(bd.porLinea[0].subtotal).toBe(100))
  it('base === 100', () => expect(bd.porLinea[0].base).toBe(100))
  it('total === 100', () => expect(bd.porLinea[0].total).toBe(100))
})

// ── Caso 6: línea exenta (taxObject '01', sin taxLines) ──────────────────────
describe('FiscalCalculator — línea exenta (taxObject 01)', () => {
  const order = makeOrder({
    total: 100,
    shippingAmount: 0,
    lines: [
      { description: 'Producto exento', quantity: 1, unitPrice: 100, taxRate: 0, taxObject: '01', discount: 0, productCode: 'E001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('iva === 0', () => expect(bd.porLinea[0].iva).toBe(0))
  it('base === subtotal - discount', () => {
    const l = bd.porLinea[0]
    expect(round2(l.subtotal - l.discount)).toBeCloseTo(l.base, 2)
  })
  it('total === base (sin IVA que sumar)', () => {
    const l = bd.porLinea[0]
    expect(l.total).toBeCloseTo(l.base, 2)
  })
})

// ── Caso 7: mezcla de tasas (gravado 16%, tasa 0%, exento) ───────────────────
describe('FiscalCalculator — mezcla de tasas en el mismo pedido', () => {
  const order = makeOrder({
    total: 216,
    shippingAmount: 0,
    lines: [
      { description: 'Gravado 16%', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'G001' },
      { description: 'Tasa 0%',     quantity: 1, unitPrice: 50,  taxRate: 0,    taxObject: '02', discount: 0, productCode: 'Z001' },
      { description: 'Exento',      quantity: 1, unitPrice: 50,  taxRate: 0,    taxObject: '01', discount: 0, productCode: 'E001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('línea gravada: iva ≈ 16', () => expect(bd.porLinea[0].iva).toBeCloseTo(16, 2))
  it('línea tasa 0: iva === 0', () => expect(bd.porLinea[1].iva).toBe(0))
  it('línea exenta: iva === 0', () => expect(bd.porLinea[2].iva).toBe(0))
  it('Σ porLinea.total ≈ totales.total', () => {
    const sum = round2(bd.porLinea.reduce((acc, l) => acc + l.total, 0))
    expect(sum).toBeCloseTo(bd.totales.total, 2)
  })
})

// ── Caso 8: cent-fix con último item exento ───────────────────────────────────
describe('FiscalCalculator — cent-fix con último item exento', () => {
  const order = makeOrder({
    total: 262.00,
    shippingAmount: 0,
    lines: [
      { description: 'Producto A', quantity: 3, unitPrice: 39.99, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'A001' },
      { description: 'Producto B (exento)', quantity: 4, unitPrice: 34.95, taxRate: 0, taxObject: '01', discount: 0, productCode: 'B001' },
    ],
  })
  const bd = FiscalCalculator.compute(order)

  it('último item (exento): iva === 0 tras el cent-fix', () => {
    const last = bd.porLinea[bd.porLinea.length - 1]
    expect(last.iva).toBe(0)
  })
  it('último item (exento): base === total tras el cent-fix', () => {
    const last = bd.porLinea[bd.porLinea.length - 1]
    expect(last.base).toBeCloseTo(last.total, 2)
  })
  it('Σ porLinea.total === totales.total (cent-fix cierra)', () => {
    const sum = round2(bd.porLinea.reduce((acc, l) => acc + l.total, 0))
    expect(sum).toBeCloseTo(bd.totales.total, 2)
  })
  it('invariante base === subtotal − discount se conserva', () => {
    const last = bd.porLinea[bd.porLinea.length - 1]
    expect(round2(last.subtotal - last.discount)).toBeCloseTo(last.base, 2)
  })
})
