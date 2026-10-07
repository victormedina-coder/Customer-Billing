/** Failure before the CFDI POST: Facturama could not have stamped it. */
export class StampPreparationError extends Error {
  constructor(cause: unknown) {
    super('No se pudo preparar el CFDI antes de enviarlo a Facturama', { cause })
    this.name = 'StampPreparationError'
  }
}
