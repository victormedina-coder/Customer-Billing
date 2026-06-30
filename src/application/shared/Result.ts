/**
 * Result<T, E> — tipo discriminado para representar éxito o fallo
 * sin lanzar excepciones de control de flujo.
 *
 * Uso:
 *   const r: Result<Foo, Bar> = ok(foo)   // r.ok === true,  r.value
 *   const r: Result<Foo, Bar> = err(bar)  // r.ok === false, r.error
 */

export type Ok<T> = { ok: true; value: T }
export type Err<E> = { ok: false; error: E }
export type Result<T, E> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}
