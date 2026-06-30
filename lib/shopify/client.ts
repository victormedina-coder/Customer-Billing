/**
 * PUENTE — re-exporta desde src/infrastructure/shopify/client.ts.
 * Los imports existentes en route handlers, hooks y tests siguen funcionando.
 * Este puente se elimina en el Paso 9 del refactor DDD.
 */
export { getShopifyToken, shopifyGraphQL } from '../../src/infrastructure/shopify/client'
