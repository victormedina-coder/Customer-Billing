import { describe, expect, it } from 'vitest'
import { selectEmitErrorMessage } from '../app/(portal)/_lib/emitErrorMessage'

describe('selectEmitErrorMessage', () => {
  it.each([
    'No pudimos confirmar si se generó la factura. Contacta a facturación antes de reintentar.',
    'No pudimos liberar la reserva de facturación. Contacta a facturación antes de reintentar.',
    'La factura se generó, pero no pudimos confirmar su registro. Contacta a soporte; no vuelvas a facturar este pedido.',
  ])('preserva el mensaje de recuperación del servidor: %s', (message) => {
    expect(selectEmitErrorMessage(message)).toBe(message)
  })

  it.each([undefined, null, '', '   ', 42])('usa el genérico sin mensaje válido: %s', (message) => {
    expect(selectEmitErrorMessage(message)).toBe('Error al generar la factura. Intenta de nuevo más tarde.')
  })
})
