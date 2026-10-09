/**
 * Traduce un GlobalRunReport al correo que lee finanzas.
 *
 * Objetivo: que un lector NO técnico entienda de un vistazo cuántos PEDIDOS se
 * facturaron (NO cuántos CFDIs — un CFDI global agrupa cientos de pedidos), el
 * desglose por marca y forma de pago, cuántos ya tenían factura vigente, y qué
 * falló con el detalle necesario para conciliar (marca + forma de pago +
 * motivo). El detalle de errores es POR GRUPO (marca/forma de pago): un CFDI
 * que falla arrastra todos los pedidos de ese bucket; lo accionable es
 * revisar ese grupo, y las referencias exactas viven en el log estructurado.
 *
 * Formato aprobado por el usuario (2026-08-03): asunto con el mes en palabras,
 * encabezado en una línea, columnas alineadas con puntos de relleno, marca
 * abreviada en las líneas de totales. Función PURA (sin nodemailer ni config de
 * marcas): se testea sola. El HTML envuelve el texto en <pre>.
 */

import type { GlobalRunReport } from "@/src/application/global/EmitGlobalInvoiceUseCase";
import type { PaymentBucket } from "@/src/domain/global/PaymentBucket";
import { MX_TZ, mxDayInvoiceCutoff, mxMonthInvoiceCutoff } from "@/src/domain/shared/MxCalendar";

export interface RunReportEmail {
    subject: string;
    text: string;
    html: string;
}

export interface RunReportEmailContext {
    finishedAt: Date
    minAgeMinutes: number
    cutoffHour: number
}

