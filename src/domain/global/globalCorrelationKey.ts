export function globalCorrelationKey(headerId: string): string {
  return `GLB:${headerId}`
}

export function normalizeGlobalCorrelationKey(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized?.startsWith('GLB:') ? normalized : undefined
}
