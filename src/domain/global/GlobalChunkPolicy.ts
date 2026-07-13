/**
 * GlobalChunkPolicy — dominio puro.
 *
 * Facturama (y el SAT) limitan cuántas partidas puede llevar un solo CFDI.
 * Esta policy parte una lista de items (pedidos ya agrupados por
 * tienda/mes/bucket) en chunks de tamaño máximo `maxPerChunk`, cada uno
 * convertido en un CFDI global independiente (ver GlobalInvoice.chunkIndex).
 */

export const GlobalChunkPolicy = {
  /**
   * Parte `items` en sub-listas de a lo más `maxPerChunk` elementos, en
   * orden. Lista vacía → [] (cero chunks). `maxPerChunk` debe ser >= 1.
   */
  chunk<T>(items: readonly T[], maxPerChunk: number): T[][] {
    if (!Number.isInteger(maxPerChunk) || maxPerChunk < 1) {
      throw new Error(`GlobalChunkPolicy.chunk: maxPerChunk inválido (${maxPerChunk}), debe ser un entero >= 1`)
    }

    if (items.length === 0) return []

    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += maxPerChunk) {
      chunks.push(items.slice(i, i + maxPerChunk))
    }
    return chunks
  },
}
