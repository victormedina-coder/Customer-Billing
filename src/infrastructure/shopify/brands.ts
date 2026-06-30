/**
 * Configuración de marcas Shopify — adapter de infraestructura.
 * Contenido movido de lib/shopify/brands.ts sin cambiar comportamiento.
 * El puente en lib/shopify/brands.ts re-exporta desde aquí.
 */

export type BrandKey = 'ariat' | 'stetson' | 'western-brothers'

export interface BrandConfig {
  key: BrandKey
  label: string
  storeDomain: string
  auth: 'static' | 'oauth'
  token?: string
  clientId?: string
  clientSecret?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Versión de API de Shopify Admin
// ─────────────────────────────────────────────────────────────────────────────
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2025-07'

export function shopifyGraphQLUrl(storeDomain: string): string {
  return `https://${storeDomain}/admin/api/${API_VERSION}/graphql.json`
}

export function shopifyTokenUrl(storeDomain: string): string {
  return `https://${storeDomain}/admin/oauth/access_token`
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de env + construcción de configs
// ─────────────────────────────────────────────────────────────────────────────

function loadBrandConfigs(): Record<BrandKey, BrandConfig> {
  return {
    ariat: {
      key: 'ariat',
      label: 'Ariat',
      storeDomain: process.env.ARIAT_SHOPIFY_STORE ?? '',
      auth: 'static',
      token: process.env.ARIAT_SHOPIFY_ACCESS_TOKEN ?? '',
    },
    stetson: {
      key: 'stetson',
      label: 'Stetson',
      storeDomain: process.env.STETSON_SHOPIFY_STORE ?? '',
      auth: 'oauth',
      clientId: process.env.STETSON_SHOPIFY_CLIENT_ID ?? '',
      clientSecret: process.env.STETSON_SHOPIFY_CLIENT_SECRET ?? '',
    },
    'western-brothers': {
      key: 'western-brothers',
      label: 'Western Brothers',
      storeDomain: process.env.WB_SHOPIFY_STORE ?? '',
      auth: 'oauth',
      clientId: process.env.WB_SHOPIFY_CLIENT_ID ?? '',
      clientSecret: process.env.WB_SHOPIFY_CLIENT_SECRET ?? '',
    },
  }
}

function validateBrandConfig(cfg: BrandConfig): void {
  if (!cfg.storeDomain) {
    throw new Error(`[shopify] Falta STORE domain para la marca '${cfg.key}'.`)
  }
  if (cfg.auth === 'static') {
    if (!cfg.token) {
      throw new Error(
        `[shopify] Falta ACCESS_TOKEN estático (shpat_…) para la marca '${cfg.key}'.`
      )
    }
  } else {
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error(
        `[shopify] Faltan CLIENT_ID y/o CLIENT_SECRET OAuth para la marca '${cfg.key}'.`
      )
    }
  }
}

function isBrandConfigured(cfg: BrandConfig): boolean {
  if (!cfg.storeDomain) return false
  if (cfg.auth === 'static') return Boolean(cfg.token)
  return Boolean(cfg.clientId && cfg.clientSecret)
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

export function getBrandConfig(key: BrandKey): BrandConfig {
  const configs = loadBrandConfigs()
  const cfg = configs[key]
  if (!cfg) throw new Error(`[shopify] Marca no reconocida: '${key}'.`)
  validateBrandConfig(cfg)
  return cfg
}

export function listBrands(): BrandConfig[] {
  return Object.values(loadBrandConfigs())
}

export function listConfiguredBrands(): BrandConfig[] {
  return Object.values(loadBrandConfigs()).filter(isBrandConfigured)
}
