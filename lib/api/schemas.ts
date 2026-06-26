import { z } from 'zod'

const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/

export const LookupSchema = z.object({
  folio: z.string().min(1, 'El folio no puede estar vacío').max(50),
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
  // Si vienen los 3 opcionales se hace validación de conjunto; si no, solo existencia.
  name: z.string().max(300).optional(),
  zipCode: z.string().regex(/^[0-9]{5}$/).optional(),
  fiscalRegime: z.string().max(10).optional(),
})

export const EmitSchema = z.object({
  folio: z.string().min(1, 'El folio no puede estar vacío').max(50),
  fiscal: FiscalDataSchema,
})

export const ResendSchema = z.object({
  invoiceId: z.string().uuid('invoiceId inválido'),
})

export const InvoiceIdParamSchema = z.string().uuid()
