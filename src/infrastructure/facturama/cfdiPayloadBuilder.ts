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

import type { NormalizedOrderWithPayment } from '../../domain/orders/Order'
import type { FiscalInput } from '../../domain/fiscal/FiscalInput'
import { FiscalCalculator } from '../../domain/fiscal/FiscalCalculator'
import { buildOrderReference } from '../../domain/orders/OrderReference'
import {
  classifyGateway,
  type GatewayPaymentClass,
} from '../../domain/global/GatewayPaymentClassification'

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
  /** Ausente/omitido cuando TaxObject === '01' (exento — Facturama exige no mandar impuesto). */
  Taxes?: CfdiTax[]
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
  /**
   * Metadato de Facturama (NO va en el XML SAT) — referencia al pedido de
   * origen, formato "{order.name} {sourceIdentifier}" (ver OrderReference).
   * Es el mismo campo "Orden de Compra" que rellena la app de autofacturación
   * de Facturama. La futura facturación global mensual filtra "ya facturado"
   * leyendo este campo por API (round-trip verificado en sandbox 2026-07-09
   * con scripts/probe-ordernumber-roundtrip.mjs).
   */
  OrderNumber?: string
}

// ─── Utilidades de serialización ─────────────────────────────────────────────

/**
 * Clave SAT de forma de pago por clase de gateway. La CLASIFICACIÓN del
 * gateway (qué gateway es efectivo/transferencia/crédito/débito) vive en
 * src/domain/global/GatewayPaymentClassification.ts (single source of
 * truth); aquí solo se traduce la clase a la clave SAT correspondiente.
 * PENDIENTE: el contador debe confirmar el mapeo definitivo.
 */
const GATEWAY_CLASS_TO_SAT_PAYMENT_FORM: Record<GatewayPaymentClass, string> = {
  efectivo: '01',
  transferencia: '03',
  credito: '04',
  debito: '28',
}

/** Mapea el nombre del gateway de Shopify a la clave SAT de forma de pago. */
function mapPaymentForm(gateways?: string[]): string {
  const defaultForm = process.env.FACTURAMA_DEFAULT_PAYMENT_FORM ?? '03'
  if (!gateways || gateways.length === 0) return defaultForm

  const gatewayClass = classifyGateway(gateways[0])
  if (gatewayClass === 'unmapped') return defaultForm

  return GATEWAY_CLASS_TO_SAT_PAYMENT_FORM[gatewayClass]
}

// ─── Builder principal ────────────────────────────────────────────────────────

export function buildCfdiPayload(
  order: NormalizedOrderWithPayment,
  fiscal: FiscalInput,
  expeditionPlace: string
): CfdiPayload {
  const nameId          = process.env.FACTURAMA_NAME_ID ?? '1'
  // Default de negocio (2026-07-10): factura INDIVIDUAL (cliente) usa clave
  // genérica de servicios "53102500" + unidad "H87" (Pieza). Distinto del
  // CFDI GLOBAL, que usa las claves normativas fijas de globalCfdiPayloadBuilder.ts.
  const defaultProdCode = process.env.FACTURAMA_DEFAULT_PRODUCT_CODE ?? '53102500'
  const defaultUnitCode = process.env.FACTURAMA_DEFAULT_UNIT_CODE ?? 'H87'
  const defaultUnitName = 'Pieza'

  if (!expeditionPlace.trim()) {
    throw new Error('buildCfdiPayload: expeditionPlace es obligatorio y no puede estar vacío.')
  }

  // Folio: timestamp en ms truncado a 8 dígitos para unicidad razonable
  const folio = String(Date.now()).slice(-8)

  const paymentForm = mapPaymentForm(order.paymentGatewayNames)

  // Referencia al pedido de origen para OrderNumber. Facturama limita
  // OrderNumber a ~100 chars; la referencia real siempre es corta, pero se
  // trunca defensivamente para no romper la emisión.
  const orderReference = buildOrderReference(
    order.orderNumber,
    order.sourceIdentifier ?? null
  ).slice(0, 100)

  // Delegar TODO el cálculo numérico al domain service
  const breakdown = FiscalCalculator.compute(order)

  // Serializar cada línea a CfdiItem — SOLO conversión a strings
  const items: CfdiItem[] = order.lines.map((line, index) => {
    const lb = breakdown.porLinea[index]
    const exento = line.taxObject === '01'

    const item: CfdiItem = {
      ProductCode:          defaultProdCode,
      IdentificationNumber: line.productCode || String(index + 1).padStart(3, '0'),
      Description:          line.description,
      Unit:                 defaultUnitName,
      UnitCode:             defaultUnitCode,
      UnitPrice:            String(lb.unitPriceSinIva),
      Quantity:             String(lb.quantity),
      Subtotal:             String(lb.subtotal),
      TaxObject:            line.taxObject,
      Total:                String(lb.total),
    }

    // Exento: Facturama exige NO mandar el nodo Taxes en no-objeto de impuesto.
    if (!exento) {
      item.Taxes = [
        {
          Total:        String(lb.iva),
          Name:         'IVA',
          Base:         String(lb.base),
          Rate:         String(line.taxRate),
          IsRetention:  'false',
          IsFederalTax: 'true',
        },
      ]
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
    OrderNumber: orderReference,
  }
}
