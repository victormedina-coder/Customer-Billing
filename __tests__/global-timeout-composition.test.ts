import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFacturamaGlobalTimeoutMs, getOrderCheckBudgetMs } from '../src/composition/makeEmitGlobalInvoiceUseCase'

afterEach(() => vi.unstubAllEnvs())

describe('GLOBAL_ORDER_CHECK_BUDGET_MS', () => {
  it('uses 30000 by default and accepts only positive integers', () => {
    vi.stubEnv('GLOBAL_ORDER_CHECK_BUDGET_MS', '')
    expect(getOrderCheckBudgetMs()).toBe(30000)
    vi.stubEnv('GLOBAL_ORDER_CHECK_BUDGET_MS', 'invalid')
    expect(getOrderCheckBudgetMs()).toBe(30000)
    vi.stubEnv('GLOBAL_ORDER_CHECK_BUDGET_MS', '2500')
    expect(getOrderCheckBudgetMs()).toBe(2500)
  })
})

describe('FACTURAMA_GLOBAL_TIMEOUT_MS', () => {
  it('usa 120000 cuando está ausente', () => {
    vi.stubEnv('FACTURAMA_GLOBAL_TIMEOUT_MS', '')
    expect(getFacturamaGlobalTimeoutMs()).toBe(120000)
  })

  it.each(['abc', '0', '-5', '1.5'])('usa 120000 si el valor %s es inválido', (raw) => {
    vi.stubEnv('FACTURAMA_GLOBAL_TIMEOUT_MS', raw)
    expect(getFacturamaGlobalTimeoutMs()).toBe(120000)
  })

  it('acepta un entero positivo', () => {
    vi.stubEnv('FACTURAMA_GLOBAL_TIMEOUT_MS', '90000')
    expect(getFacturamaGlobalTimeoutMs()).toBe(90000)
  })
})
