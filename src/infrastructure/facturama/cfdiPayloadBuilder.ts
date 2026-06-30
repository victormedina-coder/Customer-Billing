/**
 * cfdiPayloadBuilder — capa de infraestructura (Facturama).
 *
 * ÚNICA responsabilidad: serializar los números de FiscalBreakdown a la
 * forma exacta que espera la API de Facturama (CfdiPayload con strings).
 *
 * NO recalcula nada. Todos los valores numéricos vienen de
 * FiscalCalculator.compute(). Los tipos CfdiPayload/CfdiItem/CfdiTax/CfdiReceiver
 * pertenecen a la capa de infraestructura (son la forma de Facturama).
 */

import type { NormalizedOrderWithPayment } from '../../../lib/shopify/mapper'
import type { FiscalInput } from '../../domain/fiscal/FiscalInput'
import { FiscalCalculator } from '../../domain/fiscal/FiscalCalculator'

// ─── Tipos Facturama (infraestructura) ───────────────────────────────────────

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

// ─── Utilidades de serialización ─────────────────────────────────────────────

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

  // Delegar TODO el cálculo numérico al domain service
  const breakdown = FiscalCalculator.compute(order)

  // Serializar cada línea a CfdiItem — SOLO conversión a strings
  const items: CfdiItem[] = order.lines.map((line, index) => {
    const lb = breakdown.porLinea[index]

    const item: CfdiItem = {
      ProductCode:          defaultProdCode,
      IdentificationNumber: line.productCode || String(index + 1).padStart(3, '0'),
      Description:          line.description,
      Unit:                 defaultUnitCode,
      UnitCode:             defaultUnitCode,
      UnitPrice:            String(lb.unitPriceSinIva),
      Quantity:             String(lb.quantity),
      Subtotal:             String(lb.subtotal),
      TaxObject:            '02',
      Taxes: [
        {
          Total:        String(lb.iva),
          Name:         'IVA',
          Base:         String(lb.base),
          Rate:         '0.16',
          IsRetention:  'false',
          IsFederalTax: 'true',
        },
      ],
      Total: String(lb.total),
    }

    // Solo incluir Discount cuando es > 0 (Facturama lo omite si no aplica)
    if (lb.hasDiscount) {
      item.Discount = String(lb.discount)
    }

    return item
  })

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
