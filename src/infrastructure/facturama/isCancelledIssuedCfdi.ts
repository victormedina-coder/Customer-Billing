import type { FacturamaCfdiListItem } from './facturamaClient'

export function isCancelledIssuedCfdi(item: FacturamaCfdiListItem): boolean {
  return item.IsActive === false || (typeof item.Status === 'string' && item.Status.trim().toLowerCase() !== 'active')
}
