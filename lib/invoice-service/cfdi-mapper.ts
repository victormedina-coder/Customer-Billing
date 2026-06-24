/**
 * Construye el payload CFDI 4.0 para FACTURAS INDIVIDUALES (RFC real del receptor).
 *
 * Reglas de negocio:
 *   - NO incluye GlobalInformation (eso es solo para factura global a público en general)
 *   - Los precios de POS en México normalmente INCLUYEN IVA; se usa unitPriceIncludesTax
 *   - Todos los valores numéricos van como STRING en el JSON de Facturama
 *   - El total del CFDI debe coincidir EXACTAMENTE con lo que pagó el cliente
 *   - El descuento se aplica por concepto usando el campo Discount (CFDI 4.0 / Facturama)
 *
 * Mapeo de forma de pago (pendiente confirmación del contador):
 *   El mapa es orientativo; el contador debe validar las claves SAT definitivas.
 */

import type { NormalizedOrderWithPayment } from '../shopify/mapper'
import type { FiscalInput } from './types'

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface CfdiTax {
  Total: string
  Name: string
  Base: string
  Rate: string
  IsRetention: string
  IsFederalTax: string
}

export interface CfdiItem {
  ProductCode: string
  IdentificationNumber: string
  Description: string
  Unit: string
  UnitCode: string
  UnitPrice: string
  Quantity: string
  Subtotal: string
  Discount?: string
  TaxObject: string
  Taxes: CfdiTax[]
  Total: string
}

export interface CfdiReceiver {
  Rfc: string
  Name: string
  CfdiUse: string
  FiscalRegime: string
  TaxZipCode: string
}

