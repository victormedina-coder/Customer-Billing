/**
 * httpError — forma canónica de error de la API.
 *
 * Único punto que construye el envelope `{ error: { code, message } }`.
 * Antes cada route handler definía su propia copia idéntica de esta función;
 * Paso 8 del refactor DDD la centraliza aquí (capa interface, puede usar `next`).
 */

import { NextResponse } from 'next/server'

export function httpError(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers })
}

/**
 * Respuesta 429 RATE_LIMITED con header Retry-After.
 * Mensaje y forma idénticos a los que existían duplicados en los 5 handlers.
 */
export function rateLimitedResponse(retryAfter: number): NextResponse {
  return httpError(
    'RATE_LIMITED',
    'Demasiadas solicitudes. Intenta de nuevo en un momento.',
    429,
    { 'Retry-After': String(retryAfter) }
  )
}
