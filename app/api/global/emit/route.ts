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
 *   500 (con { report })   → la corrida terminó pero algún chunk quedó en
 *                            rolled_back/stamped_unconfirmed (ver summary.hasFailures)
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
// previousMxDay/currentMxDay son exclusivas de los modos relative:'yesterday' y
// 'today' — [DAILY-SCAFFOLDING] test-only, remover junto con esos cases y este
// import (ver plan R5).
import { currentMxDay, currentMxYearMonth, previousMxDay, previousMxYearMonth } from '@/src/domain/shared/MxCalendar'
import { getEvaluationNow } from '@/src/infrastructure/time/getEvaluationNow'
import { logger } from '@/src/infrastructure/observability/logger'

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
    logger.error({}, '[global-emit-route] GLOBAL_INVOICE_SECRET no configurado — endpoint deshabilitado')
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
  // explícitos. Los 7 casos posibles, en orden de precedencia:
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
    // 5. Relativo diario, día de ayer MX — periodo YA CERRADO.
    // [DAILY-SCAFFOLDING] test-only, remover este case junto con el import de
    // previousMxDay y la entrada 'yesterday' del enum (ver plan R5).
    ;({ year, month, day } = previousMxDay(getEvaluationNow()))
    resolvedBy = 'relative-yesterday'
  } else if (relative === 'today') {
    // 6. Relativo diario, día MX EN CURSO — cron de sandbox a la hora de corte.
    // Análogo exacto de 'current-month' (caso 3): con el cron a las 21:00 MX el
    // periodo sigue ABIERTO, así que los pedidos posteriores al corte no entran
    // — mismo comportamiento (y mismo riesgo, ADR-009) que la mensual de
    // producción, pero ejercitado a diario en vez de una vez al mes.
    // [DAILY-SCAFFOLDING] test-only, remover este case junto con el import de
    // currentMxDay y la entrada 'today' del enum (ver plan R5).
    ;({ year, month, day } = currentMxDay(getEvaluationNow()))
    resolvedBy = 'relative-today'
  } else {
    // 7. Body vacío → default histórico: mes anterior en zona MX (comportamiento intacto).
    ;({ year, month } = previousMxYearMonth(getEvaluationNow()))
    resolvedBy = 'default-previous-month'
  }

  logger.info({ resolvedBy, year, month, day }, '[global-emit-route] periodo resuelto')

  // ── 5. Orquestación delegada al use case ──────────────────────────────────
  const useCase = makeEmitGlobalInvoiceUseCase()
  const result = await useCase.execute({ year, month, day, storeName, dryRun })

  if (!result.ok) {
    const { code, message } = result.error
    return httpError(code, message, ERROR_STATUS[code])
  }

  const report = result.value

  // Un chunk en `rolled_back`/`stamped_unconfirmed` es un hueco fiscal: pedidos
  // elegibles que no quedaron timbrados (o timbrados sin registrar). Se responde
  // con status de error para que el cron de Railway lo marque como fallido en
  // vez de pintarlo verde; el reporte COMPLETO viaja igual en el body para
  // diagnóstico (mismo shape que el 200, solo cambia el status).
  if (report.summary.hasFailures) {
    logger.error(
      { runId: report.runId, year: report.year, month: report.month, day: report.day, summary: report.summary },
      '[global-emit-route] corrida con fallos — revisar chunks en rolled_back/stamped_unconfirmed',
    )
    return NextResponse.json({ report }, { status: 500 })
  }

  return NextResponse.json({ report }, { status: 200 })
}
