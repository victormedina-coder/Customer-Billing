/**
 * Composition root — cablea las dependencias del ValidateFiscalUseCase.
 *
 * Se llama DENTRO del handler POST en cada request, nunca a nivel de módulo.
 * Esto garantiza que los vi.mock de Vitest (que reemplazan los módulos de lib/)
 * sigan interceptando cuando los tests llaman al handler.
 */

import { ValidateFiscalUseCase } from '../application/fiscal/ValidateFiscalUseCase'
import type { ValidateFiscalDeps } from '../application/fiscal/ValidateFiscalUseCase'

import { validarReceptor } from '../infrastructure/facturama/facturamaClient'

export function makeValidateFiscalUseCase(): ValidateFiscalUseCase {
  const deps: ValidateFiscalDeps = {
    fiscalService: {
      validarReceptor: (input) => validarReceptor(input),
    },
  }

  return new ValidateFiscalUseCase(deps)
}
