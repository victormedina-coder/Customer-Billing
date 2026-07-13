import { describe, it, expect } from 'vitest'
import { GlobalChunkPolicy } from '../src/domain/global/GlobalChunkPolicy'

describe('GlobalChunkPolicy.chunk', () => {
  it('0 items → []', () => {
    expect(GlobalChunkPolicy.chunk([], 10)).toEqual([])
  })

  it('exactamente maxPerChunk items → 1 solo chunk', () => {
    const items = [1, 2, 3]
    expect(GlobalChunkPolicy.chunk(items, 3)).toEqual([[1, 2, 3]])
  })

  it('maxPerChunk + 1 items → 2 chunks, el segundo con 1 item', () => {
    const items = [1, 2, 3, 4]
    expect(GlobalChunkPolicy.chunk(items, 3)).toEqual([[1, 2, 3], [4]])
  })

  it('varios chunks completos', () => {
    const items = [1, 2, 3, 4, 5, 6]
    expect(GlobalChunkPolicy.chunk(items, 2)).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('maxPerChunk mayor que items.length → 1 chunk con todos', () => {
    const items = [1, 2]
    expect(GlobalChunkPolicy.chunk(items, 100)).toEqual([[1, 2]])
  })

  it('maxPerChunk = 0 → lanza', () => {
    expect(() => GlobalChunkPolicy.chunk([1, 2], 0)).toThrow(/maxPerChunk inválido/)
  })

  it('maxPerChunk negativo → lanza', () => {
    expect(() => GlobalChunkPolicy.chunk([1, 2], -1)).toThrow(/maxPerChunk inválido/)
  })

  it('maxPerChunk no entero → lanza', () => {
    expect(() => GlobalChunkPolicy.chunk([1, 2], 1.5)).toThrow(/maxPerChunk inválido/)
  })

  it('no muta el arreglo original', () => {
    const items = [1, 2, 3, 4]
    const original = [...items]
    GlobalChunkPolicy.chunk(items, 2)
    expect(items).toEqual(original)
  })
})
