export interface IssuedCfdiItemsLookup {
  getItems(facturamaId: string): Promise<string[]>
}