const MX_DATE_TIME = new Intl.DateTimeFormat('es-MX', {
    timeZone: MX_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function mxDateTime(date: Date): string {
    const parts = Object.fromEntries(MX_DATE_TIME.formatToParts(date).map((part) => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} MX`
}

function manualRerunSection(r: GlobalRunReport, context?: RunReportEmailContext): string[] {
    if (r.dryRun || !context) return []

    const pendingStores = new Set<string>()
    const unresolvedHeaders = r.stores.flatMap((store) => {
        if (store.excludedAlreadyInvoiced.orders.some((order) => order.matchedBy === 'db_unresolved') ||
            store.buckets.some((bucket) => bucket.chunks.some((chunk) => chunk.itemCount > 0 &&
                ['rolled_back', 'rollback_failed', 'reservation_failed', 'skipped_idempotent', 'stamped_unconfirmed'].includes(chunk.outcome)))) {
            pendingStores.add(store.store)
        }
        const headers = store.unresolvedHeaders
        if (headers.length > 0) pendingStores.add(store.store)
        return headers
    })
    if (pendingStores.size === 0) return []

    const lastHeaderTime = unresolvedHeaders.reduce((latest, header) => Math.max(latest, header.createdAt.getTime()), -Infinity)
    const earliestBase = Number.isFinite(lastHeaderTime) ? lastHeaderTime : context.finishedAt.getTime()
    const earliest = new Date(earliestBase + context.minAgeMinutes * 60_000)
    const cutoff = r.day === undefined
        ? mxMonthInvoiceCutoff(r.year, r.month, context.cutoffHour)
        : mxDayInvoiceCutoff(r.year, r.month, r.day, context.cutoffHour)
    const deadline = new Date(cutoff.getTime() + 24 * 60 * 60_000)
    const bodies = [...pendingStores].map((storeName) => JSON.stringify({ year: r.year, month: r.month, storeName }))

    return [
        'Acción requerida: segunda corrida manual',
        `Hora más temprana: ${mxDateTime(earliest)}`,
        `Límite: ${mxDateTime(deadline)} (dentro de las 24 h posteriores al corte)`,
        ...bodies,
        ...(pendingStores.size > 1 ? [JSON.stringify({ year: r.year, month: r.month })] : []),
        'No usar relative: current-month: después de medianoche resuelve al mes siguiente.',
        'Correr primero con "dryRun": true para revisar las decisiones de conciliación (en dryRun la conciliación no escribe).',
        '',
    ]
}

// Etiquetas legibles. Mapas LOCALES a propósito (no se importa brands.ts) para
// que el formateador siga siendo puro y testeable sin config de marcas; el
// fallback cubre cualquier clave nueva sin romper el correo.
const BRAND_LABELS: Record<string, string> = {
    ariat: 'Ariat',
    stetson: 'Stetson',
    'western-brothers': 'Western Brothers',
}
// Nombre corto para las líneas compactas de totales (ej. "Ariat 8 · Stetson 3 · WB 1").
const BRAND_SHORT: Record<string, string> = {
    ariat: 'Ariat',
    stetson: 'Stetson',
    'western-brothers': 'WB',
}
const BUCKET_LABELS: Record<PaymentBucket, string> = {
    efectivo: 'efectivo',
    credito: 'crédito',
    debito: 'débito',
}
const BUCKET_ORDER: PaymentBucket[] = ['efectivo', 'credito', 'debito']
const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function brandLabel(key: string): string {
    return BRAND_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ')
}
function brandShort(key: string): string {
    return BRAND_SHORT[key] ?? brandLabel(key)
}
function pad2(n: number): string {
    return String(n).padStart(2, '0')
}
// Periodo en formato ISO (2026-07 / 2026-07-23) — para el cuerpo, inequívoco.
function periodIso(r: GlobalRunReport): string {
    return r.day !== undefined ? `${r.year}-${pad2(r.month)}-${pad2(r.day)}` : `${r.year}-${pad2(r.month)}`
}
// Periodo con el mes en palabras (Julio 2026 / 23 Julio 2026) — para el asunto.
function periodHuman(r: GlobalRunReport): string {
    const month = MONTHS[r.month - 1] ?? `Mes ${r.month}`
    return r.day !== undefined ? `${r.day} ${month} ${r.year}` : `${month} ${r.year}`
}
// Etiqueta + puntos de relleno hasta `width`, para alinear el valor a su derecha.
function leader(label: string, width: number): string {
    const dots = Math.max(0, width - label.length - 1)
    return `${label} ${'.'.repeat(dots)} `
}

// ─── Agregaciones sobre el reporte ───────────────────────────────────────────
// "Facturado" = pedido dentro de un chunk timbrado. En corrida real el outcome
// es 'emitted'; en simulacro es 'dry_run' (mismo conteo de pedidos, otro
// verbo). Se cuenta CHUNK.itemCount (# de pedidos) — NO summary.emitted, que
// cuenta CFDIs/chunks.

interface BrandBilled {
    store: string
    total: number
    byBucket: Map<PaymentBucket, number>
}

function billedOutcomeOf(r: GlobalRunReport): 'emitted' | 'dry_run' {
    return r.dryRun ? 'dry_run' : 'emitted'
}

function billedByBrand(r: GlobalRunReport): BrandBilled[] {
    const billed = billedOutcomeOf(r)
    return r.stores.map((s) => {
        const byBucket = new Map<PaymentBucket, number>()
        let total = 0
        for (const bucket of s.buckets) {
            let bucketTotal = 0
            for (const chunk of bucket.chunks) {
                if (chunk.outcome === billed) bucketTotal += chunk.itemCount
            }
            if (bucketTotal > 0) {
                byBucket.set(bucket.bucket, (byBucket.get(bucket.bucket) ?? 0) + bucketTotal)
                total += bucketTotal
            }
        }
        return { store: s.store, total, byBucket }
    })
}

interface EmittedCfdi {
    store: string
    bucket: PaymentBucket
    serieFolio?: string
    uuid?: string
    itemCount: number
}

function emittedCfdis(r: GlobalRunReport): EmittedCfdi[] {
    const billed = billedOutcomeOf(r)
    const out: EmittedCfdi[] = []
    for (const s of r.stores) {
        for (const bucket of s.buckets) {
            for (const chunk of bucket.chunks) {
                if (chunk.outcome === billed) {
                    out.push({ store: s.store, bucket: bucket.bucket, serieFolio: chunk.serieFolio, uuid: chunk.uuid, itemCount: chunk.itemCount })
                }
            }
        }
    }
    return out
}

interface FailGroup {
    store: string
    bucket: PaymentBucket
    itemCount: number
    outcome: 'rolled_back' | 'rollback_failed' | 'reservation_failed' | 'stamped_unconfirmed'
    serieFolio?: string
    error?: string
}

function failedGroups(r: GlobalRunReport): FailGroup[] {
    const out: FailGroup[] = []
    for (const s of r.stores) {
        for (const bucket of s.buckets) {
            for (const chunk of bucket.chunks) {
                if (chunk.outcome === 'rolled_back' || chunk.outcome === 'rollback_failed' || chunk.outcome === 'reservation_failed' || chunk.outcome === 'stamped_unconfirmed') {
                    out.push({ store: s.store, bucket: bucket.bucket, itemCount: chunk.itemCount, outcome: chunk.outcome, serieFolio: chunk.serieFolio, error: chunk.error })
                }
            }
        }
    }
    return out
}

function idempotentChunks(r: GlobalRunReport): number {
    let n = 0
    for (const s of r.stores) for (const b of s.buckets) for (const c of b.chunks) if (c.outcome === 'skipped_idempotent') n++
    return n
}

function bucketBreakdown(byBucket: Map<PaymentBucket, number>): string {
    return BUCKET_ORDER
        .filter((b) => (byBucket.get(b) ?? 0) > 0)
        .map((b) => `${BUCKET_LABELS[b]} ${String(byBucket.get(b)).padStart(2)}`)
        .join(' · ')
}

// ─── Composición del cuerpo ──────────────────────────────────────────────────

const RULE = '━'.repeat(36)

function buildText(r: GlobalRunReport, context?: RunReportEmailContext): string {
    const kind = r.day !== undefined ? 'DIARIA' : 'MENSUAL'
    const sim = r.dryRun ? ' — SIMULACRO (no se generan facturas)' : ''
    const billed = billedByBrand(r)
    const totalBilled = billed.reduce((a, b) => a + b.total, 0)
    const cfdis = emittedCfdis(r)
    const nCfdis = cfdis.length
    const fails = failedGroups(r)
    const totalFailedOrders = fails.reduce((a, f) => a + f.itemCount, 0)
    const totalExcluded = r.stores.reduce((a, s) => a + s.excludedAlreadyInvoiced.count, 0)
    const idempotent = idempotentChunks(r)
    const billedVerb = r.dryRun ? 'Pedidos que se facturarían' : 'Pedidos facturados'
    const W = 26 // ancho de la etiqueta más larga del RESUMEN + 1 ("Ya facturados (excluidos)" = 25)

    const L: string[] = manualRerunSection(r, context)

    L.push(`Corrida ${r.runId} · Periodo ${periodIso(r)} (${kind})${sim} · Veredicto: ${r.summary.hasFailures ? 'REQUIERE ATENCIÓN' : 'OK'}`)
    L.push('')

    // RESUMEN
    L.push(RULE, 'RESUMEN', RULE)
    L.push(`${leader(billedVerb, W)}${totalBilled}   (en ${nCfdis} CFDI${nCfdis === 1 ? '' : 's'})`)
    L.push(`${leader('Excluidos por registro previo', W)}${totalExcluded}`)
    L.push(`${leader('Con error (revisar)', W)}${totalFailedOrders}`)
    if (totalBilled === 0 && idempotent > 0) {
        L.push('')
        L.push(`Alerta: ${idempotent} grupo(s) chocaron con un header existente; revisar pedidos pendientes.`)
    }
    L.push('')

    // Conciliación previa: decisiones sobre reservas de corridas anteriores.
    if (r.reconcile) {
        const decisions = r.reconcile.decisions
        L.push(RULE, 'CONCILIACIÓN', RULE)
        L.push(`Confirmados: ${decisions.filter((d) => d.decision === 'confirm').length}`)
        L.push(`Liberados: ${decisions.filter((d) => d.decision === 'release').length}`)
        const waiting = decisions.filter((d) => d.decision === 'wait')
        L.push(`En espera: ${waiting.length}`)
        for (const item of waiting) {
            L.push(`   • ${brandLabel(item.store)} / ${item.period} / ${item.bucket} / chunk ${item.chunkIndex}: ${item.reason}`)
        }
        const alerts = decisions.filter((d) => d.decision.startsWith('alert_'))
        for (const item of alerts) {
            L.push(`🔴 ALERTA ${item.decision}: ${brandLabel(item.store)} / ${item.period} / ${item.bucket} / chunk ${item.chunkIndex}: ${item.reason}`)
        }
        L.push(`Globales no explicadas del periodo: ${r.reconcile.unexplainedGlobalsInPeriod}`)
        for (const item of r.reconcile.unexplainedGlobals) {
            L.push(`ALERTA global no explicada: Id ${item.facturamaId} / ${item.serieFolio ?? 'sin serie/folio'} / Total ${item.total ?? 'sin dato'} / Date ${item.date ?? 'sin dato'}`)
        }
        if (alerts.length > 0) {
            L.push('   → Revisar los CFDI en Facturama y decidir la cancelación con contabilidad.')
        }
        if (r.reconcile.unexplainedGlobals.length > 0) {
            L.push('   • Identificar quién emitió cada global en Facturama antes de liberar reservas; decidir cancelación con contabilidad.')
        }
        L.push('')
    }

    L.push(RULE, 'VERIFICACIÓN POR PEDIDO EN FACTURAMA (SOLO INFORMATIVA)', RULE)
    for (const store of r.stores) {
        const check = store.orderCheck
        if (!check) continue
        if (check.unavailable) L.push(`${brandLabel(store.store)}: no disponible — ${check.unavailable}`)
        else if (check.truncated) L.push(`${brandLabel(store.store)}: verificación truncada; no se determinó presencia por pedido.`)
        else for (const result of check.results) {
            const location = result.foundIn.map(item => `${item.serieFolio ?? '(sin serie/folio)'} [${item.facturamaId}]`).join(', ')
            const reason = result.ambiguityReason === 'shared_tail'
                ? `: misma cola en ${result.sharedTailOrderCount} pedidos (posible devolución/cambio sobre el mismo ticket)`
                : result.ambiguityReason === 'multiple_globals' ? ': cola presente en varias globales' : ''
            L.push(`${brandLabel(store.store)} / ${result.reference}: ${result.ambiguous ? `AMBIGUO${reason}` : result.foundIn.length ? 'APARECE' : 'NO APARECE'}${location ? ` en ${location}` : ''}`)
        }
    }
    L.push('Esta verificación no liberó ni excluyó ningún pedido.', '')

    // FACTURADOS POR MARCA Y FORMA DE PAGO
    L.push(RULE, `${billedVerb.toUpperCase()} POR MARCA Y FORMA DE PAGO`, RULE)
    const billedBrands = billed.filter((b) => b.total > 0)
    if (billedBrands.length === 0) {
        L.push('(ninguno)')
    } else {
        for (const b of billedBrands) {
            L.push(`${leader(brandLabel(b.store), 24)}${b.total} pedido${b.total === 1 ? '' : 's'}`)
            L.push(`     ${bucketBreakdown(b.byBucket)}`)
        }
    }
    L.push('')

    // EXCLUIDOS POR REGISTRO PREVIO
    L.push(RULE, 'EXCLUIDOS POR REGISTRO PREVIO (no se re-facturaron)', RULE)
    if (totalExcluded === 0) {
        L.push('Ninguno.')
    } else {
        const per = r.stores
            .filter((s) => s.excludedAlreadyInvoiced.count > 0)
            .map((s) => `${brandShort(s.store)} ${s.excludedAlreadyInvoiced.count}`)
            .join(' · ')
        L.push(`Total ${totalExcluded}  ·  ${per}`)
    }
    L.push('')

    const blockedOrders = r.stores.flatMap((store) => store.excludedAlreadyInvoiced.orders
        .filter((order) => order.matchedBy === 'db_unresolved')
        .map((order) => ({ store: store.store, order })))
    const blockedHeaders = r.stores.flatMap((store) => store.unresolvedHeaders)
    if (blockedOrders.length > 0 || blockedHeaders.length > 0) {
        L.push(RULE, 'PEDIDOS BLOQUEADOS SIN CONFIRMAR TIMBRADO', RULE)
        for (const header of blockedHeaders) {
            L.push(`${brandLabel(header.storeName)} / ${BUCKET_LABELS[header.bucket]} / chunk ${header.chunkIndex} / ${header.status} / ${header.itemCount} pedido(s)`)
            if (header.status === 'pending' && header.itemCount === 0) {
                L.push('   → Si no hay filas en invoices con ese global_invoice_id, es seguro borrar el header pending manualmente.')
            }
        }
        for (const { store, order } of blockedOrders) {
            L.push(`${brandLabel(store)} / ${order.reference} / ${order.orderId} / db_unresolved`)
        }
        L.push('→ Conciliar en Facturama antes de liberar pedidos o membresías en la base de datos.')
        L.push('')
    }

    // ERRORES / CONCILIACIÓN
    L.push(RULE, 'ERRORES / CONCILIACIÓN', RULE)
    const rolled = fails.filter((f) => f.outcome === 'rolled_back')
    const rollbackFailed = fails.filter((f) => f.outcome === 'rollback_failed')
    const reservationFailed = fails.filter((f) => f.outcome === 'reservation_failed')
    const unconfirmed = fails.filter((f) => f.outcome === 'stamped_unconfirmed')
    const idempotentFailures = r.stores.flatMap((store) => store.buckets.flatMap((bucket) => bucket.chunks
        .filter((chunk) => chunk.outcome === 'skipped_idempotent' && chunk.itemCount > 0)
        .map((chunk) => ({ store: store.store, bucket: bucket.bucket, chunk }))))
    const unmappedStores = r.stores.filter((s) => s.unmapped.count > 0)
    const unaccountedStores = r.stores.filter((s) => s.unaccounted !== 0)
    let anyError = blockedOrders.length > 0 || blockedHeaders.length > 0
    if (idempotentFailures.length > 0) {
        anyError = true
        for (const { store, bucket, chunk } of idempotentFailures) {
            L.push(`🔴 ${brandLabel(store)} / ${BUCKET_LABELS[bucket]} / chunk ${chunk.chunkIndex}: ${chunk.itemCount} pedido(s) quedaron sin timbrar por colisión de header.`)
        }
        L.push('   → Revisar el header y las membresías antes de volver a ejecutar la corrida.')
    }
    if (rolled.length > 0) {
        anyError = true
        const n = rolled.reduce((a, f) => a + f.itemCount, 0)
        L.push(`🔴 ${n} pedido(s) NO se facturaron (${rolled.length} CFDI fallaron):`)
        for (const f of rolled) {
            L.push(`   • ${brandLabel(f.store)} / ${BUCKET_LABELS[f.bucket]} — ${f.itemCount} pedidos — "${f.error ?? 'error desconocido'}"`)
        }
        L.push('   → Revisar el rechazo en Facturama y corregirlo antes de reintentar.')
    }
    if (rollbackFailed.length > 0) {
        anyError = true
        const n = rollbackFailed.reduce((a, f) => a + f.itemCount, 0)
        L.push(`🔴 ${n} pedido(s) NO se facturaron; Facturama no timbró y falló el rollback:`)
        for (const f of rollbackFailed) {
            L.push(`   • ${brandLabel(f.store)} / ${BUCKET_LABELS[f.bucket]} — ${f.itemCount} pedidos — "${f.error ?? 'error desconocido'}"`)
        }
        L.push('   → Limpiar header y membresías en BD antes de reintentar.')
    }
    if (reservationFailed.length > 0) {
        anyError = true
        const n = reservationFailed.reduce((a, f) => a + f.itemCount, 0)
        L.push(`🔴 ${n} pedido(s) NO se facturaron; falló la reserva antes de llamar a Facturama:`)
        for (const f of reservationFailed) {
            L.push(`   • ${brandLabel(f.store)} / ${BUCKET_LABELS[f.bucket]} — ${f.itemCount} pedidos — "${f.error ?? 'error desconocido'}"`)
        }
        L.push('   → Se liberaron el header y las membresías; se puede reintentar tras corregir el error de BD.')
    }
    if (unconfirmed.length > 0) {
        anyError = true
        const n = unconfirmed.reduce((a, f) => a + f.itemCount, 0)
        L.push(`⚠ ${n} pedido(s) con timbrado SIN CONFIRMAR (pueden estar facturados; conciliar):`)
        for (const f of unconfirmed) {
            L.push(`   • ${brandLabel(f.store)} / ${BUCKET_LABELS[f.bucket]} — ${f.itemCount} pedidos — folio ${f.serieFolio ?? '(sin respuesta)'}`)
        }
        L.push('   → NO reintentar hasta verificar en Facturama y conciliar los CFDI con la base de datos.')
    }
    if (unmappedStores.length > 0) {
        anyError = true
        for (const s of unmappedStores) {
            L.push(`⛔ ${brandLabel(s.store)}: ${s.unmapped.count} sin clasificar (forma de pago no reconocida, NO facturados) → ${s.unmapped.orderIds.join(', ')}`)
        }
    }
    if (unaccountedStores.length > 0) {
        anyError = true
        for (const s of unaccountedStores) {
            L.push(`⛔ ${brandLabel(s.store)}: descuadre de conciliación (${s.unaccounted}) — revisar`)
        }
    }
    if (!anyError) L.push('Ninguno ✅')

    // ANOMALÍAS OPERATIVAS (no pagados / reembolsos totales) — solo si hay
    const unpaidStores = r.stores.filter((s) => s.skippedUnpaid.count > 0)
    const refundedStores = r.stores.filter((s) => s.skippedFullyRefunded.count > 0)
    if (unpaidStores.length > 0 || refundedStores.length > 0) {
        L.push('')
        L.push(RULE, 'ANOMALÍAS A REVISAR', RULE)
        for (const s of unpaidStores) {
            L.push(`⚠ ${brandLabel(s.store)} — No pagados: ${s.skippedUnpaid.count} → ${s.skippedUnpaid.orders.map((o) => `${o.reference} [${o.financialStatus}]`).join(', ')}`)
        }
        for (const s of refundedStores) {
            L.push(`ℹ ${brandLabel(s.store)} — Reembolsos totales (excluidos): ${s.skippedFullyRefunded.count} → ${s.skippedFullyRefunded.orders.map((o) => o.reference).join(', ')}`)
        }
    }

    // CFDIs EMITIDOS (auditoría — folio + UUID para localizar cada CFDI en Facturama)
    L.push('')
    L.push(RULE, `CFDIs ${r.dryRun ? 'QUE SE EMITIRÍAN' : 'EMITIDOS'} (para auditoría)`, RULE)
    if (cfdis.length === 0) {
        L.push('Ninguno.')
    } else {
        for (const c of cfdis) {
            L.push(`${brandLabel(c.store)} / ${BUCKET_LABELS[c.bucket]}  ${c.serieFolio ?? '(sin folio)'}  ${c.uuid ?? '(sin UUID)'}  ${c.itemCount} pedidos`)
        }
    }

    return L.join('\n')
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatGlobalRunReportEmail(r: GlobalRunReport, context?: RunReportEmailContext): RunReportEmail {
    const verdict = r.summary.hasFailures ? '🔴' : '✅'
    const sim = r.dryRun ? ' [SIMULACRO]' : ''
    const totalBilled = billedByBrand(r).reduce((a, b) => a + b.total, 0)
    const noun = r.dryRun ? 'por facturar' : (totalBilled === 1 ? 'facturado' : 'facturados')
    const subject = `${verdict} Facturación Global — ${periodHuman(r)}${sim} — ${totalBilled} pedido${totalBilled === 1 ? '' : 's'} ${noun}`
    const text = buildText(r, context)
    const color = r.summary.hasFailures ? '#b91c1c' : '#15803d'
    const html = [
        `<div style="font-family:system-ui,Arial,sans-serif">`,
        `<h2 style="color:${color};margin:0 0 8px">${verdict} Facturación Global — ${escapeHtml(periodHuman(r))}${sim}</h2>`,
        `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
        `</div>`,
    ].join('')
    return { subject, text, html }
}
