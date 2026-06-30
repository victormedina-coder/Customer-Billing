/**
 * PUENTE — re-exporta desde src/infrastructure/shopify/brands.ts.
 * Los imports existentes en route handlers, hooks y tests siguen funcionando.
 * Este puente se elimina en el Paso 9 del refactor DDD.
 */
export type { BrandKey, BrandConfig } from '../../src/infrastructure/shopify/brands'
export {
  shopifyGraphQLUrl,
  shopifyTokenUrl,
  getBrandConfig,
  listBrands,
  listConfiguredBrands,
} from '../../src/infrastructure/shopify/brands'
