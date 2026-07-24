/**
 * Traduce un GlobalRunReport al correo que lee finanzas: veredicto arriba,
 * los CFDIs por marca (serieFolio + UUID) y las excepciones ya identificadas.
 * Función PURA (sin nodemailer): se testea sola. El HTML v1 es un encabezado
 * con color de veredicto + el texto en <pre>; se puede enriquecer después sin
 * tocar el adapter.
 */

import { GlobalRunReport, StoreReport } from "@/src/application/global/EmitGlobalInvoiceUseCase";

export interface RunReportEmail {
    subject: string;
    text: string;
    html: string;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0')
}

function periodLabel(r: GlobalRunReport): string {
    return r.day !== undefined
        ? `${r.year}-${pad2(r.month)}-${pad2(r.day)}`
        : `${r.year}-${pad2(r.month)}`
}

function storeLines(s: StoreReport): string[] {
    const lines: string[] = [`-> ${s.store} -- enumerados ${s.enumerated}, elegibles ${s.eligible}`]

    for (const bucket of s.buckets) {
        for (const chunk of bucket.chunks) {
            const folio = chunk.serieFolio ?? '(sin folio)'
            const uuid = chunk.uuid ?? '(sin UUID)'
            lines.push(` -> ${bucket.bucket.padEnd(12)} ${chunk.outcome.padEnd(18)} ${folio} ${uuid} ${chunk.itemCount} conceptos`)
        }
    }

    if (s.skippedUnpaid.count > 0) {
        lines.push(`    ⚠ No pagados: ${s.skippedUnpaid.count} -> ${s.skippedUnpaid.orders.map((o) => `${o.reference} [${o.financialStatus}]`).join(', ')}`)
    }
    if (s.skippedFullyRefunded.count > 0) {
        lines.push(`    ⚠ Reembolsos totales: ${s.skippedFullyRefunded.count} → ${s.skippedFullyRefunded.orders.map((o) => o.reference).join(', ')}`)
    }
    if (s.unmapped.count > 0) {
        lines.push(`    ⛔ Sin clasificar (NO facturados): ${s.unmapped.count} → ${s.unmapped.orderIds.join(', ')}`)
    }
    if (s.unaccounted !== 0) {
        lines.push(`    ⛔ Descuadre (unaccounted): ${s.unaccounted}`)
    }
    if (s.excludedAlreadyInvoiced.count > 0) {
        lines.push(`    ℹ Ya facturados (excluidos): ${s.excludedAlreadyInvoiced.count}`)
    }
    return lines
}

function buildText(r: GlobalRunReport): string {
    const kind = r.day !== undefined ? 'DIARIO' : 'MENSUAL'
    const sim = r.dryRun ? ' — SIMULACRO (no se generan facturas)' : ''
    const s = r.summary
    const head = [
        `Corrida ${r.runId}`,
        `Periodo: ${periodLabel(r)} (${kind})${sim}`,
        `Veredicto: ${s.hasFailures ? 'REQUIERE ATENCIÓN' : 'OK'}`,
        '',
        'Resumen:',
        `  CFDIs emitidos:    ${s.emitted}`,
        `  Chunks:            ${s.chunks} (rolled_back ${s.rolledBack}, sin confirmar ${s.stampedUnconfirmed})`,
        `  Pedidos elegibles: ${s.ordersEligible}`,
        `  Sin clasificar:    ${s.unmapped}`,
        `  Descuadre:         ${s.unaccounted}`,
        '',
        'Por tienda:',
    ]
    return head.concat(r.stores.flatMap(storeLines)).join('\n')
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatGlobalRunReportEmail(r: GlobalRunReport): RunReportEmail {
    const verdict = r.summary.hasFailures ? '🔴' : '✅'
  const sim = r.dryRun ? ' [SIMULACRO]' : ''
  const subject = `${verdict} Facturación Global ${periodLabel(r)}${sim} — ${r.summary.emitted} CFDI(s)`
  const text = buildText(r)
  const color = r.summary.hasFailures ? '#b91c1c' : '#15803d'
  const html = [
    `<div style="font-family:system-ui,Arial,sans-serif">`,
    `<h2 style="color:${color};margin:0 0 8px">${verdict} Facturación Global ${escapeHtml(periodLabel(r))}${sim}</h2>`,
    `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    `</div>`,
  ].join('')
  return { subject, text, html }
}