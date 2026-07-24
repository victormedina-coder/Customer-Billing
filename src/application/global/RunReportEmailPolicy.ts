/**
 * Decide si una corrida amerita aviso por correo. Pura y testeable.
 *
 * - MENSUAL: siempre. Es el cierre contable, se archiva.
 * - DIARIA: solo si hay algo que atender. Un correo diario que siempre dice
 *   "todo bien" deja de leerse, y entonces no sirve el día que trae la
 *   novedad. `skippedUnpaid` se incluye a propósito aunque NO esté en
 *   `hasFailures`: un POS sin pago es anomalía operativa (finanzas lo está
 *   analizando), y el aviso es justo el canal para que lo revisen.
 *
 * Si finanzas pide el diario SIEMPRE, este es el único punto a cambiar.
 */

import { GlobalRunReport } from "./EmitGlobalInvoiceUseCase"

export function shouldEmailRunReport(report: GlobalRunReport): boolean {
    if(report.day === undefined) return true
    if(report.summary.hasFailures) return true
    return report.stores.some((s) => s.skippedUnpaid.count > 0)
}