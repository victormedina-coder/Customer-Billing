import type { SelectOption, Ticket } from './types'

export const REGIMENES: SelectOption[] = [
  { code: '605', label: '605 · Sueldos y salarios e ingresos asimilados' },
  { code: '612', label: '612 · Actividades empresariales y profesionales' },
  { code: '626', label: '626 · Régimen Simplificado de Confianza (RESICO)' },
  { code: '616', label: '616 · Sin obligaciones fiscales' },
  { code: '601', label: '601 · General de Ley Personas Morales' },
  { code: '603', label: '603 · Personas Morales con Fines no Lucrativos' },
]

export const USOS_CFDI: SelectOption[] = [
  { code: 'G01', label: 'G01 · Adquisición de mercancías' },
  { code: 'G03', label: 'G03 · Gastos en general' },
  // { code: 'D01', label: 'D01 · Honorarios médicos y gastos hospitalarios' },
  // { code: 'CP01', label: 'CP01 · Pagos' },
  { code: 'S01', label: 'S01 · Sin efectos fiscales' },
]

export const METODO_PAGO_LABEL = 'PUE · Pago en una sola exhibición'

// Tickets de demo — usados solo cuando NEXT_PUBLIC_LOOKUP_MOCK=true
// En producción los tickets vienen de Shopify vía /api/invoice/lookup.
export const DEMO_TICKETS: Record<string, Ticket> = {
  'A1522-0847': {
    folio: 'A1522-0847', fecha: '14/06/2026', hora: '18:42',
    sucursal: 'Grupo1522 · Plaza Central', total: 2499.00, status: 'ok',
    formaPago: '04 · Tarjeta de crédito',
    items: [
      { desc: 'Playera Oversize Algodón Pima', sku: 'PL-1180', qty: 2, unit: 649.50 },
      { desc: 'Jeans Slim Índigo Premium', sku: 'JN-3320', qty: 1, unit: 1200.00 },
    ],
  },
  'A1522-1203': {
    folio: 'A1522-1203', fecha: '10/06/2026', hora: '13:05',
    sucursal: 'Grupo1522 · Galerías', total: 1799.00, status: 'invoiced',
    formaPago: '01 · Efectivo',
    items: [{ desc: 'Sudadera con Capucha', sku: 'SD-2204', qty: 1, unit: 1799.00 }],
    facturaFolio: 'GR-008912', fechaTimbrado: '10/06/2026 20:15',
  },
  'A1522-5501': {
    folio: 'A1522-5501', fecha: '15/06/2026', hora: '11:20',
    sucursal: 'Grupo1522 · Antara', total: 3250.00, status: 'ok',
    formaPago: '28 · Tarjeta de débito',
    items: [
      { desc: 'Chamarra Piel Sintética', sku: 'CH-0890', qty: 1, unit: 2750.00 },
      { desc: 'Cinturón Piel Clásico', sku: 'CI-0220', qty: 1, unit: 500.00 },
    ],
  },
}

