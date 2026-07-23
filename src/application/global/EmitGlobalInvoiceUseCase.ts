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
import { buildOrderReference } from '../../domain/orders/OrderReference'
import type { GlobalPeriod } from '../../domain/global/GlobalPeriod'
import { createDailyGlobalPeriod, createGlobalPeriod } from '../../domain/global/GlobalPeriod'
import type { PaymentBucket } from '../../domain/global/PaymentBucket'
import type { GlobalInvoiceIdentity } from '../../domain/global/GlobalInvoice'
import type { NormalizedPayment } from '../../domain/global/PaymentBucketPolicy'
import { PaymentBucketPolicy } from '../../domain/global/PaymentBucketPolicy'
import { GlobalChunkPolicy } from '../../domain/global/GlobalChunkPolicy'
import type { MonthlyOrder, MonthlyOrderSource } from '../../domain/global/ports/MonthlyOrderSource'
import type { GlobalInvoiceStamping } from '../../domain/global/ports/GlobalInvoiceStamping'
import type { GlobalInvoiceRepository } from '../../domain/global/ports/GlobalInvoiceRepository'
import type { InvoicedOrdersGateway } from '../../domain/global/ports/InvoicedOrdersGateway'
import type { CreateInvoiceData } from '../../infrastructure/db/invoice-repository'
import type { Logger } from '../../domain/shared/ports/Logger'
import { ok, err } from '../shared/Result'
import type { Result } from '../shared/Result'

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export interface EmitGlobalInvoiceInput {
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
  matchedBy: 'db' | 'facturama'
}

/** Reporte estructurado de exclusión por ya-facturado — mismo patrón que `UnmappedReport`, con identidad para auditoría fiscal. */
export interface ExcludedAlreadyInvoicedReport {
  count: number
  orders: ExcludedOrderIdentity[]
}

export interface StoreReport {
  store: string
  enumerated: number
  eligible: number
  skippedNonPos: number
  partialRefunds: number
  /** Pedidos con total neto 0 (descuento 100%) — no facturables, excluidos antes de clasificar por bucket. */
  skippedZeroTotal: number
  excludedAlreadyInvoiced: ExcludedAlreadyInvoicedReport
  unmapped: UnmappedReport
  buckets: BucketReport[]
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
  skippedIdempotent: number
  stampedUnconfirmed: number
  empty: number
  dryRun: number
  ordersEligible: number
  unmapped: number
  /**
   * true si la corrida dejó pedidos elegibles SIN facturar o en estado
   * inconsistente. Tres causas, todas del mismo tipo (hueco fiscal que exige
   * intervención humana):
   *   - `rolledBack`         → el chunk no se timbró.
   *   - `stampedUnconfirmed` → se timbró pero el header no se actualizó (conciliar).
   *   - `unmapped`           → la forma de pago no se pudo clasificar, así que el
   *                            pedido nunca llegó a un bucket ni, por tanto, a un
   *                            CFDI (decisión 2026-07-23: el `unmapped` debe
   *                            alertar; antes era un hueco silencioso).
   */
  hasFailures: boolean
}

