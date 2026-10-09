import { describe, expect, it } from 'vitest'
import { decideReconciliation } from '../src/domain/global/decideReconciliation'
import type { ReconciliationHeader } from '../src/domain/global/ports/GlobalInvoiceRepository'
import type { IssuedCfdiRef } from '../src/domain/global/ports/IssuedCfdiLookup'

const now = new Date('2026-10-08T18:00:00.000Z')
const old = new Date('2026-10-08T16:00:00.000Z')
const recent = new Date('2026-10-08T17:30:00.000Z')
const header: ReconciliationHeader = {
  id: 'header-1', storeName: 'ariat', periodYear: 2026, periodMonth: 9,
  paymentBucket: 'debito', chunkIndex: 0, status: 'stamped_unconfirmed',
  createdAt: old, correlationKey: 'GLB:header-1', facturamaId: null, uuidCfdi: null,
}
const active: IssuedCfdiRef = { facturamaId: 'f1', correlationKey: 'GLB:header-1', active: true, uuid: 'u1' }
const cancelled: IssuedCfdiRef = { ...active, active: false }
const ctx = { now, minAgeMinutes: 60, listingHealthy: true, unexplainedGlobals: 0 }

describe('decideReconciliation', () => {
  it.each([
    ['pending viejo', { ...header, status: 'pending' }, [], ctx, 'release'],
    ['pending reciente', { ...header, status: 'pending', createdAt: recent }, [], ctx, 'wait'],
    ['uno activo', header, [active], ctx, 'confirm'],
    ['dos activos', header, [active, { ...active, facturamaId: 'f2' }], ctx, 'alert_duplicate'],
    ['cancelado', header, [cancelled], ctx, 'alert_cancelled'],
    ['ninguno sano', header, [], ctx, 'release'],
    ['ninguno listado no sano', header, [], { ...ctx, listingHealthy: false }, 'wait'],
    ['ninguno reciente', { ...header, createdAt: recent }, [], ctx, 'wait'],
    ['veto bloquea liberación', header, [], { ...ctx, unexplainedGlobals: 1 }, 'wait'],
    ['veto permite confirmar', header, [active], { ...ctx, unexplainedGlobals: 1 }, 'confirm'],
    ['released con timbrado tardío', { ...header, status: 'released' }, [active], ctx, 'alert_late_stamp'],
    ['released sin match', { ...header, status: 'released' }, [], ctx, 'wait'],
    ['pending con CFDI activo', { ...header, status: 'pending' }, [active], ctx, 'alert_duplicate'],
    ['pending con listado incompleto', { ...header, status: 'pending' }, [], { ...ctx, listingHealthy: false }, 'wait'],
    ['id conocido activo sin llave', { ...header, facturamaId: 'f1' }, [{ ...active, correlationKey: undefined }], ctx, 'confirm'],
    ['id conocido cancelado sin llave', { ...header, facturamaId: 'f1' }, [{ ...cancelled, correlationKey: undefined }], ctx, 'alert_cancelled'],
    ['id conocido ausente', { ...header, facturamaId: 'f1' }, [], ctx, 'wait'],
  ] as const)('%s', (_label, candidate, matches, context, expected) => {
    expect(decideReconciliation(candidate as ReconciliationHeader, [...matches], context).decision).toBe(expected)
  })
})
