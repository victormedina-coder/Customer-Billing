/**
 * ConsentVersions — fuente única de verdad de las versiones vigentes de los
 * documentos legales (Aviso de Privacidad y Términos y Condiciones).
 *
 * El SERVIDOR estampa esta versión al momento del consentimiento — nunca se
 * confía en el cliente para la cadena de versión (ver EmitInvoiceUseCase).
 * Dominio puro: sin dependencias de framework ni de infraestructura.
 */

export const CONSENT_VERSIONS = {
  privacy: '2026-07-03',
  terms: '2026-07-03',
} as const
