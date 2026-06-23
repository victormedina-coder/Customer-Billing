/**
 * Construye el payload CFDI 4.0 para FACTURAS INDIVIDUALES (RFC real del receptor).
 *
 * Reglas de negocio:
 *   - NO incluye GlobalInformation (eso es solo para factura global a público en general)
 *   - Los precios de POS en México normalmente INCLUYEN IVA; se usa unitPriceIncludesTax
 *   - Todos los valores numéricos van como STRING en el JSON de Facturama
 *   - El total del CFDI debe coincidir EXACTAMENTE con lo que pagó el cliente
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

  // ── Construir items ────────────────────────────────────────────────────────
  const items: CfdiItem[] = order.lines.map((line, index) => {
    const qty       = line.quantity
    const unitPrice = line.unitPrice

    let base: number
    let iva: number
    let unitPriceSinIva: number

    if (line.unitPriceIncludesTax) {
      // El precio de línea YA incluye IVA; hay que separar la base
      const bruto     = round2(qty * unitPrice)
      base            = round2(bruto / 1.16)
      iva             = round2(bruto - base)
      unitPriceSinIva = round2(base / qty)
    } else {
      // El precio de línea es sin IVA
      base            = round2(qty * unitPrice)
      iva             = round2(base * 0.16)
      unitPriceSinIva = round2(unitPrice)
    }

    const total = round2(base + iva)

    return {
      ProductCode:          defaultProdCode,
      IdentificationNumber: line.productCode || String(index + 1).padStart(3, '0'),
      Description:          line.description,
      Unit:                 defaultUnitCode,
      UnitCode:             defaultUnitCode,
      UnitPrice:            String(unitPriceSinIva),
      Quantity:             String(qty),
      Subtotal:             String(base),
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
  })

  // ── Reconciliación de redondeo ────────────────────────────────────────────
  // El total de la orden (lo que pagó el cliente) debe ser EXACTAMENTE igual
  // a la suma de los totales del CFDI. Corregimos el último item si hay drift.
  const sumaItems  = round2(items.reduce((acc, it) => acc + parseFloat(it.Total), 0))
  const totalOrden = round2(order.total)
  const tolerancia = round2(0.05 * items.length)   // 5 ctvs por item como máximo

  const diferencia = round2(totalOrden - sumaItems)

  if (diferencia !== 0) {
    if (Math.abs(diferencia) <= tolerancia) {
      // Ajuste menor: corregir el último item
      console.warn(
        `[cfdi-mapper] ajuste de redondeo aplicado: suma items=${sumaItems}, ` +
        `total orden=${totalOrden}, diferencia=${diferencia}. ` +
        `Se corrige el último item.`
      )
      const last = items[items.length - 1]
      const lastTotal    = round2(parseFloat(last.Total) + diferencia)
      const lastBase     = round2(lastTotal / 1.16)
      const lastIva      = round2(lastTotal - lastBase)

      last.Total   = String(lastTotal)
      last.Subtotal = String(lastBase)
      last.Taxes[0].Base  = String(lastBase)
      last.Taxes[0].Total = String(lastIva)
    } else {
      // Diferencia fuera de tolerancia: advertir pero NO ajustar (puede ser
      // una discrepancia real que el contador debe revisar)
      console.warn(
        `[cfdi-mapper] diferencia de redondeo FUERA de tolerancia: ` +
        `suma items=${sumaItems}, total orden=${totalOrden}, diferencia=${diferencia}. ` +
        `Verifica los precios y descuentos del pedido.`
      )
    }
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
