/**
 * OrderReference — dominio puro.
 *
 * Construye/parsea la referencia de pedido que se manda a Facturama en los
 * campos OrderNumber/Observations (metadatos de la app, NO van en el XML SAT).
 * Formato: "{orderName} {sourceIdentifier}", ej. "#46121 25-4191", igual al
 * que produce hoy la app de autofacturación de Facturama. La futura
 * facturación global mensual usa parseOrderReference para saber si un pedido
 * ya fue timbrado.
 */

/**
 * Construye la referencia normalizada al formato de la app de Facturama:
 * - `orderName`: se toma solo el número después del último '#' y se antepone
 *   '#'. Shopify puede traer prefijo de marca ("WB#1151" → "#1151"); sin
 *   prefijo ("#46121") o sin '#' ("46121") el resultado es "#46121".
 * - `sourceIdentifier`: se reduce a la cola del recibo POS `{deviceId}-{folio}`
 *   ("87008247993-2-1266" → "2-1266") — es lo que el cliente teclea como folio
 *   y lo que la app escribe en "Orden de Compra".
 *
 * Sin sourceIdentifier (null/vacío) → solo "#name".
 */
export function buildOrderReference(
  orderName: string,
  sourceIdentifier: string | null
): string {
  const name = orderName.trim()
  const hashIndex = name.lastIndexOf('#')
  const bareName = hashIndex === -1 ? name : name.slice(hashIndex + 1)
  const normalizedName = `#${bareName}`

  const identifier = sourceIdentifier?.trim()
  if (!identifier) return normalizedName
  return `${normalizedName} ${receiptTail(identifier)}`
}

/**
 * Cola del recibo POS de un sourceIdentifier de Shopify. El formato completo
 * es `{longId}-{deviceId}-{folio}`; el recibo que ve el cliente son los dos
 * últimos segmentos. Con 2 segmentos o menos se regresa tal cual.
 *
 * Exportada porque la facturación global mensual la reutiliza para derivar
 * el folio del ticket que va en `IdentificationNumber` del Item agregado por
 * pedido (ver src/infrastructure/facturama/globalCfdiPayloadBuilder.ts).
 */
export function receiptTail(sourceIdentifier: string): string {
  const parts = sourceIdentifier.split('-')
  return parts.length > 2 ? parts.slice(-2).join('-') : sourceIdentifier
}

export interface ParsedOrderReference {
  orderName: string
  sourceIdentifier: string | null
}

/**
 * Inversa de buildOrderReference. Separa por el primer espacio: todo antes
 * es orderName, todo después (si hay) es sourceIdentifier. Tolera ausencia
 * de sourceIdentifier. Devuelve null si el valor no parsea (vacío/sin nombre).
 */
export function parseOrderReference(value: string): ParsedOrderReference | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) {
    return { orderName: trimmed, sourceIdentifier: null }
  }

  const orderName = trimmed.slice(0, spaceIndex).trim()
  const sourceIdentifier = trimmed.slice(spaceIndex + 1).trim()

  if (!orderName) return null
  return { orderName, sourceIdentifier: sourceIdentifier || null }
}

/**
 * Normaliza cualquier referencia de pedido (histórica o nueva) a la misma
 * forma canónica que produce `buildOrderReference`, para que ambos formatos
 * empaten contra el mismo pedido.
 *
 * Motivación (canal Facturama de InvoicedOrdersGateway, Paso 4): el campo
 * `OrderNumber` de CFDIs históricos trae el formato viejo con prefijo de
 * marca y sourceIdentifier completo (`"#WB#1151 87008247993-2-1266"`),
 * mientras que los emitidos hoy ya vienen en formato nuevo/canónico
 * (`"#1151 2-1266"`). Parsear y reconstruir con `buildOrderReference`
 * reutiliza la MISMA lógica de normalización (bareName tras el último '#',
 * cola del recibo) sin duplicarla — ambos formatos colapsan a la misma
 * llave. Devuelve null si `value` no parsea (ver parseOrderReference).
 */
export function normalizeOrderReference(value: string): string | null {
  const parsed = parseOrderReference(value)
  if (!parsed) return null
  return buildOrderReference(parsed.orderName, parsed.sourceIdentifier)
}
