/**
 * FiscalCalculator — domain service puro.
 *
 * Calcula el desglose fiscal CFDI 4.0 a partir de un pedido normalizado.
 * SIN dependencias de Next.js, React, Facturama ni ninguna infraestructura.
 *
 * Responsabilidades:
 *   - Calcular montos brutos (con IVA) por línea
 *   - Reconciliar contra el total del pedido (factor de escala)
 *   - Derivar subtotal/base/descuento/iva/total SIN IVA por línea
 *   - Calcular unitPriceSinIva a 6 decimales
 *   - Aplicar cent-fix al último renglón para que Σ total === goodsTarget
 *
 * Los valores devueltos en FiscalBreakdown.porLinea son DEFINITIVOS:
 * cfdiPayloadBuilder los serializa a strings sin recalcular nada.
 */

import type { Order } from '../orders/Order'
import type { FiscalBreakdown, LineBreakdown } from './FiscalBreakdown'

/** Redondea a 2 decimales de forma precisa para cálculos monetarios */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Estructura intermedia de cálculo por línea (brutos con IVA) ─────────────

interface LineCalc {
  /** Importe lista con IVA (bruto) */
  listGross: number
  /** Descuento de línea con IVA (bruto) */
  discGross: number
  /** Importe neto con IVA (lo pagado por esa línea) */
  netGross: number
}

// ─── Servicio principal ───────────────────────────────────────────────────────

export const FiscalCalculator = {
  /**
   * Calcula el desglose fiscal completo para un pedido.
   *
   * El resultado incluye valores post-cent-fix: son los números finales
   * que deben ir en el CFDI sin ninguna corrección adicional.
   */
  compute(order: Order): FiscalBreakdown {
    // ── Paso 1: calcular montos brutos (con IVA) por línea ──────────────────
    const lineCalcs: LineCalc[] = order.lines.map((line) => {
      const { quantity, unitPrice, discount } = line
      const listGross = round2(quantity * unitPrice)
      const discGross = round2(quantity * discount)
      const netGross  = round2(listGross - discGross)
      return { listGross, discGross, netGross }
    })

    // ── Paso 2: reconciliar contra el total de la orden ─────────────────────
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

    // ── Paso 3: convertir a campos CFDI (sin IVA) por línea ────────────────
    const lines: LineBreakdown[] = order.lines.map((line, index) => {
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

      // UnitPrice con 6 decimales para que round2(unitPriceSinIva × qty) === subtotal
      const unitPriceSinIva = qty > 0
        ? Math.round((subtotal / qty) * 1_000_000) / 1_000_000
        : 0

      return { subtotal, discount, base, iva, total, unitPriceSinIva, quantity: qty, hasDiscount: discount > 0 }
    })

    // ── Paso 4: cent-fix final ───────────────────────────────────────────────
    // Asegura que Σ Total de líneas === goodsTarget exactamente.
    // El ajuste solo toca el último renglón para no alterar los demás.
    const sumTotals = round2(lines.reduce((acc, l) => acc + l.total, 0))
    const centDiff  = round2(goodsTarget - sumTotals)
    const MAX_CENTS = round2(0.05 * lines.length)   // 5 ctvs por item como tolerancia

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
      //
      // Invariantes por concepto que DEBEN conservarse:
      //   1. Subtotal === UnitPrice × Quantity  (redondeado a 2)
      //   2. Base === Subtotal − Discount        (Discount fijo; si no hay, 0)
      //   3. Total === Base + IVA
      //
      // Estrategia: derivar Base desde el nuevo Total, mantener Discount intacto
      // y recalcular Subtotal = Base + Discount.  Así nunca hay descuento negativo
      // ni se rompe la identidad que valida el SAT/Facturama.
      const last        = lines[lines.length - 1]
      const qty         = last.quantity
      const lastTotal   = round2(last.total + centDiff)
      const lastDisc    = last.discount   // se mantiene intacto
      const lastBase    = round2(lastTotal / 1.16)
      const lastIva     = round2(lastTotal - lastBase)
      const lastSub     = round2(lastBase + lastDisc)  // garantiza Subtotal − Discount === Base

      last.total          = lastTotal
      last.base           = lastBase
      last.iva            = lastIva
      last.subtotal       = lastSub
      last.unitPriceSinIva = qty > 0
        ? Math.round((lastSub / qty) * 1_000_000) / 1_000_000
        : last.unitPriceSinIva
      // hasDiscount no cambia: el descuento original se conserva
    }

    // ── Totales globales ─────────────────────────────────────────────────────
    const totales = {
      subtotalSinIVA: round2(lines.reduce((acc, l) => acc + l.subtotal, 0)),
      descuento:      round2(lines.reduce((acc, l) => acc + l.discount, 0)),
      iva:            round2(lines.reduce((acc, l) => acc + l.iva, 0)),
      total:          round2(lines.reduce((acc, l) => acc + l.total, 0)),
    }

    return { porLinea: lines, totales }
  },
}
