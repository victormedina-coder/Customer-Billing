import { describe, it, expect } from 'vitest'
import { PaymentBucketPolicy } from '../src/domain/global/PaymentBucketPolicy'

describe('PaymentBucketPolicy.classify — una sola forma de pago', () => {
  it('un solo pago crédito → crédito', () => {
    expect(PaymentBucketPolicy.classify([{ gateway: 'credit_card', amount: 100 }])).toBe('credito')
  })

  it('un solo pago débito → débito', () => {
    expect(PaymentBucketPolicy.classify([{ gateway: 'debit_card', amount: 300 }])).toBe('debito')
  })

  it('un solo pago efectivo → efectivo', () => {
    expect(PaymentBucketPolicy.classify([{ gateway: 'cash', amount: 200 }])).toBe('efectivo')
  })

  it('varias transacciones del MISMO bucket (dos capturas de crédito) se quedan en ese bucket', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'credit_card', amount: 50 },
      { gateway: 'credit_card', amount: 90 },
    ])
    expect(result).toBe('credito')
  })

  it('varias transacciones del mismo bucket usando distintos alias del mismo gateway (efectivo)', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'cash', amount: 50 },
      { gateway: 'efectivo', amount: 60 },
    ])
    expect(result).toBe('efectivo')
  })

  it('lista vacía → unmapped', () => {
    expect(PaymentBucketPolicy.classify([])).toBe('unmapped')
  })

  it('gateway no reconocido → unmapped', () => {
    expect(PaymentBucketPolicy.classify([{ gateway: 'mercado_pago', amount: 100 }])).toBe('unmapped')
  })

  it('gateway "transfer" no tiene bucket propio → unmapped', () => {
    expect(PaymentBucketPolicy.classify([{ gateway: 'transfer', amount: 500 }])).toBe('unmapped')
  })

  it.each(['Tarjeta', 'tarjeta', 'TARJETA'])(
    'pedido con solo "%s" (gateway genérico histórico Ariat) → bucket credito (decisión finanzas 2026-07-10)',
    (gateway) => {
      expect(PaymentBucketPolicy.classify([{ gateway, amount: 100 }])).toBe('credito')
    },
  )

  it('varios gateways desconocidos distintos, todos unmapped → unmapped (sigue siendo una sola "forma")', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'mercado_pago', amount: 100 },
      { gateway: 'oxxo_pay', amount: 50 },
    ])
    expect(result).toBe('unmapped')
  })
})

describe('PaymentBucketPolicy.classify — varias formas de pago distintas → credito (decisión 2026-07-10)', () => {
  it('$200 efectivo + $300 débito → credito (ejemplo real, ya NO gana por monto)', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'cash', amount: 200 },
      { gateway: 'debit_card', amount: 300 },
    ])
    expect(result).toBe('credito')
  })

  it('crédito + débito → credito', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'credit_card', amount: 100 },
      { gateway: 'debit_card', amount: 100 },
    ])
    expect(result).toBe('credito')
  })

  it('débito + efectivo → credito (no gana débito aunque tenga más monto)', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'debit_card', amount: 900 },
      { gateway: 'cash', amount: 10 },
    ])
    expect(result).toBe('credito')
  })

  it('crédito + débito + efectivo (triple forma) → credito', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'credit_card', amount: 50 },
      { gateway: 'debit_card', amount: 50 },
      { gateway: 'cash', amount: 50 },
    ])
    expect(result).toBe('credito')
  })

  it('mezcla de bucket mapeado + gateway desconocido → credito', () => {
    const result = PaymentBucketPolicy.classify([
      { gateway: 'cash', amount: 10 },
      { gateway: 'mercado_pago', amount: 1000 },
    ])
    expect(result).toBe('credito')
  })
})
