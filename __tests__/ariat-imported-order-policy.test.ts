import { describe, expect, it } from 'vitest'
import {
  ARIAT_IMPORT_CUTOFF,
  importedPosTicket,
} from '../src/domain/global/AriatImportedOrderPolicy'

describe('importedPosTicket — importados de Ariat posteriores al corte', () => {
  it('usa el Ticket como identificador POS desde el corte (31-oct 21:00 MX)', () => {
    expect(ARIAT_IMPORT_CUTOFF).toBe('2026-11-01T03:00:00.000Z')
    expect(importedPosTicket('ariat', 'pos-ariat-int', '2026-11-01T03:00:00.000Z', '7-27985')).toBe('7-27985')
    expect(importedPosTicket('ariat', 'pos-ariat-int', '2026-11-03T20:00:00Z', ' 15-6190 ')).toBe('15-6190')
  })

  it('descarta importados anteriores al corte (ya facturados desde la tienda vieja)', () => {
    expect(importedPosTicket('ariat', 'pos-ariat-int', '2026-11-01T02:59:59.000Z', '7-27985')).toBeNull()
  })

  it('no toca pedidos nativos ni otras marcas', () => {
    expect(importedPosTicket('ariat', 'pos', '2026-11-05T00:00:00Z', '7-27985')).toBeNull()
    expect(importedPosTicket('stetson', 'pos-ariat-int', '2026-11-05T00:00:00Z', '7-27985')).toBeNull()
  })

  it('sin Ticket, con formato inválido o fecha inválida → null (el pedido sigue fuera como no-POS)', () => {
    expect(importedPosTicket('ariat', 'pos-ariat-int', '2026-11-05T00:00:00Z', undefined)).toBeNull()
    expect(importedPosTicket('ariat', 'pos-ariat-int', '2026-11-05T00:00:00Z', 'AR-123')).toBeNull()
    expect(importedPosTicket('ariat', 'pos-ariat-int', 'no-es-fecha', '7-27985')).toBeNull()
  })
})
