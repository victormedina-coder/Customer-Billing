import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBrandConfig, listConfiguredBrands } from '../src/infrastructure/shopify/brands'

describe('Ariat OAuth configuration', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('loads client credentials from environment', () => {
    vi.stubEnv('ARIAT_SHOPIFY_STORE', 'ariat.myshopify.com')
    vi.stubEnv('ARIAT_SHOPIFY_CLIENT_ID', 'ariat-id')
    vi.stubEnv('ARIAT_SHOPIFY_CLIENT_SECRET', 'ariat-secret')

    expect(getBrandConfig('ariat')).toMatchObject({
      auth: 'oauth', storeDomain: 'ariat.myshopify.com',
      clientId: 'ariat-id', clientSecret: 'ariat-secret',
    })
  })

  it.each(['ARIAT_SHOPIFY_CLIENT_ID', 'ARIAT_SHOPIFY_CLIENT_SECRET'])(
    'rejects missing %s', (missing) => {
      vi.stubEnv('ARIAT_SHOPIFY_STORE', 'ariat.myshopify.com')
      vi.stubEnv('ARIAT_SHOPIFY_CLIENT_ID', 'ariat-id')
      vi.stubEnv('ARIAT_SHOPIFY_CLIENT_SECRET', 'ariat-secret')
      vi.stubEnv(missing, '')
      expect(() => getBrandConfig('ariat')).toThrow(/CLIENT_ID y\/o CLIENT_SECRET/)
      expect(listConfiguredBrands().some(({ key }) => key === 'ariat')).toBe(false)
    }
  )

  it('rejects a missing store domain', () => {
    vi.stubEnv('ARIAT_SHOPIFY_STORE', '')
    vi.stubEnv('ARIAT_SHOPIFY_CLIENT_ID', 'ariat-id')
    vi.stubEnv('ARIAT_SHOPIFY_CLIENT_SECRET', 'ariat-secret')
    expect(() => getBrandConfig('ariat')).toThrow(/STORE domain/)
    expect(listConfiguredBrands().some(({ key }) => key === 'ariat')).toBe(false)
  })
})
