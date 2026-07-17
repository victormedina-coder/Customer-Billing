/**
 * getEvaluationNow — helper de infraestructura que resuelve el instante
 * "ahora" usado para evaluar periodos relativos y ventanas de tiempo del
 * portal (facturación global R4 — modos `relative`; ventana individual R3
 * más adelante). Introducido en R4 (el plan de diseño indica que el primero
 * de R3/R4 en mergearse lo crea y el otro lo reutiliza — KISS: una sola
 * fuente de "ahora" en todo el portal, ver
 * ~/.claude/memorias/portal-facturacion_periodicidad_plan.md D7).
 *
 * Guard duro por NODE_ENV (D7): en producción SIEMPRE devuelve `new Date()`
 * — el override de desarrollo es IMPOSIBLE de activar en prod aunque la env
 * quedara puesta por error. Fuera de producción, respeta `DEV_NOW_OVERRIDE`
 * (fecha ISO) si está presente y es válida — pensado para simular
 * manualmente instantes de corte (ej. el último día del mes a las 21:00 MX)
 * sin depender del reloj real de la máquina.
 *
 * `DEV_NOW_OVERRIDE` NUNCA debe definirse en el `.env` de producción — el
 * guard la ignoraría de todos modos, pero es higiene operativa no dejarla
 * puesta.
 */
export function getEvaluationNow(): Date {
  if (process.env.NODE_ENV === 'production') {
    return new Date()
  }

  const override = process.env.DEV_NOW_OVERRIDE
  if (!override) {
    return new Date()
  }

  const overrideDate = new Date(override)
  if (Number.isNaN(overrideDate.getTime())) {
    console.warn('[getEvaluationNow] DEV_NOW_OVERRIDE inválida, ignorando y usando la fecha real', { override })
    return new Date()
  }

  console.warn('[getEvaluationNow] usando DEV_NOW_OVERRIDE — NUNCA debe estar activo en producción', {
    override,
    resolved: overrideDate.toISOString(),
  })
  return overrideDate
}
