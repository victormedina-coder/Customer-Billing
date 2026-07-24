/**
 * Adapter SMTP del puerto RunReportNotifier. No importa nodemailer: recibe un
 * `MailTransport` estructural (la composición le pasa el transporter real de
 * nodemailer, que lo satisface). Así el adapter se testea con un transport
 * falso, sin librería ni credenciales.
 */

import type { RunReportNotifier } from '../../application/global/ports/RunReportNotifier'
import type { GlobalRunReport } from '../../application/global/EmitGlobalInvoiceUseCase'
import { formatGlobalRunReportEmail } from './formatGlobalRunReportEmail'

export interface MailMessage {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>
}

export class SmtpRunReportNotifier implements RunReportNotifier {
  constructor(
    private readonly transport: MailTransport,
    private readonly opts: { from: string; to: string },
  ) {}

  async notify(report: GlobalRunReport): Promise<void> {
    const { subject, text, html } = formatGlobalRunReportEmail(report)
    await this.transport.sendMail({ from: this.opts.from, to: this.opts.to, subject, text, html })
  }
}
