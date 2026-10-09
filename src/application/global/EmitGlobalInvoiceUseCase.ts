/**
 * EmitGlobalInvoiceUseCase — caso de uso de facturación global mensual.
 *
 * Orquesta el Paso 5 del plan de diseño (ver
 * ~/.claude/memorias/portal-facturacion_global-mensual_plan.md §6): por cada
 * tienda configurada, enumera TODO el mes, filtra elegibles, excluye lo ya
 * facturado (unión de todos los canales), agrupa por PaymentBucket, particiona
 * en chunks y timbra cada chunk de forma idempotente (insert-first + reap-lazy
 * + rollback), imitando el patrón ya maduro de EmitInvoiceUseCase.
 *
 * Devuelve Result<GlobalRunReport, GlobalRunError> — nunca lanza para control
 * de flujo. NO importa 'next' ni construye NextResponse; el disparador
 * HTTP/cron (Paso 6) es un detalle de `interface`.
 *
 * IMPORTANTE — dos espacios de nombres de "tienda" coexisten a propósito
 * (bug real detectado en dry-run contra la DB, 2026-07-10):
 *   - `store`/`brandKey`: la MARCA configurada (identifica las credenciales
 *     de Shopify — ver `storeNames`). Se usa para ENUMERAR (`MonthlyOrderSource`)
 *     y como `storeName` de la IDENTIDAD DEL HEADER (`global_invoices`,
 *     ver `identity` en `processChunk`) — esa tabla es nueva y autoconsistente,
 *     así que usar la marca ahí es correcto y no requiere cambios.
 *   - `order.storeName`: el nombre de SUCURSAL física normalizado por
 *     `normalizeOrder` (`physicalLocation?.name ?? brandKey`) — es el mismo
 *     valor que ya usa el flujo INDIVIDUAL al escribir `invoices.store_name`.
 * Las MEMBRESÍAS (`invoices` con `invoiceType='global'`) deben usar
 * `order.storeName` (sucursal), NUNCA el `brandKey`, porque el cerrojo
 * anti-doble-facturación es `UNIQUE(order_id, store_name)`: si la membresía
 * usara la marca en vez de la sucursal, un mismo pedido podría quedar
 * facturado dos veces (una fila individual con el nombre de sucursal + una
 * fila global con la clave de marca, ambas con el mismo `order_id`, sin
 * chocar). Ver también `DrizzleInvoicedOrdersGateway` — el canal de
 * exclusión por DB ya no filtra por `store_name` por la misma razón.
 */

import type { Order } from '../../domain/orders/Order'
import { buildOrderReference, receiptTail } from '../../domain/orders/OrderReference'
import { matchBlockedOrdersToGlobalItems } from '../../domain/global/matchBlockedOrdersToGlobalItems'
import { globalCorrelationKey } from '../../domain/global/globalCorrelationKey'
import type { BlockedOrderMatch, GlobalItems } from '../../domain/global/matchBlockedOrdersToGlobalItems'
import type { IssuedCfdiItemsLookup } from '../../domain/global/ports/IssuedCfdiItemsLookup'
import type { IssuedCfdiRef } from '../../domain/global/ports/IssuedCfdiLookup'
import { isDefinitiveStampRejection } from '../shared/isDefinitiveStampRejection'
import { StampPreparationError } from '../shared/StampPreparationError'
import type { GlobalPeriod } from '../../domain/global/GlobalPeriod'
import { createDailyGlobalPeriod, createGlobalPeriod } from '../../domain/global/GlobalPeriod'
import type { PaymentBucket } from '../../domain/global/PaymentBucket'
import type { GlobalInvoiceIdentity } from '../../domain/global/GlobalInvoice'
import type { NormalizedPayment } from '../../domain/global/PaymentBucketPolicy'
import { PaymentBucketPolicy } from '../../domain/global/PaymentBucketPolicy'
import { GlobalChunkPolicy } from '../../domain/global/GlobalChunkPolicy'
import type { MonthlyOrder, MonthlyOrderSource } from '../../domain/global/ports/MonthlyOrderSource'
import type { GlobalInvoiceStamping } from '../../domain/global/ports/GlobalInvoiceStamping'
import type { GlobalInvoiceRepository, UnresolvedGlobalHeader } from '../../domain/global/ports/GlobalInvoiceRepository'
import type { InvoicedOrdersGateway } from '../../domain/global/ports/InvoicedOrdersGateway'
import type { CreateInvoiceData } from '../../infrastructure/db/invoice-repository'
import type { Logger } from '../../domain/shared/ports/Logger'
import type { ReconcileReport } from './ReconcileGlobalStampsUseCase'
import { ok, err } from '../shared/Result'
import type { Result } from '../shared/Result'

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export interface EmitGlobalInvoiceInput {
  reconcile?: ReconcileReport
  runId?: string
  year: number
  month: number
  /**
   * Día del periodo — presente ⇒ corrida DIARIA (createDailyGlobalPeriod,
   * Periodicity '01'); ausente ⇒ corrida MENSUAL (createGlobalPeriod,
   * Periodicity '04', comportamiento histórico intacto).
   */
  day?: number
  /** Si se omite, se corre para TODAS las tiendas configuradas (deps.storeNames). */
  storeName?: string
  /** true → ejecuta enumeración/filtro/agrupación/chunking pero no escribe ni timbra. */
  dryRun?: boolean
}

// ─── Tipos de salida ──────────────────────────────────────────────────────────

export type GlobalRunErrorCode = 'VALIDATION_FAILED' | 'STORE_NOT_CONFIGURED'

export interface GlobalRunError {
  code: GlobalRunErrorCode
  message: string
}

