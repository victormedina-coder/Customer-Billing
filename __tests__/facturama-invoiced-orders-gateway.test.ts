/**
 * Tests de FacturamaInvoicedOrdersGateway (canal 2 de InvoicedOrdersGateway,
 * Paso 4). Mismo patrón que facturama-client.test.ts: fetch mockeado +
 * vi.resetModules() para reimportar con env limpia.
 *
 * Cubre: filtrado por fecha dentro del periodo, exclusión de cancelados
 * (Status/IsActive), omisión de items sin OrderNumber, normalización de
 * referencias en formato histórico y nuevo (deben empatar a la MISMA llave),
 * orderIds siempre vacío, y la URL/auth de la petición.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const FAKE_USER = 'testuser'
const FAKE_PASS = 'testpass'
const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${FAKE_USER}:${FAKE_PASS}`).toString('base64')

async function importGateway() {
  vi.resetModules()
  return import('../src/infrastructure/facturama/FacturamaInvoicedOrdersGateway')
}

async function importPeriod() {
  return import('../src/domain/global/GlobalPeriod')
}

describe('FacturamaInvoicedOrdersGateway.listInvoicedOrderKeys', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('llama a GET /cfdi?type=issued con Basic auth', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys('tienda-ariat', createGlobalPeriod(2026, 6))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/cfdi?type=issued')
    expect(new URL(url).searchParams.get('page')).toBe('0')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(EXPECTED_AUTH)
  })

  it('pasa el rango del periodo (dateStart/dateEnd) al cliente de Facturama', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys('tienda-ariat', createGlobalPeriod(2026, 6))

    const [url] = fetchMock.mock.calls[0] as [string]
    const params = new URL(url).searchParams
    expect(params.get('dateStart')).toBe('01/06/2026')
    expect(params.get('dateEnd')).toBe('30/06/2026')
  })

  it('filtra por Date dentro del rango del periodo (excluye fuera de rango)', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { Id: '1', OrderNumber: '#100 1-1', Date: '2026-06-15T10:00:00Z', Status: 'active' },
        { Id: '2', OrderNumber: '#200 1-2', Date: '2026-05-31T10:00:00Z', Status: 'active' }, // fuera (mayo)
        { Id: '3', OrderNumber: '#300 1-3', Date: '2026-07-02T10:00:00Z', Status: 'active' }, // fuera (julio)
      ])
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderReferences.has('#100 1-1')).toBe(true)
    expect(result.orderReferences.has('#200 1-2')).toBe(false)
    expect(result.orderReferences.has('#300 1-3')).toBe(false)
  })

  it('ignora CFDIs cancelados por Status distinto de "active"', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { Id: '1', OrderNumber: '#100 1-1', Date: '2026-06-15T10:00:00Z', Status: 'cancelled' },
        { Id: '2', OrderNumber: '#200 1-2', Date: '2026-06-15T10:00:00Z', Status: 'active' },
      ])
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderReferences.has('#100 1-1')).toBe(false)
    expect(result.orderReferences.has('#200 1-2')).toBe(true)
  })

  it('ignora CFDIs cancelados por IsActive === false', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { Id: '1', OrderNumber: '#100 1-1', Date: '2026-06-15T10:00:00Z', IsActive: false },
        { Id: '2', OrderNumber: '#200 1-2', Date: '2026-06-15T10:00:00Z', IsActive: true },
      ])
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderReferences.has('#100 1-1')).toBe(false)
    expect(result.orderReferences.has('#200 1-2')).toBe(true)
  })

  it('omite items sin OrderNumber (clave ausente, no null/vacía)', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ Id: '1', Date: '2026-06-15T10:00:00Z', Status: 'active' }])
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderReferences.size).toBe(0)
  })

  it('parsea y NORMALIZA formato histórico (prefijo de marca + sourceIdentifier completo)', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { Id: '1', OrderNumber: '#WB#1151 87008247993-2-1266', Date: '2026-06-15T10:00:00Z', Status: 'active' },
      ])
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderReferences.has('#1151 2-1266')).toBe(true)
  })

  it('formato histórico y formato nuevo del MISMO pedido empatan a la MISMA llave', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { Id: '1', OrderNumber: '#WB#1151 87008247993-2-1266', Date: '2026-06-10T10:00:00Z', Status: 'active' },
        { Id: '2', OrderNumber: '#1151 2-1266', Date: '2026-06-20T10:00:00Z', Status: 'active' },
      ])
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    // Ambos colapsan a la misma referencia normalizada — el Set deduplica.
    expect(result.orderReferences.size).toBe(1)
    expect(result.orderReferences.has('#1151 2-1266')).toBe(true)
  })

  it('orderIds siempre es un Set vacío (este canal solo matchea por referencia)', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ Id: '1', OrderNumber: '#100 1-1', Date: '2026-06-15T10:00:00Z', Status: 'active' }])
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderIds.size).toBe(0)
  })

  it('acepta la respuesta envuelta en { Items: [...] } además de array plano', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Items: [{ Id: '1', OrderNumber: '#100 1-1', Date: '2026-06-15T10:00:00Z', Status: 'active' }] })
    )

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderReferences.has('#100 1-1')).toBe(true)
  })

  it('item sin Date (ausente) se excluye (no se puede confirmar el periodo)', async () => {
    const { FacturamaInvoicedOrdersGateway } = await importGateway()
    const { createGlobalPeriod } = await importPeriod()
    fetchMock.mockResolvedValueOnce(jsonResponse([{ Id: '1', OrderNumber: '#100 1-1', Status: 'active' }]))

    const result = await new FacturamaInvoicedOrdersGateway().listInvoicedOrderKeys(
      'tienda-ariat',
      createGlobalPeriod(2026, 6)
    )

    expect(result.orderReferences.size).toBe(0)
  })
})
