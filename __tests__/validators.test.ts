import { describe, it, expect } from 'vitest'
import {
  isValidRfcFormat,
  isValidEmail,
  isValidCp,
  validateFiscal,
} from '../app/(portal)/_lib/validators'

describe('isValidRfcFormat', () => {
  it('RFC persona moral 12 chars → true', () => {
    expect(isValidRfcFormat('EKU9003173C9')).toBe(true)
  })
  it('RFC persona física 13 chars con X de homonimia → true', () => {
    expect(isValidRfcFormat('VECJ880326XXX')).toBe(true)
  })
  it("'RFC123' muy corto → false", () => {
    expect(isValidRfcFormat('RFC123')).toBe(false)
  })
  it('número puro 14 chars → false', () => {
    expect(isValidRfcFormat('12345678901234')).toBe(false)
  })
  it('minúsculas → true (.toUpperCase() interno)', () => {
    expect(isValidRfcFormat('eku9003173c9')).toBe(true)
  })
  it('RFC con & (persona moral SAT) → true', () => {
    expect(isValidRfcFormat('P&G900101AB3')).toBe(true)
  })
  it('cadena vacía → false', () => {
    expect(isValidRfcFormat('')).toBe(false)
  })
})

describe('isValidEmail', () => {
  it("'user@example.com' → true", () => {
    expect(isValidEmail('user@example.com')).toBe(true)
  })
  it("'user@sub.domain.mx' → true", () => {
    expect(isValidEmail('user@sub.domain.mx')).toBe(true)
  })
  it("'sinArroba' → false", () => {
    expect(isValidEmail('sinArroba')).toBe(false)
  })
  it("'a@b' sin TLD → false", () => {
    expect(isValidEmail('a@b')).toBe(false)
  })
  it("cadena vacía → false", () => {
    expect(isValidEmail('')).toBe(false)
  })
})

describe('isValidCp', () => {
  it("'78000' → true", () => {
    expect(isValidCp('78000')).toBe(true)
  })
  it("'01234' → true", () => {
    expect(isValidCp('01234')).toBe(true)
  })
  it("'1234' (4 dígitos) → false", () => {
    expect(isValidCp('1234')).toBe(false)
  })
  it("'123456' (6 dígitos) → false", () => {
    expect(isValidCp('123456')).toBe(false)
  })
  it("'abcde' → false", () => {
    expect(isValidCp('abcde')).toBe(false)
  })
  it("'  78000  ' con espacios → true (.trim() interno)", () => {
    expect(isValidCp('  78000  ')).toBe(true)
  })
})

describe('validateFiscal', () => {
  const validData = {
    rfc: 'EKU9003173C9',
    razon: 'ESCUELA KEMPER URGATE',
    regimen: '601',
    cp: '26015',
    uso: 'G01',
    email: 'test@test.com',
  }

  it('datos válidos completos → objeto de errores vacío {}', () => {
    expect(validateFiscal(validData)).toEqual({})
  })
  it('RFC inválido → errors.rfc definido, los demás no', () => {
    const errors = validateFiscal({ ...validData, rfc: 'INVALIDO' })
    expect(errors.rfc).toBeDefined()
    expect(errors.razon).toBeUndefined()
    expect(errors.email).toBeUndefined()
  })
  it('razón social vacía → errors.razon definido', () => {
    const errors = validateFiscal({ ...validData, razon: '' })
    expect(errors.razon).toBeDefined()
  })
  it('email inválido → errors.email definido', () => {
    const errors = validateFiscal({ ...validData, email: 'no-es-email' })
    expect(errors.email).toBeDefined()
  })
  it('CP incorrecto → errors.cp definido', () => {
    const errors = validateFiscal({ ...validData, cp: '123' })
    expect(errors.cp).toBeDefined()
  })
  it('sin régimen → errors.regimen definido', () => {
    const errors = validateFiscal({ ...validData, regimen: '' })
    expect(errors.regimen).toBeDefined()
  })
})
