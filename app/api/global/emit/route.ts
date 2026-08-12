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
 * Recibe: { year?, month?, relative?, storeName?, dryRun? }
 * (ver GlobalEmitSchema en lib/api/schemas.ts para las reglas de exclusión).
 * La resolución del periodo (explícito vs relative vs default histórico) es
 * responsabilidad de ESTA capa interface — el use case siempre recibe
 * year/month ya resueltos (ver bloque "Resolución del periodo" abajo).
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
import { currentMxYearMonth, previousMxYearMonth } from '@/src/domain/shared/MxCalendar'
import { getEvaluationNow } from '@/src/infrastructure/time/getEvaluationNow'
import { logger } from '@/src/infrastructure/observability/logger'
import { makeRunReportNotifier } from '@/src/composition/makeRunReportNotifier'
import { shouldEmailRunReport } from '@/src/application/global/RunReportEmailPolicy'

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
  const { year: bodyYear, month: bodyMonth, relative, storeName, dryRun } = parsed.data

  // ── 4b. Resolución del periodo (solo interface — el use case no lo conoce) ─
  // GlobalEmitSchema ya garantiza: year/month vienen ambos o ninguno; relative
  // es excluyente con los componentes explícitos. Los 4 casos posibles, en
  // orden de precedencia:
  let year: number
  let month: number
  let resolvedBy: string

  if (bodyYear !== undefined && bodyMonth !== undefined) {
    // 1. Explícito mensual ({year,month}).
    year = bodyYear
    month = bodyMonth
    resolvedBy = 'explicit-monthly'
  } else if (relative === 'current-month') {
    // 2. Relativo mensual, mes en curso — cron de producción (R2).
    ;({ year, month } = currentMxYearMonth(getEvaluationNow()))
    resolvedBy = 'relative-current-month'
  } else if (relative === 'previous-month') {
    // 3. Relativo mensual, mes anterior — equivalente explícito del default histórico.
    ;({ year, month } = previousMxYearMonth(getEvaluationNow()))
    resolvedBy = 'relative-previous-month'
  } else {
    // 4. Body vacío → default histórico: mes anterior en zona MX (comportamiento intacto).
    ;({ year, month } = previousMxYearMonth(getEvaluationNow()))
    resolvedBy = 'default-previous-month'
  }

  logger.info({ resolvedBy, year, month }, '[global-emit-route] periodo resuelto')

  // ── 5. Orquestación delegada al use case ──────────────────────────────────
  const useCase = makeEmitGlobalInvoiceUseCase()
  const result = await useCase.execute({ year, month, storeName, dryRun })

  if (!result.ok) {
    const { code, message } = result.error
    return httpError(code, message, ERROR_STATUS[code])
  }

  const report = result.value

  // ── 5b. Aviso por correo (best-effort) ────────────────────────────────────
  // NUNCA puede afectar la corrida fiscal: la facturación ya ocurrió arriba.
  // Un fallo del SMTP se registra y se ignora; el status HTTP lo sigue
  // decidiendo hasFailures. Se envía DESPUÉS de resolver el reporte para que
  // el correo de fallo (hasFailures) también salga.
  if (shouldEmailRunReport(report)) {
    try {
      await makeRunReportNotifier().notify(report)
    } catch (err) {
      logger.error(
        { runId: report.runId, err: (err as Error).message },
        '[global-emit-route] fallo al enviar el aviso por correo — la corrida NO se ve afectada',
      )
    }
  }

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
