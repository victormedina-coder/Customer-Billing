import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeEmitGlobalInvoiceUseCase, getGlobalsCheckBudgetMs } from '../src/composition/makeEmitGlobalInvoiceUseCase'
import type { EmitGlobalInvoiceDeps } from '../src/application/global/EmitGlobalInvoiceUseCase'
import { FacturamaIssuedCfdiLookup } from '../src/infrastructure/facturama/FacturamaIssuedCfdiLookup'

vi.mock('../src/infrastructure/shopify/brands', () => ({
  listConfiguredBrands: () => [{ key: 'stetson' }, { key: 'western-brothers' }],
}))
vi.mock('../src/infrastructure/facturama/brandSerie', () => ({
  resolveSerie: (store: string) => store === 'stetson' ? 'STET' : 'WB',
}))

afterEach(() => vi.unstubAllEnvs())

describe('GLOBAL_FACTURAMA_GLOBALS_CHECK composition', () => {
  const depsOf = (): EmitGlobalInvoiceDeps => (makeEmitGlobalInvoiceUseCase() as unknown as { deps: EmitGlobalInvoiceDeps }).deps

  it('cablea el lookup y las series por defecto', () => {
    vi.stubEnv('GLOBAL_FACTURAMA_GLOBALS_CHECK', '')
    const check = depsOf().periodGlobalsCheck
    expect(check?.issuedCfdiLookup).toBeInstanceOf(FacturamaIssuedCfdiLookup)
    expect(check?.seriesByStore).toEqual({ stetson: 'STET', 'western-brothers': 'WB' })
    expect(check?.budgetMs).toBe(60000)
  })

  it('omite la dependencia cuando está off', () => {
    vi.stubEnv('GLOBAL_FACTURAMA_GLOBALS_CHECK', 'off')
    expect(depsOf().periodGlobalsCheck).toBeUndefined()
  })

  it('acepta solo un presupuesto entero positivo', () => {
    vi.stubEnv('GLOBAL_FACTURAMA_CHECK_BUDGET_MS', '1')
    expect(getGlobalsCheckBudgetMs()).toBe(1)
    vi.stubEnv('GLOBAL_FACTURAMA_CHECK_BUDGET_MS', '1.5')
    expect(getGlobalsCheckBudgetMs()).toBe(60000)
    vi.stubEnv('GLOBAL_FACTURAMA_CHECK_BUDGET_MS', '0')
    expect(getGlobalsCheckBudgetMs()).toBe(60000)
  })
})
