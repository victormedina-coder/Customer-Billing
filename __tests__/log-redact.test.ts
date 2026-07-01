import { describe, it, expect } from 'vitest'
import { maskEmail, maskRfc } from '../src/infrastructure/observability/logRedact'

describe('maskEmail', () => {
  it('enmascara email normal conservando primera letra y dominio', () => {
    expect(maskEmail('juan.perez@gmail.com')).toBe('j***@gmail.com')
  })

  it('enmascara email con local de un solo carácter', () => {
    expect(maskEmail('a@dominio.mx')).toBe('a***@dominio.mx')
  })

  it('devuelve *** cuando no hay @', () => {
    expect(maskEmail('noesuncorreo')).toBe('***')
  })

  it('devuelve "" para string vacío', () => {
    expect(maskEmail('')).toBe('')
  })

  it('devuelve "" para null', () => {
    expect(maskEmail(null)).toBe('')
  })

  it('devuelve "" para undefined', () => {
    expect(maskEmail(undefined)).toBe('')
  })
})

describe('maskRfc', () => {
  it('enmascara RFC normal conservando los primeros 3 caracteres', () => {
    expect(maskRfc('EKU9003173C9')).toBe('EKU***')
  })

  it('enmascara RFC de persona física (13 chars)', () => {
    expect(maskRfc('GODE561231GR8')).toBe('GOD***')
  })

  it('devuelve "" para string vacío', () => {
    expect(maskRfc('')).toBe('')
  })

  it('devuelve "" para null', () => {
    expect(maskRfc(null)).toBe('')
  })

  it('devuelve "" para undefined', () => {
    expect(maskRfc(undefined)).toBe('')
  })
})
