/**
 * Decide si una corrida amerita aviso por correo. Pura y testeable.
 *
 * Decisión de finanzas (2026-08-03): SIEMPRE se envía, en TODA corrida global
 * —mensual o diaria de sandbox—, haya error o no. El correo es el registro de
 * resultado de cada corrida; finanzas quiere verlo siempre, no solo cuando algo
 * falla. Antes la diaria solo enviaba con novedad (error o POS sin pagar); se
 * quitó ese filtro para que cada corrida de prueba también produzca su correo
 * verificable, y para que producción nunca omita el aviso de un cierre.
 *
 * Se CONSERVA la función (en vez de borrar la llamada del route) como punto
 * ÚNICO de decisión: si en el futuro finanzas pide volver a filtrar, este es el
 * único lugar a tocar.
 */

import { GlobalRunReport } from "./EmitGlobalInvoiceUseCase"

export function shouldEmailRunReport(_report: GlobalRunReport): boolean {
    return true
}
