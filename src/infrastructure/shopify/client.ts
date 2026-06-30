/**
 * Cliente Shopify — adapter de infraestructura.
 * Contenido movido de lib/shopify/client.ts sin cambiar comportamiento.
 * El puente en lib/shopify/client.ts re-exporta desde aquí.
 */

import type { BrandConfig } from './brands'
import { shopifyGraphQLUrl, shopifyTokenUrl } from './brands'

// ─────────────────────────────────────────────────────────────────────────────
// Caché de tokens OAuth por marca
// ─────────────────────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

const REFRESH_BUFFER_MS = 60_000
const DEFAULT_EXPIRES_IN_S = 86_400

// ─────────────────────────────────────────────────────────────────────────────
// getShopifyToken
// ─────────────────────────────────────────────────────────────────────────────

export async function getShopifyToken(cfg: BrandConfig): Promise<string> {
  if (cfg.auth === 'static') {
    if (!cfg.token) {
      throw new Error(
        `[shopify] Token estático no configurado para la marca '${cfg.key}'.`
      )
    }
    return cfg.token
  }

  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      `[shopify] CLIENT_ID o CLIENT_SECRET no configurados para la marca '${cfg.key}'.`
    )
  }

  const now = Date.now()
  const cached = tokenCache.get(cfg.key)

  if (cached && now < cached.expiresAt - REFRESH_BUFFER_MS) {
    return cached.accessToken
  }

  const url = shopifyTokenUrl(cfg.storeDomain)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    })
  } catch (err) {
    throw new Error(
      `[shopify] Error de red al obtener token OAuth para '${cfg.key}': ${String(err)}`
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `[shopify] Shopify rechazó el token para '${cfg.key}' (HTTP ${res.status}): ${text.slice(0, 200)}`
    )
  }

  let data: { access_token: string; expires_in?: number }
  try {
    data = (await res.json()) as { access_token: string; expires_in?: number }
  } catch {
    throw new Error(
      `[shopify] Respuesta de token no es JSON válido para la marca '${cfg.key}'.`
    )
  }

  if (!data.access_token) {
    throw new Error(
      `[shopify] Respuesta de token sin access_token para la marca '${cfg.key}'.`
    )
  }

  const expiresInMs = (data.expires_in ?? DEFAULT_EXPIRES_IN_S) * 1000
  tokenCache.set(cfg.key, {
    accessToken: data.access_token,
    expiresAt: now + expiresInMs,
  })

  return data.access_token
}

// ─────────────────────────────────────────────────────────────────────────────
// shopifyGraphQL
// ─────────────────────────────────────────────────────────────────────────────

export async function shopifyGraphQL<T = unknown>(
  cfg: BrandConfig,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await getShopifyToken(cfg)
  const url = shopifyGraphQLUrl(cfg.storeDomain)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
      cache: 'no-store',
    })
  } catch (err) {
    throw new Error(
      `[shopify] Error de red en GraphQL para '${cfg.key}': ${String(err)}`
    )
  }

  if (!res.ok) {
    throw new Error(
      `[shopify] GraphQL HTTP ${res.status} para la marca '${cfg.key}'.`
    )
  }

  let body: { data?: T | null; errors?: Array<{ message: string }> }
  try {
    body = (await res.json()) as typeof body
  } catch {
    throw new Error(
      `[shopify] Respuesta GraphQL no es JSON válido para la marca '${cfg.key}'.`
    )
  }

  if (body.errors && body.errors.length > 0) {
    const msgs = body.errors.map((e) => e.message).join('; ')
    throw new Error(`[shopify] GraphQL error para '${cfg.key}': ${msgs}`)
  }

  if (body.data == null) {
    throw new Error(
      `[shopify] GraphQL devolvió data=null para la marca '${cfg.key}'.`
    )
  }

  return body.data
}
