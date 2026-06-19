/**
 * Configuración de marcas Shopify para el portal de autofacturación.
 *
 * Modo de auth por marca:
 *   - 'static'  → token directo shpat_…  (caso Ariat)
 *   - 'oauth'   → client_credentials flow (caso Stetson, WB)
 *
 * NOTA: El ruteo por prefijo de folio fue eliminado.
 * El prefijo de folio es por sucursal (location dentro de Shopify), NO por marca,
 * por lo que no sirve para determinar a cuál de las 3 tiendas Shopify consultar.
 * La búsqueda usa fan-out paralelo sobre todas las marcas configuradas.
 */

export type BrandKey = 'ariat' | 'stetson' | 'western-brothers'

export interface BrandConfig {
  key: BrandKey
  label: string
  storeDomain: string       // ej. "mi-tienda.myshopify.com"
  auth: 'static' | 'oauth'
  // static auth
  token?: string            // shpat_… — solo cuando auth === 'static'
  // oauth auth
  clientId?: string
  clientSecret?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Versión de API de Shopify Admin
// ─────────────────────────────────────────────────────────────────────────────
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2025-07'

/** Construye la URL del endpoint GraphQL de Admin API para una tienda. */
export function shopifyGraphQLUrl(storeDomain: string): string {
  return `https://${storeDomain}/admin/api/${API_VERSION}/graphql.json`
}

/** Construye la URL de OAuth token para una tienda. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Validación de credenciales (fail-fast al momento de usar la config)
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Comprueba si una marca tiene credenciales completas (sin lanzar).
 * - static: storeDomain + token
 * - oauth:  storeDomain + clientId + clientSecret
 */
function isBrandConfigured(cfg: BrandConfig): boolean {
  if (!cfg.storeDomain) return false
  if (cfg.auth === 'static') return Boolean(cfg.token)
  return Boolean(cfg.clientId && cfg.clientSecret)
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve la config de una marca por su key. Lanza si no existe o si le faltan credenciales. */
export function getBrandConfig(key: BrandKey): BrandConfig {
  const configs = loadBrandConfigs()
  const cfg = configs[key]
  if (!cfg) throw new Error(`[shopify] Marca no reconocida: '${key}'.`)
  validateBrandConfig(cfg)
  return cfg
}

/** Lista todas las marcas disponibles (sin validación de credenciales). */
export function listBrands(): BrandConfig[] {
  return Object.values(loadBrandConfigs())
}

/**
 * Lista solo las marcas que tienen credenciales completas y pueden recibir
 * consultas. Usada por el fan-out paralelo en ShopifyOrderSource.findOrder.
 *
 * Una marca no configurada (vars de entorno vacías) se omite silenciosamente;
 * si NINGUNA marca está configurada la ruta devuelve 502 SHOPIFY_ERROR.
 */
export function listConfiguredBrands(): BrandConfig[] {
  return Object.values(loadBrandConfigs()).filter(isBrandConfigured)
}
