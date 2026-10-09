export interface IssuedCfdiRef {
  facturamaId: string
  correlationKey?: string
  uuid?: string
  active: boolean
  serieFolio?: string
  orderNumber?: string
  rfc?: string
  total?: number
  date?: string
}

export interface IssuedCfdiLookup {
  listIssuedBetween(from: Date, to: Date): Promise<IssuedCfdiRef[]>
}
