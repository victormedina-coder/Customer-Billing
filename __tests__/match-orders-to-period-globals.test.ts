import { describe, expect, it } from 'vitest'
import { matchOrdersToPeriodGlobals } from '../src/domain/global/matchOrdersToPeriodGlobals'

const order = (orderId: string, reference: string, tail: string) => ({ orderId, reference, tail })
const global = (facturamaId: string, serieFolio: string, ...items: string[]) => ({
  facturamaId,
  serieFolio,
  items,
})

describe('matchOrdersToPeriodGlobals', () => {
  it('reconoce el formato manual #pedido cola', () => {
    const result = matchOrdersToPeriodGlobals(
      [order('a', '#47534 29-1125', '29-1125')],
      [global('g1', 'GDL1-1', '#47534 29-1125')],
    )
    expect(result.matches.get('a')).toEqual({ held: false, serieFolios: ['GDL1-1'] })
  })

  it('reconoce la cola del cron con E=1 y O=1', () => {
    const result = matchOrdersToPeriodGlobals(
      [order('a', '#47534 29-2252', '29-2252')],
      [global('g1', 'GDL1-1', '29-2252')],
    )
    expect(result.matches.get('a')).toEqual({ held: false, serieFolios: ['GDL1-1'] })
  })

  it('retiene ambos pedidos cuando E=2 y O=1', () => {
    const result = matchOrdersToPeriodGlobals(
      [
        order('a', '#47534 29-2252', '29-2252'),
        order('c', '#47536 29-2252', '29-2252'),
      ],
      [global('g1', 'GDL1-1', '29-2252')],
    )
    expect(result.matches.get('a')).toEqual({ held: true, serieFolios: ['GDL1-1'] })
    expect(result.matches.get('c')).toEqual({ held: true, serieFolios: ['GDL1-1'] })
  })

  it('excluye el pedido cuando E=1 y O=2', () => {
    const result = matchOrdersToPeriodGlobals(
      [order('a', '#47534 29-2252', '29-2252')],
      [global('g1', 'GDL1-1', '29-2252', '29-2252')],
    )
    expect(result.matches.get('a')).toEqual({ held: false, serieFolios: ['GDL1-1'] })
  })

  it('cuenta A antes de excluir por BD y retiene tanto A como C', () => {
    const result = matchOrdersToPeriodGlobals(
      [
        order('already-in-db', '#47534 29-2252', '29-2252'),
        order('candidate', '#47536 29-2252', '29-2252'),
      ],
      [global('g1', 'GDL1-1', '29-2252')],
    )
    expect(result.matches.get('already-in-db')?.held).toBe(true)
    expect(result.matches.get('candidate')?.held).toBe(true)
  })

  it('reporta #pedido sin cola y un concepto vacío', () => {
    const result = matchOrdersToPeriodGlobals(
      [order('a', '#47534 29-2252', '29-2252')],
      [global('g1', 'GDL1-1', ' #47534 ', '  ')],
    )
    expect(result.unrecognized).toEqual([
      { facturamaId: 'g1', value: '#47534' },
      { facturamaId: 'g1', value: '' },
    ])
    expect(result.matches.size).toBe(0)
  })

  it('recorta espacios alrededor de la cola', () => {
    const result = matchOrdersToPeriodGlobals(
      [order('a', '#47534 29-2252', '29-2252')],
      [global('g1', 'GDL1-1', ' 29-2252 ')],
    )
    expect(result.matches.get('a')).toEqual({ held: false, serieFolios: ['GDL1-1'] })
  })

  it('acumula dos serieFolios sin duplicarlos', () => {
    const result = matchOrdersToPeriodGlobals(
      [order('a', '#47534 29-2252', '29-2252')],
      [
        global('g1', 'GDL1-1', '29-2252'),
        global('g2', 'GDL1-2', '29-2252'),
        global('g3', 'GDL1-1', '29-2252'),
      ],
    )
    expect(result.matches.get('a')).toEqual({
      held: false,
      serieFolios: ['GDL1-1', 'GDL1-2'],
    })
  })

  it('no produce coincidencias para una global sin conceptos', () => {
    const result = matchOrdersToPeriodGlobals(
      [order('a', '#47534 29-2252', '29-2252')],
      [global('g1', 'GDL1-1')],
    )
    expect(result.matches.size).toBe(0)
    expect(result.unrecognized).toEqual([])
  })

  it('omite un pedido sin coincidencia del Map', () => {
    const result = matchOrdersToPeriodGlobals(
      [
        order('a', '#47534 29-2252', '29-2252'),
        order('other', '#47537 99-1', '99-1'),
      ],
      [global('g1', 'GDL1-1', '29-2252')],
    )
    expect(result.matches.has('a')).toBe(true)
    expect(result.matches.has('other')).toBe(false)
  })

  it('excluye el empate por referencia pero cuenta ambos pedidos en E de cola', () => {
    const result = matchOrdersToPeriodGlobals(
      [
        order('a', '#47534 29-1125', '29-1125'),
        order('b', '#47535 29-1125', '29-1125'),
      ],
      [global('g1', 'GDL1-1', '#47534 29-1125', '29-1125')],
    )
    expect(result.matches.get('a')).toEqual({ held: false, serieFolios: ['GDL1-1'] })
    expect(result.matches.get('b')).toEqual({ held: true, serieFolios: ['GDL1-1'] })
  })

  it('retiene la cola ambigua cuando referencia y cola están en globales distintas', () => {
    const result = matchOrdersToPeriodGlobals(
      [
        order('p1', '#1001 t', 't'),
        order('p2', '#1002 t', 't'),
      ],
      [
        global('global-a', 'GDL1-1', 't'),
        global('global-b', 'GDL1-2', '#1001 t'),
      ],
    )
    expect(result.matches.get('p1')).toEqual({ held: false, serieFolios: ['GDL1-2'] })
    expect(result.matches.get('p2')).toEqual({ held: true, serieFolios: ['GDL1-1'] })
  })
})