export type ChunkOutcome =
  | 'emitted'
  | 'skipped_idempotent'
  | 'rolled_back'
  | 'rollback_failed'
  | 'reservation_failed'
  | 'stamped_unconfirmed'
  | 'empty'
  | 'dry_run'

export interface ChunkReport {
  chunkIndex: number
  itemCount: number
  outcome: ChunkOutcome
  uuid?: string
  serieFolio?: string
  error?: string
  /** Pedidos excluidos de ESTE chunk por perder la carrera del insert-first de membresía. */
  excludedByRace?: number
}

export interface BucketReport {
  bucket: PaymentBucket
  orders: number
  chunks: ChunkReport[]
}

export interface UnmappedReport {
  count: number
  orderIds: string[]
}

/** Identidad de auditoría de un pedido excluido por ya estar facturado (ver `excludeAlreadyInvoiced`). */
export interface ExcludedOrderIdentity {
  /** `order.id` de Shopify (gid). */
  orderId: string
  /** Referencia humana (`buildOrderReference`) — la que empata con el canal Facturama, ej. `"#1150 2-1244"`. */
  reference: string
  /** Canal que detectó la exclusión: `'db'` (match por `order.id`) o `'facturama'` (match por referencia). */
  matchedBy: 'db' | 'db_unresolved' | 'facturama'
}

/** Reporte estructurado de exclusión por ya-facturado — mismo patrón que `UnmappedReport`, con identidad para auditoría fiscal. */
export interface ExcludedAlreadyInvoicedReport {
  count: number
  orders: ExcludedOrderIdentity[]
}

/**
 * Identidad de auditoría de un pedido descartado en el filtro de elegibilidad.
 *
 * Motivación (2026-07-24): los filtros de "no pagado" y "reembolso total"
 * descartaban con un `continue` pelón — sin contador y sin identidad. El
 * síntoma fue un reporte que no concilia (Ariat día 23: 58 − 8 − 1 ≠ 47) y la
 * imposibilidad de responder QUÉ pedidos faltaban sin abrir Shopify a mano.
 */
export interface SkippedOrderIdentity {
  /** `order.id` de Shopify (gid). */
  orderId: string
  /** Referencia humana (`buildOrderReference`), ej. `"#1150 2-1244"`. */
  reference: string
  /** Estado de cobro que reportó Shopify en la corrida — el porqué del descarte. */
  financialStatus: string
}

export interface SkippedOrdersReport {
  count: number
  orders: SkippedOrderIdentity[]
}

/** Igual que `SkippedOrderIdentity`, con los montos que explican el reembolso total. */
export interface RefundedOrderIdentity extends SkippedOrderIdentity {
  total: number
  refundedAmount: number
}

export interface RefundedOrdersReport {
  count: number
  orders: RefundedOrderIdentity[]
}

export interface StoreReport {
  store: string
  orderCheck: OrderCheckReport
  enumerated: number
  eligible: number
  skippedNonPos: number
  partialRefunds: number
  /** Pedidos con total neto 0 (descuento 100%) — no facturables, excluidos antes de clasificar por bucket. */
  skippedZeroTotal: number
  /** Pedidos sin cobro efectivo (Shopify ≠ PAID / PARTIALLY_REFUNDED). */
  skippedUnpaid: SkippedOrdersReport
  /** Pedidos con reembolso TOTAL (`RefundPolicy.isFullyRefunded`). */
  skippedFullyRefunded: RefundedOrdersReport
  excludedAlreadyInvoiced: ExcludedAlreadyInvoicedReport
  unresolvedHeaders: UnresolvedGlobalHeader[]
  unmapped: UnmappedReport
  buckets: BucketReport[]
  /**
   * `enumerated` − (todos los descartes contados) − `eligible`. DEBE ser 0.
   *
   * Un valor ≠ 0 significa que existe un filtro que descarta SIN contar — el
   * defecto de 2026-07-24, cuya única señal era que la resta no daba y nadie
   * la hacía. Se reporta como número en vez de lanzar excepción para no
   * abortar una corrida fiscal por un descuadre de auditoría; la señal se
   * eleva por `summary.hasFailures`.
   */
  unaccounted: number
}

export interface OrderCheckReport {
  ran: boolean
  truncated: boolean
  checkedCfdis: number
  results: BlockedOrderMatch[]
  unavailable?: string
}

/**
 * Resumen agregado de la corrida — existe para que el disparador (cron) pueda
 * decidir éxito/fallo SIN recorrer el árbol store→bucket→chunk, y para que una
 * alerta pueda engancharse a un solo campo.
 *
 * Motivación (2026-07-22): una corrida con los 9 chunks en `rolled_back` viajó
 * dentro de un HTTP 200 y Railway la pintó verde. En facturación fiscal un
 * pedido sin timbrar es un hueco silencioso; `hasFailures` es la señal que lo
 * hace visible.
 */
