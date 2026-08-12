/**
 * brandSerie — resolución de la Serie fiscal por marca, COMPARTIDA entre el
 * CFDI global (globalCfdiPayloadBuilder) y el individual (cfdiPayloadBuilder).
 *
 * En Facturama la Serie identifica la marca dentro de una misma cuenta/CSD:
 * el emisor es el mismo para las tres marcas, así que sin Serie los
 * comprobantes son indistinguibles. En producción hay UNA sola numeración por
 * marca, gobernada por su Serie — global e individual comparten la secuencia
 * (confirmado 2026-07-23). Por eso esta lógica vive en un solo lugar: los dos
 * builders DEBEN resolver la misma serie para la misma marca.
 *
 * Los valores por defecto son la convención YA vigente en producción
 * (confirmada por contabilidad). Se permite override por env porque el sandbox
 * puede tener series distintas dadas de alta (deben existir previamente en la
 * sucursal del ExpeditionPlace o Facturama rechaza el timbrado con
 * "El atributo 'Serie' debe existir en la sucursal").
 */

const BRAND_SERIE: Record<string, { envVar: string; fallback: string }> = {
  'ariat':            { envVar: 'ARIAT_FACTURAMA_SERIE',   fallback: 'GDL1' },
  'stetson':          { envVar: 'STETSON_FACTURAMA_SERIE', fallback: 'STET' },
  'western-brothers': { envVar: 'WB_FACTURAMA_SERIE',      fallback: 'WB'   },
}

/**
 * Serie de la marca (por brand key: 'ariat' | 'stetson' | 'western-brothers').
 * Devuelve `undefined` si la marca no está mapeada o no se conoce — en ese caso
 * el payload OMITE la Serie y Facturama usa la serie por defecto de la sucursal.
 */
export function resolveSerie(brandKey: string | undefined | null): string | undefined {
  if (!brandKey) return undefined
  const cfg = BRAND_SERIE[brandKey]
  if (!cfg) return undefined
  return process.env[cfg.envVar]?.trim() || cfg.fallback
}
