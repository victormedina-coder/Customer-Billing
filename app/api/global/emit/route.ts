/**
 * POST /api/global/emit
 *
 * Dispara una corrida de facturación global mensual (Paso 6 — composición +
 * interface HTTP; el use case en sí es el Paso 5, ver
 * ~/.claude/memorias/portal-facturacion_global-mensual_plan.md §6).
 *
 * El Portal es público y sin sesión de usuario, por lo que este endpoint NO
 * puede depender de auth de usuario: se protege con un secreto compartido
 * (header `x-global-secret` vs env `GLOBAL_INVOICE_SECRET`), pensado para ser
 * llamado por un cron/job interno, no por el navegador del cliente final.
 *
 * Recibe: { year?, month?, day?, relative?, storeName?, dryRun? }
 * (ver GlobalEmitSchema en lib/api/schemas.ts para las reglas de exclusión).
 * La resolución del periodo (explícito vs relative vs default histórico) es
 * responsabilidad de ESTA capa interface — el use case siempre recibe
 * year/month(/day) ya resueltos (ver bloque "Resolución del periodo" abajo).
 * Responde: { report: GlobalRunReport } en 200, o error estructurado en 4xx/5xx.
 *
 * Runtime: Node.js (no edge) — usa `crypto` de node y secretos de servidor.
 *
 * Errores:
 *   400 INVALID_BODY         → body no es JSON válido
 *   400 VALIDATION_FAILED    → Zod falla, o year/month inválidos a nivel dominio
 *   401 UNAUTHORIZED         → header ausente o secreto incorrecto (sin detalle)
 *   422 STORE_NOT_CONFIGURED → storeName no está entre las marcas configuradas
 *   429 RATE_LIMITED         → demasiados intentos (defensa en profundidad)
 *   503 FEATURE_NOT_CONFIGURED → GLOBAL_INVOICE_SECRET no está definido
 */

export const runtime = 'nodejs'
// Railway limita la duración máxima de un request; una corrida global puede
// enumerar/timbrar varias tiendas y buckets en un solo POST, así que se pide
// el máximo permitido en ese plan para no cortar la corrida a la mitad.
export const maxDuration = 300

import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { RATE_LIMITS } from '@/src/infrastructure/rate-limit'
import { GlobalEmitSchema } from '@/lib/api/schemas'
import { makeEmitGlobalInvoiceUseCase } from '@/src/composition/makeEmitGlobalInvoiceUseCase'
import type { GlobalRunErrorCode } from '@/src/application/global/EmitGlobalInvoiceUseCase'
import { httpError } from '@/src/interface/http/httpError'
import { enforceRateLimit } from '@/src/interface/http/withRateLimit'
// previousMxDay es exclusiva del modo relative:'yesterday' — [DAILY-SCAFFOLDING]
// test-only, remover junto con ese case y este import (ver plan R5).
import { currentMxYearMonth, previousMxDay, previousMxYearMonth } from '@/src/domain/shared/MxCalendar'
import { getEvaluationNow } from '@/src/infrastructure/time/getEvaluationNow'

const SECRET_HEADER = 'x-global-secret'

/** Mapa de código de error de dominio → status HTTP */
const ERROR_STATUS: Record<GlobalRunErrorCode, number> = {
  VALIDATION_FAILED: 400,
  STORE_NOT_CONFIGURED: 422,
}

/**
 * Compara el secreto recibido contra el configurado, en tiempo constante.
 * Se hashea (SHA-256) cada lado antes de comparar: `timingSafeEqual` exige
 * buffers de igual longitud, y hashear los normaliza siempre a 32 bytes —
 * así ni el tiempo de comparación ni un mismatch de longitud filtran nada
 * sobre el secreto real, incluso si el atacante envía un header más corto o
 * más largo que el esperado.
 */
function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false
  const receivedHash = createHash('sha256').update(received).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(receivedHash, expectedHash)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Feature configurada ────────────────────────────────────────────────
  const secret = process.env.GLOBAL_INVOICE_SECRET
  if (!secret) {
    console.error('[global-emit-route] GLOBAL_INVOICE_SECRET no configurado — endpoint deshabilitado')
    return httpError('FEATURE_NOT_CONFIGURED', 'La facturación global no está configurada.', 503)
  }

  // ── 1. Rate limiting — defensa en profundidad además del secreto ─────────
  const rateLimited = await enforceRateLimit(
    req,
    'global-emit',
    RATE_LIMITS.globalEmit.max,
    RATE_LIMITS.globalEmit.windowSec,
  )
  if (rateLimited) return rateLimited

  // ── 2. Verificación de secreto ─────────────────────────────────────────────
  const received = req.headers.get(SECRET_HEADER)
  if (!isValidSecret(received, secret)) {
    return httpError('UNAUTHORIZED', 'No autorizado.', 401)
  }

  // ── 3. Parsear body ────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return httpError('INVALID_BODY', 'El cuerpo de la petición no es JSON válido.', 400)
  }

  // ── 4. Validación Zod ──────────────────────────────────────────────────────
  const parsed = GlobalEmitSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((issue) => issue.message).join('; ')
    return httpError('VALIDATION_FAILED', msg, 400)
  }
  const { year: bodyYear, month: bodyMonth, day: bodyDay, relative, storeName, dryRun } = parsed.data

  // ── 4b. Resolución del periodo (solo interface — el use case no lo conoce) ─
  // GlobalEmitSchema ya garantiza: year/month vienen ambos o ninguno; day
  // requiere year+month; relative es excluyente con los componentes
  // explícitos. Los 6 casos posibles, en orden de precedencia:
  let year: number
  let month: number
  let day: number | undefined = undefined
  let resolvedBy: string

  if (bodyYear !== undefined && bodyMonth !== undefined) {
    // 1/2. Explícito diario ({year,month,day}) o mensual ({year,month}).
    year = bodyYear
    month = bodyMonth
    day = bodyDay
    resolvedBy = day !== undefined ? 'explicit-daily' : 'explicit-monthly'
  } else if (relative === 'current-month') {
    // 3. Relativo mensual, mes en curso — cron de producción (R2).
    ;({ year, month } = currentMxYearMonth(getEvaluationNow()))
    resolvedBy = 'relative-current-month'
  } else if (relative === 'previous-month') {
    // 4. Relativo mensual, mes anterior — equivalente explícito del default histórico.
    ;({ year, month } = previousMxYearMonth(getEvaluationNow()))
    resolvedBy = 'relative-previous-month'
  } else if (relative === 'yesterday') {
    // 5. Relativo diario, día de ayer MX — cron de sandbox.
    // [DAILY-SCAFFOLDING] test-only, remover este case junto con el import de
    // previousMxDay y la entrada 'yesterday' del enum (ver plan R5).
    ;({ year, month, day } = previousMxDay(getEvaluationNow()))
    resolvedBy = 'relative-yesterday'
  } else {
    // 6. Body vacío → default histórico: mes anterior en zona MX (comportamiento intacto).
    ;({ year, month } = previousMxYearMonth(getEvaluationNow()))
    resolvedBy = 'default-previous-month'
  }

  console.log('[global-emit-route] periodo resuelto', { resolvedBy, year, month, day })

  // ── 5. Orquestación delegada al use case ──────────────────────────────────
  const useCase = makeEmitGlobalInvoiceUseCase()
  const result = await useCase.execute({ year, month, day, storeName, dryRun })

  if (!result.ok) {
    const { code, message } = result.error
    return httpError(code, message, ERROR_STATUS[code])
  }

  return NextResponse.json({ report: result.value }, { status: 200 })
}
