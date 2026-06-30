/**
 * RateLimitStore — port (interfaz de dominio) para el store de rate limiting.
 *
 * TS puro, cero imports de ioredis/next/react.
 * Implementaciones (adapters) en src/infrastructure/rate-limit/.
 */

export interface RateLimitStore {
  /**
   * Registra un hit para `key` dentro de una ventana de `windowSec` segundos.
   * Devuelve el conteo actual tras el incremento y el TTL restante (segundos).
   */
  hit(key: string, windowSec: number): Promise<{ count: number; ttl: number }>
}
