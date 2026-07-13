import { describe, it, expect } from 'vitest'
import { mapRowToGlobalInvoice, type GlobalInvoiceRow } from '../src/infrastructure/db/DrizzleGlobalInvoiceRepository'

// mapRowToGlobalInvoice es pura (sin I/O) — se testea sin DB, mockeando la
// fila cruda tal como la devolvería Drizzle.

function makeRow(overrides: Partial<GlobalInvoiceRow> = {}): GlobalInvoiceRow {
  return {
    id: overrides.id ?? 'global-invoice-id-1',
    storeName: overrides.storeName ?? 'tienda-ariat',
    periodYear: overrides.periodYear ?? 2026,
    periodMonth: overrides.periodMonth ?? 6,
    paymentBucket: overrides.paymentBucket ?? 'debito',
    chunkIndex: overrides.chunkIndex ?? 0,
    facturamaId: overrides.facturamaId !== undefined ? overrides.facturamaId : null,
    uuidCfdi: overrides.uuidCfdi !== undefined ? overrides.uuidCfdi : null,
    status: overrides.status ?? 'pending',
    itemCount: overrides.itemCount ?? 0,
    createdAt: overrides.createdAt ?? new Date('2026-06-01T00:00:00Z'),
  }
}

describe('mapRowToGlobalInvoice', () => {
  it('mapea todos los campos de identidad + estado de una fila pending', () => {
    const row = makeRow()
    const invoice = mapRowToGlobalInvoice(row)

    expect(invoice).toEqual({
      id: 'global-invoice-id-1',
      storeName: 'tienda-ariat',
      periodYear: 2026,
      periodMonth: 6,
      paymentBucket: 'debito',
      chunkIndex: 0,
      status: 'pending',
      facturamaId: null,
      uuidCfdi: null,
      itemCount: 0,
    })
  })

  it('mapea una fila emitted con facturamaId/uuidCfdi/itemCount poblados', () => {
    const row = makeRow({
      status: 'emitted',
      facturamaId: 'GF-001',
      uuidCfdi: 'uuid-abc',
      itemCount: 37,
      paymentBucket: 'efectivo',
      chunkIndex: 2,
    })
    const invoice = mapRowToGlobalInvoice(row)

    expect(invoice.status).toBe('emitted')
    expect(invoice.facturamaId).toBe('GF-001')
    expect(invoice.uuidCfdi).toBe('uuid-abc')
    expect(invoice.itemCount).toBe(37)
    expect(invoice.paymentBucket).toBe('efectivo')
    expect(invoice.chunkIndex).toBe(2)
  })

  it('no incluye createdAt en el agregado de dominio (no forma parte de GlobalInvoice)', () => {
    const invoice = mapRowToGlobalInvoice(makeRow())
    expect('createdAt' in invoice).toBe(false)
  })
})