export interface GlobalRunSummary {
  chunks: number
  emitted: number
  rolledBack: number
  rollbackFailed: number
  reservationFailed: number
  skippedIdempotent: number
  stampedUnconfirmed: number
  empty: number
  dryRun: number
  ordersEligible: number
  unresolvedOrders: number
  unresolvedHeaders: number
  unmapped: number
  /** Suma de `StoreReport.unaccounted`. Distinto de 0 ⇒ hay un filtro que descarta en silencio. */
  unaccounted: number
  /** Suma de `StoreReport.skippedUnpaid.count` — pedidos POS sin cobro efectivo (finanzas 2026-07-24: alerta). */
  skippedUnpaid:number
  orderCheckFound: number
  orderCheckNotFound: number
  orderCheckAmbiguous: number
  /**
   * true si la corrida dejó pedidos elegibles SIN facturar o en estado
   * inconsistente. Cinco causas, todas del mismo tipo (hueco fiscal que exige
   * intervención humana):
   *   - `rolledBack`         → Facturama rechazó el timbrado.
   *   - `stampedUnconfirmed` → el timbrado puede existir; conciliar antes de reintentar.
   *   - `unmapped`           → la forma de pago no se pudo clasificar, así que el
   *                            pedido nunca llegó a un bucket ni, por tanto, a un
   *                            CFDI (decisión 2026-07-23: el `unmapped` debe
   *                            alertar; antes era un hueco silencioso).
   *   - `unaccounted`        → el reporte no concilia: hay pedidos enumerados que
   *                            no aparecen ni como descarte contado ni como
   *                            elegibles (2026-07-24).
   *   - `skippedUnpaid`      → un pedido POS quedó sin cobro efectivo (PENDING,
   *                            etc.); debe revisarse (finanzas 2026-07-24: un POS
   *                            sin pagar es anomalía, no ruido).
   */
  hasFailures: boolean
}

export interface GlobalRunReport {
  reconcile?: ReconcileReport
  runId: string
  year: number
  month: number
  /** Día de la corrida cuando fue DIARIA; ausente en una corrida mensual. */
  day?: number
  dryRun: boolean
  summary: GlobalRunSummary
  stores: StoreReport[]
}

/** Recorre el árbol store→bucket→chunk y agrega los contadores de la corrida. */
function computeSummary(stores: StoreReport[]): GlobalRunSummary {
  const s: GlobalRunSummary = {
    chunks: 0, emitted: 0, rolledBack: 0, rollbackFailed: 0, reservationFailed: 0, skippedIdempotent: 0,
    stampedUnconfirmed: 0, empty: 0, dryRun: 0,
    ordersEligible: 0, unresolvedOrders: 0, unresolvedHeaders: 0, unmapped: 0, unaccounted: 0, skippedUnpaid: 0,
    orderCheckFound: 0, orderCheckNotFound: 0, orderCheckAmbiguous: 0, hasFailures: false,
  }

  for (const store of stores) {
    if (!store.orderCheck.unavailable && !store.orderCheck.truncated) {
      for (const result of store.orderCheck.results) {
        if (result.ambiguous) s.orderCheckAmbiguous++
        else if (result.foundIn.length > 0) s.orderCheckFound++
        else s.orderCheckNotFound++
      }
    }
    s.ordersEligible += store.eligible
    s.unresolvedOrders += store.excludedAlreadyInvoiced.orders.filter((order) => order.matchedBy === 'db_unresolved').length
    s.unresolvedHeaders += store.unresolvedHeaders.length
    s.unmapped += store.unmapped.count
    s.unaccounted += store.unaccounted
    s.skippedUnpaid += store.skippedUnpaid.count
    for (const bucket of store.buckets) {
      for (const chunk of bucket.chunks) {
        s.chunks++
        switch (chunk.outcome) {
          case 'emitted': s.emitted++; break
          case 'rolled_back': s.rolledBack++; break
          case 'rollback_failed': s.rollbackFailed++; break
          case 'reservation_failed': s.reservationFailed++; break
          case 'skipped_idempotent': s.skippedIdempotent++; break
          case 'stamped_unconfirmed': s.stampedUnconfirmed++; break
          case 'empty': s.empty++; break
          case 'dry_run': s.dryRun++; break
        }
      }
    }
  }

  s.hasFailures = s.rolledBack > 0 || s.rollbackFailed > 0 || s.reservationFailed > 0 || s.skippedIdempotent > 0 || s.stampedUnconfirmed > 0 || s.unmapped > 0 || s.unaccounted !== 0 || s.skippedUnpaid > 0 || s.unresolvedOrders > 0 || s.unresolvedHeaders > 0
  return s
}

// ─── Ports mínimos requeridos por este caso de uso ────────────────────────────

export interface RefundPolicyPort {
  isFullyRefunded(order: Order): boolean
}

/** Puerto mínimo de membresías (una fila `invoices` por pedido de la global). */
export interface GlobalMembershipRepo {
  createInvoice(data: CreateInvoiceData): Promise<
    | { created: true; invoice: { id: string } }
    | { created: false; reason: string }
  >
  /** Rollback: borra todas las membresías de un CFDI global (ver §6.e). */
  deleteByGlobalInvoiceId(globalInvoiceId: string): Promise<void>
}

export interface PaymentBucketClassifier {
  classify(payments: readonly NormalizedPayment[]): PaymentBucket | 'unmapped'
}

