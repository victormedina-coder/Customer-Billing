import type { FiscalData } from './types'
import { RFC_REGEX } from '../../../src/domain/fiscal/Rfc'

const RAZON_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,&'/()\-]+$/

export function isValidRfcFormat(rfc: string): boolean {
  return RFC_REGEX.test(rfc.trim().toUpperCase())
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}

export function isValidCp(cp: string): boolean {
  return /^[0-9]{5}$/.test(cp.trim())
}

export interface FiscalErrors {
  rfc?: string
  razon?: string
  regimen?: string
  cp?: string
  uso?: string
  email?: string
}

export function validateFiscal(data: FiscalData): FiscalErrors {
  const errors: FiscalErrors = {}
  if (!isValidRfcFormat(data.rfc)) errors.rfc = 'RFC inválido (12–13 caracteres)'
  if (data.razon.trim().length < 3) errors.razon = 'Captura tu nombre o razón social'
  else if (!RAZON_RE.test(data.razon.trim())) errors.razon = 'La razón social contiene caracteres no permitidos'
  if (!data.regimen) errors.regimen = 'Selecciona tu régimen fiscal'
  if (!isValidCp(data.cp)) errors.cp = 'Código postal a 5 dígitos'
  if (!data.uso) errors.uso = 'Selecciona el uso del CFDI'
  if (!isValidEmail(data.email)) errors.email = 'Correo electrónico inválido'
  return errors
}
