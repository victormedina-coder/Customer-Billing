/**
 * Construye el RunReportNotifier. Si faltan credenciales SMTP devuelve un
 * NoOp que solo loguea — así la feature es segura de desplegar ANTES de que
 * llegue la cuenta de Workspace: el endpoint no truena, solo omite el aviso.
 *
 * Ruta Google Workspace: host smtp.gmail.com, puerto 587 (STARTTLS) con la
 * contraseña de aplicación de la cuenta dedicada. Puerto 465 = SSL directo.
 */

import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import type { RunReportNotifier } from '../application/global/ports/RunReportNotifier'
import { SmtpRunReportNotifier } from '../infrastructure/notifications/SmtpRunReportNotifier'
import { logger } from '../infrastructure/observability/logger'

class NoOpRunReportNotifier implements RunReportNotifier {
  async notify(): Promise<void> {
    logger.info({}, '[run-report-notifier] SMTP no configurado — aviso por correo omitido')
  }
}

export function makeRunReportNotifier(): RunReportNotifier {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.GLOBAL_REPORT_FROM ?? user
  const to = process.env.GLOBAL_REPORT_TO

  if (!host || !user || !pass || !from || !to) {
    return new NoOpRunReportNotifier()
  }

  const options = {
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // Fuerza STARTTLS en 587: sin esto, si el servidor no ofreciera STARTTLS,
    // nodemailer degradaría a texto plano y enviaría las credenciales en claro.
    // Con secure:true (465) es redundante e inofensivo. (fable-security M-3)
    requireTLS: true,
    // Cota dura a la conexión: el aviso NUNCA debe atorar la corrida fiscal.
    // Sin estos límites, un SMTP mal configurado o caído deja el `await
    // notify()` colgado hasta los defaults largos de nodemailer. Con la cota,
    // falla rápido y el try/catch del route lo registra sin bloquear el cron.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  } as SMTPTransport.Options

  // Familia IP de la conexión SMTP — configurable por entorno porque el
  // ruteo saliente difiere por host (2026-08-03):
  //   SMTP_FAMILY=4  → fuerza IPv4 (local / redes SIN ruta IPv6; evita ENETUNREACH a IPv6)
  //   SMTP_FAMILY=6  → fuerza IPv6 (Railway con "Outbound IPv6" habilitado)
  //   (sin definir)  → dual-stack, lo decide Node
  // `family` es válida en runtime (va al socket TCP) pero no está en los tipos
  // de esta versión de nodemailer → asignación con cast puntual.
  const smtpFamily = process.env.SMTP_FAMILY?.trim()
  if (smtpFamily) (options as { family?: number }).family = Number(smtpFamily)

  const transport = nodemailer.createTransport(options)

  return new SmtpRunReportNotifier(transport, { from, to })
}