export interface CfdiPayload {
  NameId: string
  Folio: string
  CfdiType: 'I'
  ExpeditionPlace: string
  Exportation: '01'
  PaymentForm: string
  PaymentMethod: 'PUE'
  Currency: 'MXN'
  Receiver: CfdiReceiver
  Items: CfdiItem[]
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** Redondea a 2 decimales de forma precisa para cálculos monetarios */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Mapea el nombre del gateway de Shopify a la clave SAT de forma de pago.
 * PENDIENTE: el contador debe confirmar el mapeo definitivo.
 *
 * Claves SAT comunes:
 *   01 = Efectivo
 *   03 = Transferencia electrónica
 *   04 = Tarjeta de crédito
 *   28 = Tarjeta de débito
 */
function mapPaymentForm(gateways?: string[]): string {
  const defaultForm = process.env.FACTURAMA_DEFAULT_PAYMENT_FORM ?? '03'
  if (!gateways || gateways.length === 0) return defaultForm

  const raw = gateways[0].toLowerCase()

  if (raw.includes('cash') || raw.includes('efectivo')) return '01'
  if (raw.includes('transfer') || raw.includes('transferencia') || raw === 'bogus') return '03'
  if (raw.includes('credit') || raw.includes('crédito') || raw.includes('credito') || raw.includes('paypal')) return '04'
  if (raw.includes('debit') || raw.includes('débito') || raw.includes('debito')) return '28'

  return defaultForm
}

// ─── Estructura intermedia de cálculo por línea ───────────────────────────────

interface LineCalc {
  /** Importe lista con IVA (bruto) */
  listGross: number
  /** Descuento de línea con IVA (bruto) */
  discGross: number
  /** Importe neto con IVA (lo pagado por esa línea) */
  netGross: number
}

// ─── Builder principal ────────────────────────────────────────────────────────

export function buildCfdiPayload(
  order: NormalizedOrderWithPayment,
  fiscal: FiscalInput
): CfdiPayload {
  const nameId          = process.env.FACTURAMA_NAME_ID ?? '1'
  const defaultProdCode = process.env.FACTURAMA_DEFAULT_PRODUCT_CODE ?? '01010101'
  const defaultUnitCode = process.env.FACTURAMA_DEFAULT_UNIT_CODE ?? 'ACT'
  const expeditionPlace =
    (process.env.FACTURAMA_EXPEDITION_PLACE ?? '').trim() || fiscal.cp

  // Folio: timestamp en ms truncado a 8 dígitos para unicidad razonable
  const folio = String(Date.now()).slice(-8)

  const paymentForm = mapPaymentForm(order.paymentGatewayNames)

  // ── Paso 1: calcular montos brutos (con IVA) por línea ────────────────────
  const lineCalcs: LineCalc[] = order.lines.map((line) => {
    const { quantity, unitPrice, discount } = line
    const listGross = round2(quantity * unitPrice)
    const discGross = round2(quantity * discount)
    const netGross  = round2(listGross - discGross)
    return { listGross, discGross, netGross }
  })

  // ── Paso 2: reconciliar contra el total de la orden ───────────────────────
  // goodsTarget = lo que pagó el cliente por los productos (sin envío).
  // Si hay descuentos a nivel pedido que no están distribuidos por línea,
  // los escalamos proporcionalmente entre todas las líneas.
  const goodsTarget = round2(order.total - order.shippingAmount)
  const sumNet      = round2(lineCalcs.reduce((acc, lc) => acc + lc.netGross, 0))

  if (order.shippingAmount > 0) {
    console.warn(
      `[cfdi-mapper] el pedido incluye envío ($${order.shippingAmount}). ` +
      `El envío NO se factura como concepto; consulta con el contador. ` +
      `goodsTarget=${goodsTarget}`
    )
  }

  if (sumNet !== goodsTarget && sumNet > 0) {
    const factor = goodsTarget / sumNet
    for (const lc of lineCalcs) {
      lc.netGross  = round2(lc.listGross * factor)
      lc.discGross = round2(lc.listGross - lc.netGross)
    }
  }

  // ── Paso 3: convertir a campos CFDI (sin IVA) y construir items ───────────
  const items: CfdiItem[] = order.lines.map((line, index) => {
    const lc       = lineCalcs[index]
    const qty      = line.quantity
    const inclsTax = line.unitPriceIncludesTax

    let subtotal: number  // Importe lista SIN IVA
    let discount: number  // Descuento SIN IVA
    let base: number      // Base gravable (subtotal - descuento)
    let iva: number
    let total: number

    if (inclsTax) {
      // Derivar subtotal y base desde los brutos para evitar acumulación de
      // errores de redondeo: si se divide listGross y discGross por separado y
      // luego se restan, el resultado difiere en ±0.01 del valor correcto.
      // La fuente de verdad es netGross (ya reconciliado contra order.total).
      subtotal = round2(lc.listGross / 1.16)
      base     = round2(lc.netGross  / 1.16)   // más preciso que subtotal - discount
      discount = round2(subtotal - base)         // derivado, no dividido
      iva      = round2(base * 0.16)
      total    = round2(base + iva)
    } else {
      subtotal = lc.listGross
      base     = lc.netGross
      discount = round2(subtotal - base)
      iva      = round2(base * 0.16)
      total    = round2(base + iva)
    }

    // UnitPrice con 6 decimales para que round2(UnitPrice * qty) === subtotal
    const unitPriceSinIva = qty > 0
      ? Math.round((subtotal / qty) * 1_000_000) / 1_000_000
      : 0

    const item: CfdiItem = {
      ProductCode:          defaultProdCode,
      IdentificationNumber: line.productCode || String(index + 1).padStart(3, '0'),
      Description:          line.description,
      Unit:                 defaultUnitCode,
      UnitCode:             defaultUnitCode,
      UnitPrice:            String(unitPriceSinIva),
      Quantity:             String(qty),
      Subtotal:             String(subtotal),
      TaxObject:            '02',
      Taxes: [
        {
          Total:        String(iva),
          Name:         'IVA',
          Base:         String(base),
          Rate:         '0.16',
          IsRetention:  'false',
          IsFederalTax: 'true',
        },
      ],
      Total: String(total),
    }

    // Solo incluir Discount cuando es > 0 (Facturama lo omite si no aplica)
    if (discount > 0) {
      item.Discount = String(discount)
    }

    return item
  })

  // ── Paso 4: cent-fix final ────────────────────────────────────────────────
  // Asegura que Σ Total de items === goodsTarget exactamente.
  // El ajuste solo toca el último item para no alterar los demás.
  const sumTotals  = round2(items.reduce((acc, it) => acc + parseFloat(it.Total), 0))
  const centDiff   = round2(goodsTarget - sumTotals)
  const MAX_CENTS  = round2(0.05 * items.length)   // 5 ctvs por item como tolerancia

  if (centDiff !== 0) {
    if (Math.abs(centDiff) > MAX_CENTS) {
      console.warn(
        `[cfdi-mapper] diferencia de cent-fix FUERA de tolerancia: ` +
        `sumTotals=${sumTotals}, goodsTarget=${goodsTarget}, diff=${centDiff}. ` +
        `Verifica los precios y descuentos del pedido.`
      )
    } else {
      console.warn(
        `[cfdi-mapper] cent-fix aplicado al último item: ` +
        `sumTotals=${sumTotals}, goodsTarget=${goodsTarget}, ajuste=${centDiff}`
      )
    }

    // Aplicar siempre (dentro o fuera de tolerancia) para que el CFDI cierre;
    // el warn de arriba ya alerta si la magnitud es sospechosa.
    const last          = items[items.length - 1]
    const lastTotal     = round2(parseFloat(last.Total) + centDiff)
    const hasDiscount   = last.Discount !== undefined
    const lastSubtotal  = parseFloat(last.Subtotal)
    const lastBase      = round2(lastTotal / 1.16)
    const lastIva       = round2(lastTotal - lastBase)

    // Distribuir el ajuste al campo correcto: si hay descuento, lo absorbemos ahí;
    // si no hay descuento, ajustamos el subtotal.
    if (hasDiscount) {
      const newDiscount = round2(lastSubtotal - lastBase)
      last.Discount            = String(Math.max(0, newDiscount))
    } else {
      last.Subtotal            = String(lastBase)
    }

    last.Total                 = String(lastTotal)
    last.Taxes[0].Base         = String(lastBase)
    last.Taxes[0].Total        = String(lastIva)
  }

  return {
    NameId:          nameId,
    Folio:           folio,
    CfdiType:        'I',
    ExpeditionPlace: expeditionPlace,
    Exportation:     '01',
    PaymentForm:     paymentForm,
    PaymentMethod:   'PUE',
    Currency:        'MXN',
    Receiver: {
      Rfc:          fiscal.rfc.toUpperCase(),
      Name:         fiscal.razon,
      CfdiUse:      fiscal.uso,
      FiscalRegime: fiscal.regimen,
      TaxZipCode:   fiscal.cp,
    },
    Items: items,
  }
}
