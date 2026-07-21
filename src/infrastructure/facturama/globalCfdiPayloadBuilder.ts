/**
 * globalCfdiPayloadBuilder — capa de infraestructura (Facturama).
 *
 * ÚNICA responsabilidad: serializar (GlobalPeriod, PaymentBucket, pedidos
 * sobrevivientes de un chunk) a la forma exacta que espera la API de
 * Facturama para un CFDI GLOBAL mensual. Imita deliberadamente el estilo de
 * cfdiPayloadBuilder.ts (el individual): serialización pura a strings, mismo
 * manejo de ExpeditionPlace. La base sale de FiscalCalculator; el IVA del
 * concepto se recalcula a tasa fija 16% (ver GLOBAL_TAX_RATE). NO hace I/O.
 *
 * Diferencias clave frente al individual:
 *   - Receptor FIJO "PUBLICO EN GENERAL" (no hay datos fiscales de cliente).
 *   - GlobalInformation (Periodicity/Months/Year) en vez de OrderNumber.
 *   - PaymentForm del encabezado se deriva del PaymentBucket (no del gateway
 *     de una transacción individual).
 *   - UN Item POR PEDIDO (regla SAT 2.7.1.21) — no uno por línea de producto.
 */

import type { Order } from '../../domain/orders/Order'
import type { MonthlyOrder } from '../../domain/global/ports/MonthlyOrderSource'
import type { GlobalPeriod } from '../../domain/global/GlobalPeriod'
import type { PaymentBucket } from '../../domain/global/PaymentBucket'
import { FiscalCalculator } from '../../domain/fiscal/FiscalCalculator'
import { receiptTail } from '../../domain/orders/OrderReference'
import type { CfdiItem, CfdiReceiver, CfdiTax } from './cfdiPayloadBuilder'

// ─── Tipos Facturama — CFDI global (infraestructura) ─────────────────────────

export interface GlobalInformation {
  /**
   * Clave SAT c_Periodicidad: '04' = Mensual, '01' = Diario. El valor sale
   * de `period.periodicityCode()` — el día NO se codifica aquí (SAT: el día
   * queda implícito en `FechaEmision`; ver createDailyGlobalPeriod).
   */
  Periodicity: '01' | '04'
  Months: string
  Year: string
}

export interface GlobalCfdiPayload {
  NameId: string
  Serie?: string
   /**
   * NO existe `Folio` a propósito: Facturama lo asigna e incrementa por Serie
   * (decisión 2026-07-21) — esa es la numeración continua que contabilidad ya
   * conoce en producción. Mandar uno propio rompería la secuencia.
   */
  CfdiType: 'I'
  ExpeditionPlace: string
  Exportation: '01'
  PaymentForm: string
  PaymentMethod: 'PUE'
  Currency: 'MXN'
  Receiver: CfdiReceiver
  Items: CfdiItem[]
  GlobalInformation: GlobalInformation
}

// ─── Receptor genérico "Público en general" (CFDI 4.0, comprobantes globales) ─

const GENERIC_RECEIVER: CfdiReceiver = {
  Rfc: 'XAXX010101000',
  Name: 'PUBLICO EN GENERAL',
  CfdiUse: 'S01',
  FiscalRegime: '616',
  TaxZipCode: '', // se completa con expeditionPlace en el builder
}

/**
 * Claves SAT del CFDI global — NORMATIVAS (regla SAT 2.7.1.21 para
 * comprobantes globales), fijas en código y NO configurables por env.
 * A diferencia del individual (cfdiPayloadBuilder.ts), aquí NO debe
 * aplicarse ningún override de FACTURAMA_DEFAULT_PRODUCT_CODE/UNIT_CODE.
 */
const GLOBAL_PRODUCT_CODE = '01010101'
const GLOBAL_UNIT_CODE = 'ACT'
const GLOBAL_UNIT_NAME = 'Actividad'

/**
 * Tasa de IVA FIJA del CFDI global — decisión del contador (2026-07-13, D1):
 * todos los tickets van al 16%, sin tasas mixtas. Se usa fija (nunca
 * back-derivada de iva/base) para garantizar Base × Rate == Total, que es
 * exactamente lo que valida Facturama por concepto.
 */
const GLOBAL_TAX_RATE = 0.16

/**
 * Clave SAT de forma de pago por PaymentBucket. Igual mecanismo que
 * GATEWAY_CLASS_TO_SAT_PAYMENT_FORM del individual, pero indexado por bucket
 * (ya decidido por PaymentBucketPolicy) en vez de por clase de gateway.
 * TODO(D6): confirmar claves con el contador.
 */
const BUCKET_TO_SAT_PAYMENT_FORM: Record<PaymentBucket, string> = {
  credito: '04',
  debito: '28',
  efectivo: '01',
}
/**
 * Serie fiscal por marca. Es lo ÚNICO que identifica la marca en el CFDI
 * global: el emisor/CSD es el mismo para las tres marcas y el receptor es
 * genérico, así que sin Serie los comprobantes son indistinguibles en el
 * panel de Facturama y para contabilidad (hallazgo 2026-07-21).
 *
 * Los valores por defecto son la convención YA vigente en la cuenta de
 * producción (confirmada por contabilidad). Se permite override por env
 * porque el sandbox puede tener series distintas dadas de alta.
 */
