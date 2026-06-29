import { z } from 'zod'

const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/

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

export const EmitSchema = z.object({
  folio: z.string().min(1, 'El folio no puede estar vacío').max(50),
  /**
   * El monto se re-valida en emit como segunda barrera: un atacante que salte
   * el lookup y llame a emit directamente también debe conocer el monto exacto.
   * Mismas reglas que en LookupSchema.
   */
  amount: z.coerce.number().positive('El monto debe ser mayor a cero'),
  fiscal: FiscalDataSchema,
})

export const ResendSchema = z.object({
  invoiceId: z.string().uuid('invoiceId inválido'),
})

export const InvoiceIdParamSchema = z.string().uuid()
