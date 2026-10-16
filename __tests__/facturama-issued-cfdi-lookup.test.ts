import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacturamaIssuedCfdiLookup } from '../src/infrastructure/facturama/FacturamaIssuedCfdiLookup'
import { listarCfdisEmitidos } from '../src/infrastructure/facturama/facturamaClient'

vi.mock('../src/infrastructure/facturama/facturamaClient', () => ({ listarCfdisEmitidos: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('FacturamaIssuedCfdiLookup', () => {
  it('pasa la ventana amplia sin filtrar por Date y extrae solo llaves GLB', async () => {
    vi.mocked(listarCfdisEmitidos).mockResolvedValue([
      { Id: 'f1', Uuid: 'u1', OrderNumber: 'GLB:h1', Status: 'active', IsActive: true, Serie: 'G', Folio: '1', Date: '2026-10-08T13:07:33' },
      { Id: 'f2', OrderNumber: '#123', Status: 'canceled', IsActive: false },
    ])
    const from = new Date('2026-10-07T00:00:00Z')
    const to = new Date('2026-10-09T00:00:00Z')
    const result = await new FacturamaIssuedCfdiLookup().listIssuedBetween(from, to)
    expect(listarCfdisEmitidos).toHaveBeenCalledWith({ from, to })
    expect(result).toEqual([
      { facturamaId: 'f1', uuid: 'u1', correlationKey: 'GLB:h1', active: true, serie: 'G', serieFolio: 'G-1', orderNumber: 'GLB:h1', rfc: undefined, total: undefined, date: '2026-10-08T13:07:33' },
      { facturamaId: 'f2', uuid: undefined, correlationKey: undefined, active: false, serie: undefined, serieFolio: undefined, orderNumber: '#123', rfc: undefined, total: undefined, date: undefined },
    ])
  })

  it('conserva la Serie cruda y el formato previo de serieFolio', async () => {
    vi.mocked(listarCfdisEmitidos).mockResolvedValue([
      { Id: 'lower', Serie: 'gdl1', Folio: '45' },
      { Id: 'upper', Serie: 'GDL1', Folio: '46' },
    ])
    const result = await new FacturamaIssuedCfdiLookup().listIssuedBetween(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-11-01T00:00:00Z'),
    )
    expect(result.map(({ serie, serieFolio }) => ({ serie, serieFolio }))).toEqual([
      { serie: 'gdl1', serieFolio: 'gdl1-45' },
      { serie: 'GDL1', serieFolio: 'GDL1-46' },
    ])
  })
})