const BRAND_SERIE: Record<string, { envVar: string, fallback: string }> = {
  'ariat':            { envVar: 'ARIAT_FACTURAMA_SERIE',    fallback: 'GDL1'  },
  'stetson':          { envVar: 'STETSON_FACTURAMA_SERIE',  fallback: 'STET'  },
  'western-brothers': { envVar: 'WB_FACTURAMA_SERIE',       fallback: 'WB'    },
}

/** Serie de la marca; undefined si la tienda no está mapeada (Facturama asigna la default). */
function resolveSerie(storeName: string): string | undefined {
  const cfg = BRAND_SERIE[storeName]
  if (!cfg) return undefined
  return process.env[cfg.envVar]?.trim() || cfg.fallback
}

/** Redondeo monetario a 2 decimales, igual convención que FiscalCalculator. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Serializa UN pedido a su Item agregado (un solo concepto por pedido, regla
 * SAT 2.7.1.21 para comprobantes globales). El desglose de IVA se delega
 * ÍNTEGRO a FiscalCalculator.compute(order).totales — son los mismos números
 * ya reconciliados/cent-fixed que usaría el CFDI individual de ese pedido,
 * aquí colapsados a Quantity=1 (todo el pedido es un concepto).
 *
 * D1 RESUELTO (contador, 2026-07-13): tasa FIJA 16% — no hay tasas mixtas.
 * El IVA del concepto se recalcula como round2(base × 0.16) para que
 * Base × Rate == Total cuadre siempre (validación estricta de Facturama);
 * puede diferir ±1 centavo del IVA exacto del ticket, aceptable en el global.
 */
function buildItemForOrder(order: Order): CfdiItem {
  const breakdown = FiscalCalculator.compute(order)
  const { subtotalSinIVA, descuento } = breakdown.totales

  const allExempt = order.lines.length > 0 && order.lines.every((line) => line.taxObject === '01')
  const base = round2(subtotalSinIVA - descuento)
  const ivaConcepto = allExempt ? 0 : round2(base * GLOBAL_TAX_RATE)

  const identificationNumber = order.sourceIdentifier
    ? receiptTail(order.sourceIdentifier)
    : order.orderNumber

  const item: CfdiItem = {
    ProductCode: GLOBAL_PRODUCT_CODE,
    IdentificationNumber: identificationNumber,
    Description: 'Venta',
    Unit: GLOBAL_UNIT_NAME,
    UnitCode: GLOBAL_UNIT_CODE,
    UnitPrice: String(subtotalSinIVA),
    Quantity: '1',
    Subtotal: String(subtotalSinIVA),
    TaxObject: allExempt ? '01' : '02',
    Total: String(round2(base + ivaConcepto)),
  }

  if (descuento > 0) {
    item.Discount = String(descuento)
  }

  // Exento: igual que el individual, Facturama exige NO mandar el nodo Taxes.
  if (!allExempt) {
    const tax: CfdiTax = {
      Total: String(ivaConcepto),
      Name: 'IVA',
      Base: String(base),
      Rate: String(GLOBAL_TAX_RATE),
      IsRetention: 'false',
      IsFederalTax: 'true',
    }
    item.Taxes = [tax]
  }

  return item
}

// ─── Builder principal ────────────────────────────────────────────────────────

/**
 * Construye el payload del CFDI global a partir del periodo, el bucket de
 * pago y los pedidos sobrevivientes de un chunk. Función pura, sin I/O.
 *
 * `storeName` (clave de marca: 'ariat' | 'stetson' | 'western-brothers')
 * resuelve la Serie fiscal del comprobante — es el único dato del CFDI que
 * distingue la marca, ya que el emisor/CSD y el receptor genérico son
 * idénticos para las tres.
 */
export function buildGlobalCfdiPayload(
  period: GlobalPeriod,
  bucket: PaymentBucket,
  orders: readonly MonthlyOrder[],
  storeName: string,
  expeditionPlace: string
): GlobalCfdiPayload {
  const nameId = process.env.FACTURAMA_NAME_ID ?? '1'

  if (!expeditionPlace.trim()) {
    throw new Error('buildGlobalCfdiPayload: expeditionPlace es obligatorio y no puede estar vacío.')
  }
  if (orders.length === 0) {
    throw new Error('buildGlobalCfdiPayload: orders no puede estar vacío.')
  }

  const paymentForm = BUCKET_TO_SAT_PAYMENT_FORM[bucket]

  const items = orders.map((monthlyOrder) => buildItemForOrder(monthlyOrder.order))

  const payload: GlobalCfdiPayload = {
    NameId: nameId,
    CfdiType: 'I',
    ExpeditionPlace: expeditionPlace,
    Exportation: '01',
    PaymentForm: paymentForm,
    PaymentMethod: 'PUE',
    Currency: 'MXN',
    Receiver: {
      ...GENERIC_RECEIVER,
      TaxZipCode: expeditionPlace,
    },
    Items: items,
    GlobalInformation: {
      Periodicity: period.periodicityCode(),
      Months: period.monthsCode(),
      Year: period.yearString(),
    },
  }

  const serie = resolveSerie(storeName)
  if (serie) payload.Serie = serie

  return payload
}