export interface GlobalRunReport {
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
    chunks: 0, emitted: 0, rolledBack: 0, skippedIdempotent: 0,
    stampedUnconfirmed: 0, empty: 0, dryRun: 0,
    ordersEligible: 0, unmapped: 0, hasFailures: false,
  }

  for (const store of stores) {
    s.ordersEligible += store.eligible
    s.unmapped += store.unmapped.count
    for (const bucket of store.buckets) {
      for (const chunk of bucket.chunks) {
        s.chunks++
        switch (chunk.outcome) {
          case 'emitted':             s.emitted++; break
          case 'rolled_back':         s.rolledBack++; break
          case 'skipped_idempotent':  s.skippedIdempotent++; break
          case 'stamped_unconfirmed': s.stampedUnconfirmed++; break
          case 'empty':               s.empty++; break
          case 'dry_run':             s.dryRun++; break
        }
      }
    }
  }

  s.hasFailures = s.rolledBack > 0 || s.stampedUnconfirmed > 0 || s.unmapped > 0
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
  pendingTtlMinutes?: number
  /** Reloj inyectable — permite testear el TTL sin esperar minutos reales. Default: () => new Date(). */
  now?: () => Date
  /** uuid de la corrida — inyectable para tests deterministas. Default: crypto.randomUUID(). */
  runId?: string
  /** Adapter de logging estructurado. Default: console (comportamiento previo al puerto). */
  logger?: Logger
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITEMS_PER_CHUNK = 250
const DEFAULT_PENDING_TTL_MINUTES = 10

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
  private readonly pendingTtlMinutes: number
  private readonly now: () => Date
  private readonly runId: string
  private readonly logger: Logger

  constructor(private readonly deps: EmitGlobalInvoiceDeps) {
    this.paymentBucketPolicy = deps.paymentBucketPolicy ?? PaymentBucketPolicy
    this.chunkPolicy = deps.chunkPolicy ?? GlobalChunkPolicy
    this.maxItemsPerChunk = deps.maxItemsPerChunk ?? DEFAULT_MAX_ITEMS_PER_CHUNK
    this.pendingTtlMinutes = deps.pendingTtlMinutes ?? DEFAULT_PENDING_TTL_MINUTES
    this.now = deps.now ?? (() => new Date())
    this.runId = deps.runId ?? crypto.randomUUID()
    this.logger = deps.logger ?? CONSOLE_LOGGER
  }

  async execute(input: EmitGlobalInvoiceInput): Promise<Result<GlobalRunReport, GlobalRunError>> {
    const { year, month, day, storeName, dryRun = false } = input
    const runId = this.runId

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
    for (const store of targetStores) {
      stores.push(await this.runStore(store, period, dryRun, runId))
    }

    const summary = computeSummary(stores)

    this.logger.info({ runId, year, month, day, summary }, '[global-invoice] fin de corrida')

    return ok({ runId, year, month, day: period.day, dryRun, summary, stores })
  }

  // ── Por tienda ────────────────────────────────────────────────────────────

  private async runStore(store: string, period: GlobalPeriod, dryRun: boolean, runId: string): Promise<StoreReport> {
    const monthlyOrders = await this.enumerateAll(store, period)

    let skippedNonPos = 0
    let partialRefunds = 0
    let skippedZeroTotal = 0
    const eligible: MonthlyOrder[] = []

    for (const monthlyOrder of monthlyOrders) {
      const { order } = monthlyOrder

      // (a) SOLO pedidos POS.
      if (!order.sourceIdentifier) {
        skippedNonPos++
        continue
      }

      // (b) Solo pagados. Shopify marca un pedido con reembolso PARCIAL como
      // displayFinancialStatus='PARTIALLY_REFUNDED' (no 'PAID') aunque el
      // cobro original sí se realizó — por eso el filtro acepta ambos y deja
      // que RefundPolicy.isFullyRefunded (paso c) sea el único que excluye
      // por reembolso, evitando que un reembolso parcial (D2: se incluye al
      // neto) caiga fuera del filtro de "pagado".
      if (!PAID_LIKE_STATUSES.has(order.financialStatus)) continue

      // (c) Excluir totalmente reembolsados.
      if (this.deps.refundPolicy.isFullyRefunded(order)) continue

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
    const { buckets, unmapped } = this.groupByBucket(survivors)

    this.logger.info({
      runId, store, day: period.day, enumerated: monthlyOrders.length, eligible: eligible.length,
      skippedNonPos, partialRefunds, skippedZeroTotal,
      excludedAlreadyInvoiced: excludedAlreadyInvoiced.count,
      excludedAlreadyInvoicedOrders: excludedAlreadyInvoiced.orders,
      unmapped: unmapped.length,
    }, '[global-invoice] tienda enumerada')

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

    return {
      store,
      enumerated: monthlyOrders.length,
      eligible: eligible.length,
      skippedNonPos,
      partialRefunds,
      skippedZeroTotal,
      excludedAlreadyInvoiced,
      unmapped: { count: unmapped.length, orderIds: unmapped.map((mo) => mo.order.id) },
      buckets: bucketReports,
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
    const orderReferences = new Set<string>()
    for (const gateway of this.deps.invoicedOrdersGateways) {
      const keys = await gateway.listInvoicedOrderKeys(store, period)
      for (const id of keys.orderIds) orderIds.add(id)
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
        excludedOrders.push({ orderId: order.id, reference, matchedBy: matchedById ? 'db' : 'facturama' })
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

    const chunkReports: ChunkReport[] = []
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunkOrders = chunks[chunkIndex]
      const chunkReport = dryRun
        ? { chunkIndex, itemCount: chunkOrders.length, outcome: 'dry_run' as const }
        : await this.processChunk(store, period, bucket, chunkIndex, chunkOrders, runId)
      chunkReports.push(chunkReport)
    }

    return { bucket, orders: bucketOrders.length, chunks: chunkReports }
  }

  /**
   * Procesa un chunk de forma idempotente: insert-first del header, reap-lazy
   * si está pending y viejo, insert-first por-fila de membresías (excluyendo
   * SOLO los pedidos que pierden la carrera), timbrado, y rollback/marca de
   * stamped_unconfirmed según en qué punto falle (mirror de EmitInvoiceUseCase).
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

    let header = await this.deps.globalRepo.createGlobalHeader(identity)
    if (!header.created) {
      const reaped = await this.deps.globalRepo.reapStaleGlobalHeader(identity, this.pendingTtlMinutes, this.now())
      if (reaped) {
        header = await this.deps.globalRepo.createGlobalHeader(identity)
      }
    }
    if (!header.created) {
      this.logger.info({ runId, store, day: period.day, bucket, chunkIndex }, '[global-invoice] chunk salteado (idempotente)')
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
      const membership = await this.deps.invoiceRepo.createInvoice(membershipData)
      if (membership.created) {
        survivors.push(monthlyOrder)
      } else {
        excludedByRace++
      }
    }

    if (survivors.length === 0) {
      await this.deps.globalRepo.deleteGlobalHeader(headerId)
      this.logger.info({ runId, store, day: period.day, bucket, chunkIndex }, '[global-invoice] chunk vacío tras insert-first, header borrado')
      return { chunkIndex, itemCount: 0, outcome: 'empty', excludedByRace }
    }

    let stampResult
    try {
      stampResult = await this.deps.globalStamping.emitirGlobal({
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
      this.logger.error({ runId, store, day: period.day, bucket, chunkIndex, error: message }, '[global-invoice] Facturama global falló, rollback')
      await this.rollbackChunk(headerId, runId)
      return { chunkIndex, itemCount: survivors.length, outcome: 'rolled_back', error: message, excludedByRace }
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
        await this.deps.globalRepo.updateGlobalStamp(headerId, { status: 'stamped_unconfirmed' })
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
      runId, store, day: period.day, bucket, chunkIndex, uuid: stampResult.uuidCfdi, serieFolio: stampResult.serieFolio, itemCount: survivors.length,
    }, '[global-invoice] chunk timbrado')
    return { chunkIndex, itemCount: survivors.length, outcome: 'emitted', uuid: stampResult.uuidCfdi, serieFolio: stampResult.serieFolio, excludedByRace }
  }

  /** Rollback: borra las membresías del chunk y el header — NUNCA se llama tras timbrar con éxito. */
  private async rollbackChunk(headerId: string, runId: string): Promise<void> {
    try {
      await this.deps.invoiceRepo.deleteByGlobalInvoiceId(headerId)
    } catch (delErr: unknown) {
      const message = delErr instanceof Error ? delErr.message : String(delErr)
      this.logger.error({ runId, headerId, error: message }, '[global-invoice] rollback: no se pudieron borrar las membresías')
    }
    try {
      await this.deps.globalRepo.deleteGlobalHeader(headerId)
    } catch (delErr: unknown) {
      const message = delErr instanceof Error ? delErr.message : String(delErr)
      this.logger.error({ runId, headerId, error: message }, '[global-invoice] rollback: no se pudo borrar el header')
    }
  }
}
