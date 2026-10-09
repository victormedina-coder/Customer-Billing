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
      { facturamaId: 'f1', uuid: 'u1', correlationKey: 'GLB:h1', active: true, serieFolio: 'G-1', orderNumber: 'GLB:h1', rfc: undefined, total: undefined, date: '2026-10-08T13:07:33' },
      { facturamaId: 'f2', uuid: undefined, correlationKey: undefined, active: false, serieFolio: undefined, orderNumber: '#123', rfc: undefined, total: undefined, date: undefined },
    ])
  })
})
