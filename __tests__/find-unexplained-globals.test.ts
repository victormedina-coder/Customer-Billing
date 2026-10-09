import { describe, expect, it } from 'vitest'
import { findUnexplainedGlobals } from '../src/domain/global/findUnexplainedGlobals'
import type { IssuedCfdiRef } from '../src/domain/global/ports/IssuedCfdiLookup'

const base: IssuedCfdiRef = { facturamaId: 'f1', active: true, rfc: 'XAXX010101000' }

describe('findUnexplainedGlobals', () => {
  it.each([
    ['GLB huérfana', { orderNumber: 'GLB:h1' }, true],
    ['pedido', { orderNumber: '#123' }, false],
    ['sin OrderNumber', {}, true],
    ['cancelada', { active: false }, false],
    ['otro RFC', { rfc: 'AAA010101AAA' }, false],
    ['OrderNumber vacío', { orderNumber: '' }, true],
    ['texto de global manual', { orderNumber: 'GLOBAL MANUAL' }, true],
  ] as const)('%s', (_name, override, expected) => {
    expect(findUnexplainedGlobals([{ ...base, ...override }], new Set()).length > 0).toBe(expected)
  })

  it('omite IDs conocidos', () => {
    expect(findUnexplainedGlobals([base], new Set(['f1']))).toEqual([])
  })

  it('omite una llave conocida con espacios y distinta capitalización', () => {
    expect(findUnexplainedGlobals([{ ...base, orderNumber: ' glb:H1 ' }], new Set(), new Set(['GLB:H1']))).toEqual([])
  })

  it('veta una llave GLB huérfana aunque el listado no traiga RFC', () => {
    expect(findUnexplainedGlobals([{ ...base, rfc: undefined, orderNumber: ' glb:orphan ' }], new Set())).toHaveLength(1)
  })
})
