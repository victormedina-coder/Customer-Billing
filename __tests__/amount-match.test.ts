/**
 * Tests unitarios para lib/amount-match.ts
 *
 * Cubre: toCents (conversión a centavos) y amountMatches (comparación al centavo).
 */

import { describe, it, expect } from 'vitest'
import { toCents, amountMatches } from '../lib/amount-match'

// ─────────────────────────────────────────────────────────────────────────────
// toCents
// ─────────────────────────────────────────────────────────────────────────────

describe('toCents', () => {
  it('convierte número entero a centavos', () => {
    expect(toCents(100)).toBe(10000)
  })

  it('convierte número decimal a centavos redondeando', () => {
    expect(toCents(116.00)).toBe(11600)
    expect(toCents(1234.56)).toBe(123456)
  })

  it('maneja correctamente el redondeo de punto flotante', () => {
    // Sin redondeo Math.round: 1234.10 * 100 = 123409.99999... → 123409 (mal)
    // Con Math.round: 123410 (correcto)
    expect(toCents(1234.10)).toBe(123410)
    // Otro caso clásico de punto flotante
    expect(toCents(0.1 + 0.2)).toBe(30)
  })

  it('acepta string con símbolo de peso', () => {
    expect(toCents('$116.00')).toBe(11600)
    expect(toCents('$ 1,234.56')).toBe(123456)
  })

  it('acepta string con "MXN"', () => {
    expect(toCents('MXN 116.00')).toBe(11600)
  })

  it('acepta string sin símbolo (solo número)', () => {
    expect(toCents('116')).toBe(11600)
    expect(toCents('1234.50')).toBe(123450)
  })

  it('acepta string con comas como separador de miles', () => {
    expect(toCents('1,234.56')).toBe(123456)
  })

  it('acepta número cero (caso borde — el schema Zod lo rechaza antes, pero el helper no debe explotar)', () => {
    expect(toCents(0)).toBe(0)
  })

  it('lanza RangeError con string no numérico', () => {
    expect(() => toCents('abc')).toThrow(RangeError)
  })

  it('lanza RangeError con número negativo', () => {
    expect(() => toCents(-100)).toThrow(RangeError)
  })

  it('lanza RangeError con string que resulta en NaN', () => {
    expect(() => toCents('$$$')).toThrow(RangeError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// amountMatches
// ─────────────────────────────────────────────────────────────────────────────

describe('amountMatches', () => {
  it('devuelve true cuando los montos son exactamente iguales', () => {
    expect(amountMatches(116, 116)).toBe(true)
    expect(amountMatches(1234.56, 1234.56)).toBe(true)
  })

  it('devuelve false cuando los montos difieren en un centavo', () => {
    expect(amountMatches(116.00, 116.01)).toBe(false)
    expect(amountMatches(116.01, 116.00)).toBe(false)
  })

  it('devuelve false cuando los montos difieren en pesos enteros', () => {
    expect(amountMatches(100, 116)).toBe(false)
    expect(amountMatches(200, 116)).toBe(false)
  })

  it('acepta clientAmount como string formateado', () => {
    expect(amountMatches('$116.00', 116)).toBe(true)
    expect(amountMatches('$116.01', 116)).toBe(false)
  })

  it('acepta clientAmount como string con comas', () => {
    expect(amountMatches('1,234.56', 1234.56)).toBe(true)
  })

  it('devuelve false (sin lanzar) cuando clientAmount es inválido', () => {
    expect(amountMatches('no-es-numero', 116)).toBe(false)
    expect(amountMatches('$$$', 116)).toBe(false)
  })

  it('es simétrico solo cuando ambos lados son válidos', () => {
    // Verifica que no haya sesgo de dirección
    expect(amountMatches(116.50, 116.50)).toBe(true)
  })

  it('maneja punto flotante correctamente (caso real: 0.1 + 0.2)', () => {
    // Un total hipotético de $0.30 debe coincidir con 0.1+0.2
    expect(amountMatches(0.1 + 0.2, 0.30)).toBe(true)
  })
})
