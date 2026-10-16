import { describe, expect, it, vi } from 'vitest'
import { ReconcileGlobalStampsUseCase } from '../src/application/global/ReconcileGlobalStampsUseCase'
import type { ReconciliationHeader } from '../src/domain/global/ports/GlobalInvoiceRepository'
import type { IssuedCfdiRef } from '../src/domain/global/ports/IssuedCfdiLookup'

const old = new Date('2026-10-08T16:00:00.000Z')
const now = new Date('2026-10-08T18:00:00.000Z')
const header: ReconciliationHeader = {
  id: 'h1', storeName: 'ariat', periodYear: 2026, periodMonth: 9,
  paymentBucket: 'debito', chunkIndex: 0, status: 'stamped_unconfirmed',
  createdAt: old, correlationKey: 'GLB:h1', facturamaId: null, uuidCfdi: null,
}
const match: IssuedCfdiRef = { facturamaId: 'f1', uuid: 'u1', correlationKey: 'GLB:h1', active: true }

function fixture(headers: ReconciliationHeader[], items: IssuedCfdiRef[], emitted: string[] = []) {
  const repo = {
    listForReconciliation: vi.fn().mockResolvedValue(headers),
    listAllGlobalFacturamaIds: vi.fn().mockResolvedValue([]),
    listEmittedHeaderIds: vi.fn().mockResolvedValue([]),
    listEmittedFacturamaIdsBetween: vi.fn().mockResolvedValue(emitted),
    releaseHeader: vi.fn().mockResolvedValue(undefined),
    confirmHeader: vi.fn().mockResolvedValue(undefined),
  }
  const lookup = { listIssuedBetween: vi.fn().mockResolvedValue(items) }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const useCase = new ReconcileGlobalStampsUseCase({ repo, lookup, logger, minAgeMinutes: 60, now: () => now })
  return { repo, lookup, logger, useCase }
}

