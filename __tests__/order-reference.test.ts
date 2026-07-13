import { describe, it, expect } from 'vitest'
import {
  buildOrderReference,
  parseOrderReference,
  normalizeOrderReference,
  receiptTail,
} from '../src/domain/orders/OrderReference'

describe('buildOrderReference', () => {
  it('name con # + sourceIdentifier → "#name identifier"', () => {
    expect(buildOrderReference('#46121', '25-4191')).toBe('#46121 25-4191')
  })

  it('name sin # → antepone # para igualar el formato de la app', () => {
    expect(buildOrderReference('46121', '25-4191')).toBe('#46121 25-4191')
  })

  it('sourceIdentifier null → solo "#name"', () => {
    expect(buildOrderReference('#46121', null)).toBe('#46121')
  })

  it('sourceIdentifier vacío/espacios → solo "#name"', () => {
    expect(buildOrderReference('#46121', '   ')).toBe('#46121')
    expect(buildOrderReference('#46121', '')).toBe('#46121')
  })

  it('recorta espacios extra en name y sourceIdentifier', () => {
    expect(buildOrderReference('  #46121  ', '  25-4191  ')).toBe('#46121 25-4191')
  })

  it('name con prefijo de marca ("WB#1151") → se queda solo el número ("#1151")', () => {
    expect(buildOrderReference('WB#1151', '2-1266')).toBe('#1151 2-1266')
  })

  it('sourceIdentifier completo de Shopify → se reduce a la cola del recibo {deviceId}-{folio}', () => {
    expect(buildOrderReference('WB#1151', '87008247993-2-1266')).toBe('#1151 2-1266')
  })

  it('sourceIdentifier de 2 segmentos (ya es el recibo) → se queda tal cual', () => {
    expect(buildOrderReference('#46121', '25-4191')).toBe('#46121 25-4191')
  })

  it('sourceIdentifier de 1 segmento → se queda tal cual', () => {
    expect(buildOrderReference('#46121', '4191')).toBe('#46121 4191')
  })
})

describe('parseOrderReference', () => {
  it('parsea "#name identifier" a sus dos partes', () => {
    expect(parseOrderReference('#46121 25-4191')).toEqual({
      orderName: '#46121',
      sourceIdentifier: '25-4191',
    })
  })

  it('sin sourceIdentifier (solo name) → sourceIdentifier null', () => {
    expect(parseOrderReference('#46121')).toEqual({
      orderName: '#46121',
      sourceIdentifier: null,
    })
  })

  it('tolera espacios extra alrededor y entre las partes', () => {
    expect(parseOrderReference('  #46121   25-4191  ')).toEqual({
      orderName: '#46121',
      sourceIdentifier: '25-4191',
    })
  })

  it('string vacío → null', () => {
    expect(parseOrderReference('')).toBeNull()
    expect(parseOrderReference('   ')).toBeNull()
  })

  it('es la inversa de buildOrderReference', () => {
    const built = buildOrderReference('#46121', '25-4191')
    expect(parseOrderReference(built)).toEqual({
      orderName: '#46121',
      sourceIdentifier: '25-4191',
    })
  })

  it('es la inversa de buildOrderReference sin sourceIdentifier', () => {
    const built = buildOrderReference('46121', null)
    expect(parseOrderReference(built)).toEqual({
      orderName: '#46121',
      sourceIdentifier: null,
    })
  })
})

describe('receiptTail', () => {
  it('sourceIdentifier de 3+ segmentos → cola de 2 segmentos (deviceId-folio)', () => {
    expect(receiptTail('87008247993-2-1266')).toBe('2-1266')
  })

  it('sourceIdentifier de 2 segmentos → se queda tal cual', () => {
    expect(receiptTail('2-1266')).toBe('2-1266')
  })

  it('sourceIdentifier de 1 segmento → se queda tal cual', () => {
    expect(receiptTail('1266')).toBe('1266')
  })
})

describe('normalizeOrderReference — empata formato histórico y nuevo (Paso 4, canal Facturama)', () => {
  it('formato histórico con prefijo de marca y sourceIdentifier completo → forma canónica', () => {
    expect(normalizeOrderReference('#WB#1151 87008247993-2-1266')).toBe('#1151 2-1266')
  })

  it('formato nuevo/canónico → se queda igual (idempotente)', () => {
    expect(normalizeOrderReference('#1151 2-1266')).toBe('#1151 2-1266')
  })

  it('histórico y nuevo del MISMO pedido normalizan a la MISMA llave', () => {
    const historico = normalizeOrderReference('#WB#1151 87008247993-2-1266')
    const nuevo = normalizeOrderReference('#1151 2-1266')
    expect(historico).toBe(nuevo)
  })

  it('solo orderName sin sourceIdentifier → "#name"', () => {
    expect(normalizeOrderReference('#46121')).toBe('#46121')
  })

  it('orderName sin "#" → se antepone', () => {
    expect(normalizeOrderReference('46121 25-4191')).toBe('#46121 25-4191')
  })

  it('string vacío → null', () => {
    expect(normalizeOrderReference('')).toBeNull()
    expect(normalizeOrderReference('   ')).toBeNull()
  })
})
