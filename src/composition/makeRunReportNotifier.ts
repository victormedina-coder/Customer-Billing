/**
 * Construye el RunReportNotifier. Si faltan credenciales SMTP devuelve un
 * NoOp que solo loguea — así la feature es segura de desplegar ANTES de que
 * llegue la cuenta de Workspace: el endpoint no truena, solo omite el aviso.
 *
 * Ruta Google Workspace: host smtp.gmail.com, puerto 587 (STARTTLS) con la
 * contraseña de aplicación de la cuenta dedicada. Puerto 465 = SSL directo.
 */

import nodemailer from 'nodemailer'
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

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })

  return new SmtpRunReportNotifier(transport, { from, to })
}