describe('ReconcileGlobalStampsUseCase', () => {
  it('confirma con los ids del CFDI activo', async () => {
    const { useCase, repo } = fixture([header], [match])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(repo.confirmHeader).toHaveBeenCalledWith('h1', { facturamaId: 'f1', uuidCfdi: 'u1' })
    expect(report.counts.confirm).toBe(1)
  })

  it('libera reserva vieja sin CFDI cuando el listado está sano', async () => {
    const { useCase, repo } = fixture([header], [{ facturamaId: 'other', active: true, rfc: 'AAA010101AAA' }])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(repo.releaseHeader).toHaveBeenCalledWith('h1')
    expect(report.counts.release).toBe(1)
  })

  it('dry run reporta sin escribir', async () => {
    const { useCase, repo } = fixture([header], [match])
    const report = await useCase.execute({ runId: 'run', apply: false })
    expect(report.counts.confirm).toBe(1)
    expect(repo.confirmHeader).not.toHaveBeenCalled()
    expect(repo.releaseHeader).not.toHaveBeenCalled()
  })

  it('error del listado deja todos en wait y no lanza', async () => {
    const { useCase, lookup, repo, logger } = fixture([header], [])
    lookup.listIssuedBetween.mockRejectedValue(new Error('Facturama no responde'))
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.counts.wait).toBe(1)
    expect(repo.releaseHeader).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it('sin headers no consulta Facturama', async () => {
    const { useCase, lookup } = fixture([], [])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.decisions).toEqual([])
    expect(lookup.listIssuedBetween).not.toHaveBeenCalled()
  })

  it('canario emitido ausente impide liberar', async () => {
    const { useCase, repo } = fixture([header], [{ facturamaId: 'other', active: true, rfc: 'AAA010101AAA' }], ['missing'])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.decisions[0].decision).toBe('wait')
    expect(repo.releaseHeader).not.toHaveBeenCalled()
  })

  it('lápida sin timbrado tardío no produce espera operativa', async () => {
    const { useCase } = fixture([{ ...header, status: 'released' }], [{ facturamaId: 'other', active: true }])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.decisions).toEqual([])
    expect(report.counts.wait).toBe(0)
  })

  it('global ajena veta release pero permite confirmación', async () => {
    const pending = { ...header, id: 'h2', status: 'pending' as const, correlationKey: 'GLB:h2' }
    const { useCase, repo, logger } = fixture([header, pending], [match, { facturamaId: 'manual', active: true, rfc: 'XAXX010101000', total: 100, date: '2026-10-08' }])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(repo.confirmHeader).toHaveBeenCalledOnce()
    expect(repo.releaseHeader).not.toHaveBeenCalled()
    expect(report.unexplainedGlobals).toHaveLength(1)
    expect(report.decisions.find(item => item.headerId === 'h2')?.reason).toContain('Global ajena')
    expect(logger.error).toHaveBeenCalled()
  })

  it('fallo de escritura marca la corrida como fallida', async () => {
    const { useCase, repo } = fixture([{ ...header, status: 'pending' }], [{ facturamaId: 'other', active: true, rfc: 'AAA010101AAA' }])
    repo.releaseHeader.mockRejectedValue(new Error('DB caída'))
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.failed).toBe(true)
  })

  it('sin headers consulta una vez para conteo del periodo cuando se solicita', async () => {
    const { useCase, lookup } = fixture([], [{ facturamaId: 'manual', active: true, rfc: 'XAXX010101000' }])
    const report = await useCase.execute({ runId: 'run', apply: true, period: { year: 2026, month: 10 } })
    expect(lookup.listIssuedBetween).toHaveBeenCalledOnce()
    expect(report.unexplainedGlobals).toHaveLength(1)
    expect(report.unexplainedGlobalsInPeriod).toBe(1)
  })

  it('llave GLB huérfana veta la liberación y genera alerta', async () => {
    const { useCase, repo, logger } = fixture([header], [{ facturamaId: 'orphan', active: true, rfc: 'XAXX010101000', orderNumber: ' GLB:deleted ' }])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.unexplainedGlobals).toHaveLength(1)
    expect(repo.releaseHeader).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ facturamaId: 'orphan' }), expect.stringContaining('Llave GLB huérfana'))
  })

  it('llave conocida con espacios y distinta capitalización confirma', async () => {
    const { useCase, repo } = fixture([header], [{ ...match, correlationKey: ' glb:H1 ', orderNumber: ' glb:H1 ', rfc: 'XAXX010101000' }])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.counts.confirm).toBe(1)
    expect(repo.confirmHeader).toHaveBeenCalledOnce()
  })

  it('header con facturamaId confirma aunque el CFDI antiguo no tenga llave', async () => {
    const { useCase, repo } = fixture([{ ...header, facturamaId: 'f1' }], [{ ...match, correlationKey: undefined, rfc: 'XAXX010101000' }])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.counts.confirm).toBe(1)
    expect(repo.releaseHeader).not.toHaveBeenCalled()
  })

  it('prioriza el CFDI con facturamaId guardado si otro comparte la llave', async () => {
    const other = { ...match, facturamaId: 'other', uuid: 'other-uuid' }
    const known = { ...match, correlationKey: undefined, uuid: 'known-uuid' }
    const { useCase, repo } = fixture([{ ...header, facturamaId: 'f1' }], [other, known])
    await useCase.execute({ runId: 'run', apply: true })
    expect(repo.confirmHeader).toHaveBeenCalledWith('h1', { facturamaId: 'f1', uuidCfdi: 'known-uuid' })
  })

  it('listado sin Rfc impide liberar y registra fallo del veto', async () => {
    const { useCase, repo, logger } = fixture([header], [{ facturamaId: 'other', active: true }])
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.counts.wait).toBe(1)
    expect(repo.releaseHeader).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ itemCount: 1 }), expect.stringContaining('Listado sin Rfc'))
  })

  it('release concurrente ya aplicado no falla la corrida', async () => {
    const { useCase, repo } = fixture([{ ...header, status: 'pending' }], [{ facturamaId: 'other', active: true, rfc: 'AAA010101AAA' }])
    repo.releaseHeader.mockResolvedValue('already_applied')
    const report = await useCase.execute({ runId: 'run', apply: true })
    expect(report.failed).not.toBe(true)
    expect(report.decisions[0].reason).toContain('ya aplicada')
  })
})
