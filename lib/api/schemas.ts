import { z } from 'zod'
import { RFC_REGEX } from '../../src/domain/fiscal/Rfc'

const RFC_RE = RFC_REGEX

export const LookupSchema = z.object({
  folio: z.string().min(1, 'El folio no puede estar vacío').max(50),
  /**
   * Monto total del ticket que el cliente ve en su recibo (en pesos, con centavos).
   * z.coerce.number() acepta tanto number como string numérico del body JSON.
   * Debe ser > 0 — un ticket de $0 no puede facturarse (ya lo bloquea FULLY_REFUNDED,
   * pero la validación de schema es una capa adicional de defensa temprana).
   */
  amount: z.coerce.number().positive('El monto debe ser mayor a cero'),
})

export const FiscalDataSchema = z.object({
  rfc: z.string().regex(RFC_RE, 'RFC inválido (formato requerido: 12-13 caracteres)'),
  razon: z.string()
    .min(3, 'Nombre o razón social requerido (mín. 3 caracteres)')
    .max(300)
    .regex(
      /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,&'/()\-]+$/,
      'La razón social contiene caracteres no permitidos'
    ),
  regimen: z.string().min(2, 'Régimen fiscal requerido').max(10),
  cp: z.string().regex(/^[0-9]{5}$/, 'Código postal inválido (5 dígitos)'),
  uso: z.string().min(2, 'Uso del CFDI requerido').max(10),
  email: z.string().email('Correo electrónico inválido'),
})

export const FiscalValidateSchema = z.object({
  rfc: z.string().regex(RFC_RE, 'RFC inválido'),
  // Todos los campos son requeridos: el endpoint solo acepta validación de conjunto completo.
  // El modo "status" (solo rfc) fue eliminado para evitar un oráculo de existencia de RFC.
  name: z.string().min(1).max(300),
  zipCode: z.string().regex(/^[0-9]{5}$/, 'Código postal inválido'),
  fiscalRegime: z.string().min(1).max(10),
})

/**
 * Consentimiento legal (Aviso de Privacidad + Términos y Condiciones) que el
 * usuario debe aceptar para emitir un CFDI. Ambos flags deben llegar en `true`
 * — la UI ya bloquea el envío si no están marcados, pero el servidor es la
 * autoridad final: nunca confía en el cliente para saltarse el gate.
 *
 * La VERSIÓN de cada documento aceptado la estampa el servidor (CONSENT_VERSIONS),
 * no el cliente — este schema solo valida el hecho de la aceptación.
 */
export const ConsentSchema = z.object({
  acceptedPrivacy: z.literal(true, { error: 'Debes aceptar el Aviso de Privacidad' }),
  acceptedTerms: z.literal(true, { error: 'Debes aceptar los Términos y Condiciones' }),
})

export const EmitSchema = z.object({
  folio: z.string().min(1, 'El folio no puede estar vacío').max(50),
  /**
   * El monto se re-valida en emit como segunda barrera: un atacante que salte
   * el lookup y llame a emit directamente también debe conocer el monto exacto.
   * Mismas reglas que en LookupSchema.
   */
  amount: z.coerce.number().positive('El monto debe ser mayor a cero'),
  fiscal: FiscalDataSchema,
  consent: ConsentSchema,
})

export const ResendSchema = z.object({
  invoiceId: z.string().uuid('invoiceId inválido'),
})

export const InvoiceIdParamSchema = z.string().uuid()

/**
 * Body de POST /api/global/emit — facturación global (mensual o diaria).
 * Endpoint disparado por cron/operación interna (no por el cliente final), de
 * ahí que year/month/day se validen como number estricto (sin coerce): quien
 * lo llama controla el JSON que envía.
 *
 * year/month son OPCIONALES: el cron de Railway dispara este endpoint con un
 * body estático (sin periodo), y cuando no vienen el route handler los
 * resuelve al mes anterior en zona MX (ver `previousMxYearMonth` en
 * MxCalendar). Deben venir AMBOS o NINGUNO — un periodo parcial (solo year o
 * solo month) es ambiguo y se rechaza aquí mismo, antes de llegar al handler.
 *
 * day es OPCIONAL (R1 — periodicidad diaria): si viene, requiere year+month
 * explícitos también (un día sin periodo completo es ambiguo) y dispara una
 * corrida DIARIA (Periodicity '01') en vez de mensual. Los modos `relative`
 * (ej. "yesterday", "current-month") son de R4 — NO se agregan aquí.
 */
export const GlobalEmitSchema = z
  .object({
    year: z.number().int('El año debe ser un entero').min(2020, 'Año fuera de rango').max(2100, 'Año fuera de rango').optional(),
    month: z.number().int('El mes debe ser un entero').min(1, 'Mes inválido (1-12)').max(12, 'Mes inválido (1-12)').optional(),
    day: z.number().int('El día debe ser un entero').min(1, 'Día inválido (1-31)').max(31, 'Día inválido (1-31)').optional(),
    storeName: z.string().min(1).max(100).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    const hasYear = data.year !== undefined
    const hasMonth = data.month !== undefined
    if (hasYear !== hasMonth) {
      ctx.addIssue({
        code: 'custom',
        message:
          'year y month deben venir juntos: ambos presentes (periodo explícito) o ambos ausentes (usa el mes anterior en zona MX).',
        path: hasYear ? ['month'] : ['year'],
      })
    }
    if (data.day !== undefined && !(hasYear && hasMonth)) {
      ctx.addIssue({
        code: 'custom',
        message: 'day requiere year y month explícitos (un día sin periodo completo es ambiguo).',
        path: ['day'],
      })
    }
  })