export interface ChunkPolicyPort {
  chunk<T>(items: readonly T[], maxPerChunk: number): T[][]
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface EmitGlobalInvoiceDeps {
  issuedCfdiItemsLookup?: IssuedCfdiItemsLookup
  orderCheckMaxCfdis?: number
  orderCheckBudgetMs?: number
  monthlyOrderSource: MonthlyOrderSource
  globalStamping: GlobalInvoiceStamping
  globalRepo: GlobalInvoiceRepository
  invoiceRepo: GlobalMembershipRepo
  invoicedOrdersGateways: InvoicedOrdersGateway[]
  refundPolicy: RefundPolicyPort
  /** Tiendas/marcas configuradas — la application NO lee config, la recibe inyectada. */
  storeNames: string[]
  paymentBucketPolicy?: PaymentBucketClassifier
  chunkPolicy?: ChunkPolicyPort
  /** Tope de conceptos por CFDI global. Default: 250 (ver plan §7). */
  maxItemsPerChunk?: number
  /** Minutos de antigüedad tras los cuales un header 'pending' se considera huérfano. Default: 10. */
  /** Reloj inyectable — permite testear el TTL sin esperar minutos reales. Default: () => new Date(). */
  now?: () => Date
  /** uuid de la corrida — inyectable para tests deterministas. Default: crypto.randomUUID(). */
  runId?: string
  /** Adapter de logging estructurado. Default: console (comportamiento previo al puerto). */
  logger?: Logger
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITEMS_PER_CHUNK = 250

/**
 * Logger por defecto cuando no se inyecta uno (tests, o un composition root que
 * lo omita). Preserva EXACTAMENTE el comportamiento previo a la introducción del
 * puerto — escribir a console — para que no haya regresión silenciosa de trazas
 * si alguien construye el use case sin adapter. Producción inyecta pino.
 */
const CONSOLE_LOGGER: Logger = {
  info: (fields, msg) => console.log(msg, fields),
  warn: (fields, msg) => console.warn(msg, fields),
  error: (fields, msg) => console.error(msg, fields),
}

/** Estados de Shopify que representan un cobro efectivamente realizado (ver §b arriba). */
const PAID_LIKE_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED'])

export class EmitGlobalInvoiceUseCase {
  private readonly paymentBucketPolicy: PaymentBucketClassifier
  private readonly chunkPolicy: ChunkPolicyPort
  private readonly maxItemsPerChunk: number
  private readonly now: () => Date
  private readonly runId: string
  private readonly logger: Logger

  constructor(private readonly deps: EmitGlobalInvoiceDeps) {
    this.paymentBucketPolicy = deps.paymentBucketPolicy ?? PaymentBucketPolicy
    this.chunkPolicy = deps.chunkPolicy ?? GlobalChunkPolicy
    this.maxItemsPerChunk = deps.maxItemsPerChunk ?? DEFAULT_MAX_ITEMS_PER_CHUNK
    this.now = deps.now ?? (() => new Date())
    this.runId = deps.runId ?? crypto.randomUUID()
    this.logger = deps.logger ?? CONSOLE_LOGGER
  }

  async execute(input: EmitGlobalInvoiceInput): Promise<Result<GlobalRunReport, GlobalRunError>> {
    const { year, month, day, storeName, dryRun = false } = input
    const runId = input.runId ?? this.runId

    let period: GlobalPeriod
    try {
      period = day !== undefined ? createDailyGlobalPeriod(year, month, day) : createGlobalPeriod(year, month)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      return err({ code: 'VALIDATION_FAILED', message })
    }

    if (storeName && !this.deps.storeNames.includes(storeName)) {
      return err({
        code: 'STORE_NOT_CONFIGURED',
        message: `La tienda "${storeName}" no está configurada para la facturación global.`,
      })
    }

    const targetStores = storeName ? [storeName] : this.deps.storeNames
    if (targetStores.length === 0) {
      return err({ code: 'STORE_NOT_CONFIGURED', message: 'No hay tiendas configuradas para la facturación global.' })
    }

    this.logger.info({ runId, year, month, day, stores: targetStores, dryRun }, '[global-invoice] inicio de corrida')

    const stores: StoreReport[] = []
    const itemCache = new Map<string, Promise<string[]>>()
    const orderCheckDeadline = Date.now() + (this.deps.orderCheckBudgetMs ?? 30000)
    for (const store of targetStores) {
      stores.push(await this.runStore(store, period, dryRun, runId, input.reconcile, itemCache, orderCheckDeadline))
    }

    const summary = computeSummary(stores)

    this.logger.info({ runId, year, month, day, summary }, '[global-invoice] fin de corrida')

    return ok({ runId, year, month, day: period.day, dryRun, summary, stores })
  }

  // ── Por tienda ────────────────────────────────────────────────────────────

  private async runStore(store: string, period: GlobalPeriod, dryRun: boolean, runId: string, reconcile: ReconcileReport | undefined, itemCache: Map<string, Promise<string[]>>, orderCheckDeadline: number): Promise<StoreReport> {
    const monthlyOrders = await this.enumerateAll(store, period)

    let skippedNonPos = 0
    let partialRefunds = 0
    let skippedZeroTotal = 0
    const skippedUnpaid: SkippedOrderIdentity[] = []
    const skippedFullyRefunded: RefundedOrderIdentity[] = []
    const eligible: MonthlyOrder[] = []

    for (const monthlyOrder of monthlyOrders) {
      const { order } = monthlyOrder

      // (a) SOLO pedidos POS.
      if (!order.sourceIdentifier) {
        skippedNonPos++
        continue
      }

      // (b) Excluir totalmente reembolsados. Va ANTES del filtro de cobro
      // porque Shopify marca el reembolso total como financialStatus
      // 'REFUNDED', que NO es PAID-like: si el orden fuera el inverso, un
      // reembolso se reportaría como "no pagado". Eso es lo que restaura el
      // invariante que el comentario de (c) siempre declaró — que
      // `RefundPolicy.isFullyRefunded` sea el ÚNICO filtro que excluye por
      // reembolso (2026-07-24: la implementación se había desviado del diseño
      // documentado, y el descarte silencioso lo mantuvo invisible).
      if (this.deps.refundPolicy.isFullyRefunded(order)) {
        skippedFullyRefunded.push({
          orderId: order.id,
          reference: buildOrderReference(order.orderNumber, order.sourceIdentifier ?? null),
          financialStatus: order.financialStatus,
          total: order.total,
          refundedAmount: order.refundedAmount,
        })
        continue
      }

      // (c) Solo pagados. Shopify marca un pedido con reembolso PARCIAL como
      // displayFinancialStatus='PARTIALLY_REFUNDED' (no 'PAID') aunque el
      // cobro original sí se realizó — por eso el filtro acepta ambos, para
      // que un reembolso parcial (D2: se incluye al neto) no caiga fuera del
      // filtro de "pagado". Lo que llega aquí y no es PAID-like es un pedido
      // sin cobro efectivo (PENDING, AUTHORIZED, EXPIRED, VOIDED…).
      if (!PAID_LIKE_STATUSES.has(order.financialStatus)) {
        skippedUnpaid.push({
          orderId: order.id,
          reference: buildOrderReference(order.orderNumber, order.sourceIdentifier ?? null),
          financialStatus: order.financialStatus,
        })
        continue
      }

      // (d) Excluir pedidos con TOTAL neto 0 (descuento 100%) — no
      // facturables (finanzas 2026-07-10). Se evalúa ANTES de agrupar por
      // bucket para que un pedido $0 sin transacciones de pago no contamine
      // 'unmapped' (que debe seguir siendo un canal de alerta real: un
      // pedido con total > 0 y sin pagos SÍ debe caer ahí como anomalía).
      if (order.total === 0) {
        skippedZeroTotal++
        continue
      }

      // TODO(D2): reembolso PARCIAL se incluye tal cual viene de Shopify (sin
      // recalcular al neto) — pendiente de decisión fiscal del contador sobre
      // el tratamiento exacto. Se cuenta para observabilidad.
      if (order.refundedAmount > 0) partialRefunds++

      eligible.push(monthlyOrder)
    }

    const { survivors, excludedAlreadyInvoiced } = await this.excludeAlreadyInvoiced(store, period, eligible)
    const blocked = eligible.filter(({ order }) => excludedAlreadyInvoiced.orders.some(excluded => excluded.orderId === order.id && excluded.matchedBy === 'db_unresolved'))
      .map(({ order }) => ({ orderId: order.id, reference: buildOrderReference(order.orderNumber, order.sourceIdentifier ?? null), tail: order.sourceIdentifier?.trim() ? receiptTail(order.sourceIdentifier) : order.orderNumber }))
    const unresolvedHeaders = await this.deps.globalRepo.listUnresolvedHeaders(store, period.year, period.month, period.day)
    if (unresolvedHeaders.length > 0 || excludedAlreadyInvoiced.orders.some((order) => order.matchedBy === 'db_unresolved')) {
      this.logger.error({ runId, store, unresolvedHeaders, unresolvedOrderIds: excludedAlreadyInvoiced.orders.filter((order) => order.matchedBy === 'db_unresolved').map((order) => order.orderId) }, '[global-invoice] pedidos bloqueados sin confirmar timbrado')
    }
    const { buckets, unmapped } = this.groupByBucket(survivors)

    const unaccounted =
      monthlyOrders.length
      - skippedNonPos
      - skippedUnpaid.length
      - skippedFullyRefunded.length
      - skippedZeroTotal
      - eligible.length

    this.logger.info({
      runId, store, day: period.day, enumerated: monthlyOrders.length, eligible: eligible.length,
      skippedNonPos, partialRefunds, skippedZeroTotal,
      skippedUnpaid: skippedUnpaid.length,
      skippedUnpaidOrders: skippedUnpaid,
      skippedFullyRefunded: skippedFullyRefunded.length,
      skippedFullyRefundedOrders: skippedFullyRefunded,
      excludedAlreadyInvoiced: excludedAlreadyInvoiced.count,
      excludedAlreadyInvoicedOrders: excludedAlreadyInvoiced.orders,
      unmapped: unmapped.length,
      unaccounted,
    }, '[global-invoice] tienda enumerada')

    // El reporte de la global es un documento de conciliación: todo pedido
    // enumerado debe terminar en exactamente una casilla. Si esta resta no da
    // cero hay un filtro que descarta sin contar, y el reporte deja de servir
    // como evidencia ante contabilidad.
    if (unaccounted !== 0) {
      this.logger.error({
        runId, store, day: period.day, unaccounted, enumerated: monthlyOrders.length,
      }, '[global-invoice] el reporte NO concilia — hay un filtro que descarta sin contar')
    }

    // Un pedido `unmapped` es un HUECO FISCAL, no una curiosidad: su gateway de
    // pago no se pudo clasificar en ningún bucket, así que NUNCA llega a un CFDI
    // — ni global (no tiene bucket) ni individual (el cliente no lo pidió). Se
    // logea a nivel error, con identidad, para que sea accionable sin abrir el
    // reporte; `summary.hasFailures` lo eleva además al status HTTP de la corrida.
    if (unmapped.length > 0) {
      this.logger.error({
        runId, store, day: period.day, count: unmapped.length,
        orderIds: unmapped.map((m) => m.order.id),
        references: unmapped.map((m) => buildOrderReference(m.order.orderNumber, m.order.sourceIdentifier ?? null)),
      }, '[global-invoice] pedidos con forma de pago NO clasificable — no se facturarán')
    }

    const bucketReports: BucketReport[] = []
    for (const [bucket, bucketOrders] of buckets) {
      bucketReports.push(await this.runBucket(store, period, bucket, bucketOrders, dryRun, runId))
    }
    const orderCheck = await this.checkBlockedOrders(blocked, reconcile, period, runId, store, itemCache, orderCheckDeadline)

    return {
      store,
      orderCheck,
      enumerated: monthlyOrders.length,
      eligible: eligible.length,
      skippedNonPos,
      partialRefunds,
      skippedZeroTotal,
      skippedUnpaid: { count: skippedUnpaid.length, orders: skippedUnpaid },
      skippedFullyRefunded: { count: skippedFullyRefunded.length, orders: skippedFullyRefunded },
      excludedAlreadyInvoiced,
      unresolvedHeaders,
      unmapped: { count: unmapped.length, orderIds: unmapped.map((mo) => mo.order.id) },
      buckets: bucketReports,
      unaccounted,
    }
  }

  private async enumerateAll(store: string, period: GlobalPeriod): Promise<MonthlyOrder[]> {
    const { from, to } = period.rangeMx()
    const all: MonthlyOrder[] = []
    let cursor: string | null = null
    do {
      const page = await this.deps.monthlyOrderSource.listOrdersInRange({ brandKey: store, from, to, cursor })
      all.push(...page.orders)
      cursor = page.nextCursor
    } while (cursor !== null)
    return all
  }

  /**
   * Excluye la UNIÓN de todos los invoicedOrdersGateways — por id O por
   * referencia. Registra la identidad de auditoría (order.id + referencia
   * humana) de cada excluido y el canal que lo detectó, para poder confirmar
   * en auditoría fiscal QUÉ pedidos se excluyeron y por qué (ver
   * InvoicedOrdersGateway: `orderIds` es el canal DB, `orderReferences` el
   * canal Facturama).
   */
  private async excludeAlreadyInvoiced(
    store: string,
    period: GlobalPeriod,
    candidates: MonthlyOrder[],
  ): Promise<{ survivors: MonthlyOrder[]; excludedAlreadyInvoiced: ExcludedAlreadyInvoicedReport }> {
    const orderIds = new Set<string>()
    const unresolvedOrderIds = new Set<string>()
    const orderReferences = new Set<string>()
    for (const gateway of this.deps.invoicedOrdersGateways) {
      const keys = await gateway.listInvoicedOrderKeys(store, period)
      for (const id of keys.orderIds) orderIds.add(id)
      for (const id of keys.unresolvedOrderIds) unresolvedOrderIds.add(id)
      for (const reference of keys.orderReferences) orderReferences.add(reference)
    }

    const survivors: MonthlyOrder[] = []
    const excludedOrders: ExcludedOrderIdentity[] = []
    for (const monthlyOrder of candidates) {
      const { order } = monthlyOrder
      const reference = buildOrderReference(order.orderNumber, order.sourceIdentifier ?? null)
      const matchedById = orderIds.has(order.id)
      const matchedByReference = orderReferences.has(reference)
      if (matchedById || matchedByReference) {
        excludedOrders.push({ orderId: order.id, reference, matchedBy: unresolvedOrderIds.has(order.id) ? 'db_unresolved' : matchedById ? 'db' : 'facturama' })
        continue
      }
      survivors.push(monthlyOrder)
    }
    return { survivors, excludedAlreadyInvoiced: { count: excludedOrders.length, orders: excludedOrders } }
  }

  private groupByBucket(
    orders: MonthlyOrder[],
  ): { buckets: Map<PaymentBucket, MonthlyOrder[]>; unmapped: MonthlyOrder[] } {
    const buckets = new Map<PaymentBucket, MonthlyOrder[]>()
    const unmapped: MonthlyOrder[] = []
    for (const monthlyOrder of orders) {
      const classification = this.paymentBucketPolicy.classify(monthlyOrder.payments)
      if (classification === 'unmapped') {
        unmapped.push(monthlyOrder)
        continue
      }
      const bucketOrders = buckets.get(classification) ?? []
      bucketOrders.push(monthlyOrder)
      buckets.set(classification, bucketOrders)
    }
    return { buckets, unmapped }
  }

  // ── Por bucket / chunk ──────────────────────────────────────────────────────

  private async runBucket(
    store: string,
    period: GlobalPeriod,
    bucket: PaymentBucket,
    bucketOrders: MonthlyOrder[],
    dryRun: boolean,
    runId: string,
  ): Promise<BucketReport> {
    const chunks = this.chunkPolicy.chunk(bucketOrders, this.maxItemsPerChunk)
    const firstChunkIndex = dryRun ? 0 : await this.deps.globalRepo.nextChunkIndex(store, period.year, period.month, period.day, bucket)

    const chunkReports: ChunkReport[] = []
    for (let offset = 0; offset < chunks.length; offset++) {
      const chunkIndex = firstChunkIndex + offset
      const chunkOrders = chunks[offset]
      const chunkReport = dryRun
        ? { chunkIndex, itemCount: chunkOrders.length, outcome: 'dry_run' as const }
        : await this.processChunk(store, period, bucket, chunkIndex, chunkOrders, runId)
      chunkReports.push(chunkReport)
    }

    return { bucket, orders: bucketOrders.length, chunks: chunkReports }
  }

  /**
   * Procesa un chunk de forma idempotente: insert-first del header,
   * insert-first por-fila de membresías (excluyendo
   * SOLO los pedidos que pierden la carrera), timbrado, y rollback/marca de
   * stamped_unconfirmed antes de llamar a Facturama y ante respuesta incierta.
   */
  private async processChunk(
    store: string,
    period: GlobalPeriod,
    bucket: PaymentBucket,
    chunkIndex: number,
    chunkOrders: MonthlyOrder[],
    runId: string,
  ): Promise<ChunkReport> {
    // Identidad del HEADER = clave de marca (`store`/brandKey) — ver docstring
    // de cabecera del archivo. `global_invoices` es una tabla nueva y
    // autoconsistente; la idempotencia (marca, periodo, bucket, chunk) es
    // correcta usando la marca aquí.
    const identity: GlobalInvoiceIdentity = {
      storeName: store,
      periodYear: period.year,
      periodMonth: period.month,
      periodDay: period.day,
      paymentBucket: bucket,
      chunkIndex,
    }

    const header = await this.deps.globalRepo.createGlobalHeader(identity)
    if (!header.created) {
      this.logger.error({ runId, store, bucket, chunkIndex, itemCount: chunkOrders.length }, '[global-invoice] colisión de header: pedidos sin timbrar; revisar corrida concurrente')
      return { chunkIndex, itemCount: chunkOrders.length, outcome: 'skipped_idempotent' }
    }
    const headerId = header.header.id

    // Insert-first por-fila de membresías: un pedido que choca (lo facturó
    // otro proceso entre la exclusión y ahora) se EXCLUYE del chunk, no aborta.
    const survivors: MonthlyOrder[] = []
    let excludedByRace = 0
    for (const monthlyOrder of chunkOrders) {
      // storeName de la MEMBRESÍA = sucursal normalizada del pedido (NO la
      // marca) para que choque con `UNIQUE(order_id, store_name)` contra una
      // fila individual del mismo pedido — ver docstring de cabecera.
      const membershipData: CreateInvoiceData = {
        orderId: monthlyOrder.order.id,
        orderNumber: monthlyOrder.order.orderNumber,
        storeName: monthlyOrder.order.storeName,
        status: 'pending',
        invoiceType: 'global',
        paymentType: bucket,
        globalInvoiceId: headerId,
      }
      let membership: Awaited<ReturnType<GlobalMembershipRepo['createInvoice']>>
      try {
        membership = await this.deps.invoiceRepo.createInvoice(membershipData)
      } catch (insertErr: unknown) {
        const message = insertErr instanceof Error ? insertErr.message : String(insertErr)
        this.logger.error({ runId, headerId, store, bucket, chunkIndex, error: message }, '[global-invoice] Falló la inserción de membresía antes de llamar a Facturama')
        const rolledBack = await this.rollbackChunk(headerId, runId)
        return {
          chunkIndex, itemCount: chunkOrders.length,
          outcome: rolledBack ? 'reservation_failed' : 'rollback_failed',
          error: rolledBack
            ? `${message}; se liberaron el header y las membresías parciales`
            : `${message}; no se pudo confirmar la limpieza en la base de datos`,
          excludedByRace,
        }
      }
      if (membership.created) {
        survivors.push(monthlyOrder)
      } else {
        excludedByRace++
      }
    }

    if (survivors.length === 0) {
      try {
        await this.deps.globalRepo.deleteGlobalHeader(headerId)
      } catch (deleteErr: unknown) {
        const message = deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
        this.logger.error({ runId, headerId, store, bucket, chunkIndex, itemCount: chunkOrders.length, error: message }, '[global-invoice] No se pudo borrar el header vacío; queda pending y requiere conciliación')
        return {
          chunkIndex, itemCount: 0, outcome: 'rollback_failed', excludedByRace,
          error: `${message}; el header vacío quedó pending y requiere conciliación (se reportará como no resuelto en la siguiente corrida)`,
        }
      }
      this.logger.info({ runId, store, day: period.day, bucket, chunkIndex }, '[global-invoice] chunk vacío tras insert-first, header borrado')
      return { chunkIndex, itemCount: 0, outcome: 'empty', excludedByRace }
    }

    // Antes de llamar al PAC, cerrar la ventana en la que un crash dejaría
    // un header pending reapeable aunque Facturama ya hubiera timbrado.
    try {
      await this.deps.globalRepo.updateGlobalStamp(headerId, { status: 'stamped_unconfirmed' })
    } catch (markErr: unknown) {
      const message = markErr instanceof Error ? markErr.message : String(markErr)
      this.logger.error({ runId, headerId, store, bucket, chunkIndex, error: message }, '[global-invoice] No se pudo reservar el intento de timbrado; Facturama no fue llamado')
      const rolledBack = await this.rollbackChunk(headerId, runId)
      return {
        chunkIndex, itemCount: survivors.length,
        outcome: rolledBack ? 'reservation_failed' : 'rollback_failed',
        error: rolledBack
          ? `${message}; se liberaron el header y las membresías`
          : `${message}; no se pudo confirmar la limpieza en la base de datos`,
        excludedByRace,
      }
    }

    let stampResult
    const stampStartedAt = Date.now()
    try {
      stampResult = await this.deps.globalStamping.emitirGlobal({
        correlationKey: globalCorrelationKey(headerId),
        storeName: store,
        periodYear: period.year,
        periodMonth: period.month,
        periodDay: period.day,
        paymentBucket: bucket,
        itemCount: survivors.length,
        orders: survivors,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      const durationMs = Date.now() - stampStartedAt
      if (e instanceof StampPreparationError || isDefinitiveStampRejection(e)) {
        this.logger.error({ runId, store, day: period.day, bucket, chunkIndex, error: message, durationMs }, e instanceof StampPreparationError
          ? '[global-invoice] Facturama no fue llamado, rollback'
          : '[global-invoice] Facturama rechazó el CFDI, rollback')
        const rolledBack = await this.rollbackChunk(headerId, runId)
        return {
          chunkIndex, itemCount: survivors.length,
          outcome: rolledBack ? 'rolled_back' : 'rollback_failed',
          error: rolledBack ? message : `${message}; no se pudo confirmar la limpieza en la base de datos`,
          excludedByRace,
        }
      }
      this.logger.error({ runId, headerId, store, day: period.day, bucket, chunkIndex, error: message, durationMs }, '[global-invoice] Resultado del timbrado incierto; conciliar con Facturama antes de reintentar')
      return { chunkIndex, itemCount: survivors.length, outcome: 'stamped_unconfirmed', error: message, excludedByRace }
    }

    try {
      await this.deps.globalRepo.updateGlobalStamp(headerId, {
        status: 'emitted',
        facturamaId: stampResult.facturamaId,
        uuidCfdi: stampResult.uuidCfdi,
        itemCount: survivors.length,
      })
    } catch (dbErr: unknown) {
      const dbMessage = dbErr instanceof Error ? dbErr.message : String(dbErr)
      this.logger.error({
        runId, headerId, error: dbMessage,
      }, '[global-invoice] CFDI global timbrado pero no se pudo actualizar el header (conciliar)')
      try {
        await this.deps.globalRepo.updateGlobalStamp(headerId, {
          status: 'stamped_unconfirmed', facturamaId: stampResult.facturamaId,
          uuidCfdi: stampResult.uuidCfdi, itemCount: survivors.length,
        })
      } catch (markErr: unknown) {
        const markMessage = markErr instanceof Error ? markErr.message : String(markErr)
        this.logger.error({
          runId, headerId, error: markMessage,
        }, '[global-invoice] No se pudo marcar el header como stamped_unconfirmed (conciliar manualmente)')
      }
      return {
        chunkIndex, itemCount: survivors.length, outcome: 'stamped_unconfirmed', uuid: stampResult.uuidCfdi, serieFolio: stampResult.serieFolio, excludedByRace,
      }
    }

    this.logger.info({
      runId, store, day: period.day, bucket, chunkIndex, uuid: stampResult.uuidCfdi, serieFolio: stampResult.serieFolio, itemCount: survivors.length, durationMs: Date.now() - stampStartedAt,
    }, '[global-invoice] chunk timbrado')
    return { chunkIndex, itemCount: survivors.length, outcome: 'emitted', uuid: stampResult.uuidCfdi, serieFolio: stampResult.serieFolio, excludedByRace }
  }

  /** Rollback antes de llamar a Facturama o tras rechazo definitivo; nunca para resultado incierto. */
  private async rollbackChunk(headerId: string, runId: string): Promise<boolean> {
    let completed = true
    try {
      await this.deps.invoiceRepo.deleteByGlobalInvoiceId(headerId)
    } catch (delErr: unknown) {
      completed = false
      const message = delErr instanceof Error ? delErr.message : String(delErr)
      this.logger.error({ runId, headerId, error: message }, '[global-invoice] rollback: no se pudieron borrar las membresías')
    }
    try {
      await this.deps.globalRepo.deleteGlobalHeader(headerId)
    } catch (delErr: unknown) {
      completed = false
      const message = delErr instanceof Error ? delErr.message : String(delErr)
      this.logger.error({ runId, headerId, error: message }, '[global-invoice] rollback: no se pudo borrar el header')
    }
    return completed
  }

  private async checkBlockedOrders(
    blocked: { orderId: string; reference: string; tail: string }[],
    reconcile: ReconcileReport | undefined,
    period: GlobalPeriod,
    runId: string,
    store: string,
    cache: Map<string, Promise<string[]>>,
    deadline: number,
  ): Promise<OrderCheckReport> {
    const empty: OrderCheckReport = { ran: false, truncated: false, checkedCfdis: 0, results: [] }
    if (blocked.length === 0 && !reconcile?.unexplainedGlobalsInPeriod) return empty
    if (!reconcile || reconcile.failed) return { ...empty, unavailable: 'Conciliación de Facturama no disponible' }
    if (!this.deps.issuedCfdiItemsLookup) return { ...empty, unavailable: 'Consulta de conceptos de Facturama no configurada' }

    const prefix = `${period.year}-${String(period.month).padStart(2, '0')}`
    const inPeriod = (item: IssuedCfdiRef) => !item.date || item.date.startsWith(prefix)
    const candidates = [
      ...reconcile.unexplainedGlobals.filter(inPeriod),
      ...reconcile.decisions.flatMap(decision => decision.matches.filter(item => item.orderNumber?.startsWith('GLB:') && inPeriod(item))),
    ].filter(item => item.active && item.rfc === 'XAXX010101000')
    const unique = [...new Map(candidates.map(item => [item.facturamaId, item])).values()]
    const max = this.deps.orderCheckMaxCfdis ?? 30
    if (new Set([...cache.keys(), ...unique.map(item => item.facturamaId)]).size > max) {
      this.logger.warn({ runId, store, candidates: unique.length, max }, '[global-order-check] verificación truncada por tope de CFDI')
      return { ran: true, truncated: true, checkedCfdis: 0, results: [] }
    }

    const globals: GlobalItems[] = []
    try {
      for (const candidate of unique) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          this.logger.warn({ runId, store, checkedCfdis: globals.length }, '[global-order-check] presupuesto de tiempo agotado')
          return { ran: true, truncated: true, checkedCfdis: globals.length, results: [] }
        }
        let items = cache.get(candidate.facturamaId)
        if (!items) {
          items = this.deps.issuedCfdiItemsLookup.getItems(candidate.facturamaId)
          cache.set(candidate.facturamaId, items)
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), remaining) })
        let found: string[] | undefined
        try {
          found = await Promise.race([items, timeout])
        } finally {
          if (timer) clearTimeout(timer)
        }
        if (!found) {
          this.logger.warn({ runId, store, checkedCfdis: globals.length }, '[global-order-check] presupuesto de tiempo agotado')
          return { ran: true, truncated: true, checkedCfdis: globals.length, results: [] }
        }
        globals.push({ facturamaId: candidate.facturamaId, serieFolio: candidate.serieFolio, items: found })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error({ runId, store, checkedCfdis: globals.length, error: message }, '[global-order-check] consulta de conceptos no disponible')
      return { ran: true, truncated: false, checkedCfdis: globals.length, results: [], unavailable: message }
    }
    const results = matchBlockedOrdersToGlobalItems(blocked, globals)
    this.logger.info({ runId, store, checkedCfdis: globals.length, blockedOrders: blocked.length, found: results.filter(item => item.foundIn.length > 0).length }, '[global-order-check] verificación informativa completada')
    return { ran: true, truncated: false, checkedCfdis: globals.length, results }
  }
}
