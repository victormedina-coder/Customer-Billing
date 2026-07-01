/**
 * enforceRateLimit — boilerplate de rate-limit por IP compartido por los 5 handlers.
 *
 * Cada handler repetía: getClientIp + rateLimit(`<key>:${ip}`, max, windowSec) +
 * construir la respuesta 429 RATE_LIMITED con Retry-After si no se permite.
 * Este helper hace exactamente eso y devuelve `null` cuando la solicitud puede
 * continuar, o un NextResponse 429 listo para retornar cuando no.
 *
 * `lookup` tiene un SEGUNDO límite (por folio, clave `validate:folio:<folio>`)
 * que no depende de la IP/req — ese se queda como llamada explícita a `rateLimit`
 * en el handler, fuera de este helper.
 */

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/src/infrastructure/rate-limit'
import { rateLimitedResponse } from './httpError'

export async function enforceRateLimit(
  req: Request,
  keyPrefix: string,
  max: number,
  windowSec: number
): Promise<NextResponse | null> {
  const ip = getClientIp(req)
  const rl = await rateLimit(`${keyPrefix}:${ip}`, max, windowSec)
  if (!rl.allowed) {
    return rateLimitedResponse(rl.retryAfter)
  }
  return null
}
