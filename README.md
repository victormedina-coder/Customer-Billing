# Portal de Autofacturación — Grupo Quince 22

Portal web **público, sin login**, de autofacturación CFDI 4.0 para las marcas del Grupo Quince 22 (**Ariat**, **Stetson**, **Western Brothers**). El cliente identifica su compra con el **folio del ticket + el monto** (segundo factor anti-abuso), captura sus datos fiscales (validados en vivo contra el SAT), y el sistema **timbra el CFDI vía Facturama** y se lo envía por correo (PDF + XML).

La fuente de datos de pedidos es **Shopify** (una tienda por marca). NetSuite **no** participa: los pedidos se suben a NetSuite *después* de facturarse, así que nunca es fuente válida. Una base de datos Postgres (Railway) evita la doble facturación mediante un cerrojo `UNIQUE(order_id, store_name)` con patrón *insert-first*, y sirve de auditoría. Redis se usa para rate limiting.

## Stack

- **Framework:** Next.js 16.2 (App Router, `--webpack`), React 19, TypeScript strict
- **UI:** Tailwind CSS v4 + shadcn/ui
- **Validación:** Zod
- **Base de datos:** PostgreSQL (Railway) vía Drizzle ORM + `postgres` (postgres-js)
- **Rate limiting:** Redis (ioredis), con fallback en memoria si Redis falla
- **Timbrado (PAC):** Facturama
- **Fuente de pedidos:** Shopify GraphQL Admin API
- **Testing:** Vitest
- **Deploy:** Railway

## Arquitectura

El núcleo del negocio vive en `src/`, con una arquitectura **hexagonal / DDD**, totalmente desacoplado de Next.js. `app/` es solo la capa de interfaz (route handlers delgados + UI del portal).

```
src/
├── domain/                     # TypeScript puro — sin imports de next/react/infra
│   ├── orders/
│   │   ├── Order.ts             # Entidad Order (pedido normalizado)
│   │   ├── RefundPolicy.ts      # Política de dominio: pedido reembolsado en su totalidad
│   │   └── ports/OrderSource.ts # Puerto: obtener un pedido normalizado
│   ├── fiscal/
│   │   ├── Rfc.ts                # Value object: formato de RFC
│   │   ├── FiscalInput.ts        # Value object: datos fiscales capturados
│   │   ├── FiscalBreakdown.ts    # Value object: desglose (subtotal/descuento/IVA/total)
│   │   └── FiscalCalculator.ts   # Domain service: cálculo CFDI puro (con cent-fix)
│   ├── eligibility/
│   │   ├── InvoiceWindowPolicy.ts       # Política: ventana de facturación (mes en curso)
│   │   └── ports/
│   │       ├── InvoiceRepository.ts     # Puerto: persistencia de facturas
│   │       └── RateLimitStore.ts        # Puerto: store de rate limiting
│   └── invoicing/
│       └── ports/InvoiceStampingService.ts  # Puerto: servicio de timbrado
│
├── application/                # Casos de uso — orquestan el dominio, sin importar next
│   ├── invoice/
│   │   ├── EmitInvoiceUseCase.ts
│   │   ├── LookupOrderUseCase.ts
│   │   ├── DownloadInvoiceUseCase.ts
│   │   └── ResendInvoiceUseCase.ts
│   ├── fiscal/ValidateFiscalUseCase.ts
│   ├── orders/orderToTicket.ts  # Mapea Order (dominio) → Ticket (DTO de UI)
│   └── shared/Result.ts         # Result<T, E> discriminado, usado por todos los use cases
│
├── infrastructure/              # Adapters de los puertos — todo el I/O real
│   ├── shopify/{ShopifyOrderSource,client,brands}.ts
│   ├── facturama/{FacturamaInvoiceService,facturamaClient,cfdiPayloadBuilder}.ts
│   ├── db/{client,schema,invoice-repository}.ts   # Drizzle + postgres-js
│   ├── rate-limit/index.ts       # ioredis + fallback en memoria
│   └── observability/logRedact.ts  # maskEmail / maskRfc
│
├── interface/http/              # Helpers compartidos por los route handlers
│   ├── httpError.ts              # httpError() / rateLimitedResponse() — envelope uniforme
│   └── withRateLimit.ts          # enforceRateLimit() (rate limit por IP)
│
└── composition/                  # Composition root — cablea dependencias en tiempo de request
    ├── make{Emit,Lookup,Download,Resend}InvoiceUseCase.ts
    ├── makeValidateFiscalUseCase.ts
    ├── orderSource.ts             # getOrderSource() → ShopifyOrderSource
    └── invoiceService.ts          # getInvoiceService() → FacturamaInvoiceService

app/
├── api/                          # Interfaz HTTP (route handlers delgados)
│   ├── invoice/{lookup,emit,resend}/route.ts
│   ├── invoice/download/[invoiceId]/[format]/route.ts
│   └── fiscal/validate/route.ts
├── (portal)/                     # UI del portal (flujo de 4 pasos)
│   ├── _components/steps/{StepTicket,StepFiscal,StepConfirm,StepSuccess}.tsx
│   ├── _hooks/{usePortal,useRfcValidation,useToast}.ts
│   └── page.tsx
└── aviso-privacidad/              # Aviso de privacidad (LFPDPPP)

lib/                               # Utilidades transversales mínimas (no es una capa DDD)
├── amount-match.ts                 # Comparación de monto exacto al centavo
├── api/schemas.ts                  # Esquemas Zod de los endpoints
└── utils.ts
```

### Regla de dependencias

```
interface (app/) → application → domain ← infrastructure
```

Todas las flechas apuntan **hacia el dominio**. `domain/` no importa de ninguna otra capa (ni de `next`, `react`, `drizzle`, `ioredis`, etc.) — es TypeScript puro y 100% testeable sin infraestructura. `application/` orquesta el dominio recibiendo sus dependencias por inyección (a través de los puertos) y tampoco importa `next`. `infrastructure/` implementa los puertos del dominio. `composition/` es el único lugar que conoce tanto los puertos como sus implementaciones concretas, y las cablea en tiempo de request. Los route handlers de `app/api/` son deliberadamente delgados: rate limit → parseo/validación Zod → invocar el caso de uso vía el composition root → mapear `Result` a respuesta HTTP.

> Nota: la unificación del cálculo fiscal del *preview* de la UI (`app/(portal)/_lib/formatters.ts`) con `FiscalCalculator` está diferida (no se hizo en este refactor).

## Flujo de facturación

1. **`POST /api/invoice/lookup`** — `{ folio, amount }`
   Busca el pedido en Shopify por *fan-out* paralelo entre las marcas configuradas, emparejando por `sourceIdentifier`. Valida que el **monto coincida exacto al centavo** (segundo factor anti-abuso). Si el folio no existe o el monto no coincide, responde el **mismo error genérico `422 VALIDATION_FAILED`** (anti-enumeración: un atacante no puede distinguir "folio inexistente" de "monto incorrecto"). También valida la ventana de facturación (mes en curso → `422 DEADLINE_EXCEEDED`), reembolso total (`409 FULLY_REFUNDED`) y doble facturación (`409 ALREADY_INVOICED`).

2. **`POST /api/fiscal/validate`** — `{ rfc, name, zipCode, fiscalRegime }`
   Valida los datos fiscales contra el SAT vía Facturama y **colapsa el resultado a `{ valid: boolean }`** en el servidor — nunca se revela cuál campo específico no coincidió (anti-oráculo). El formato local de RFC/CP/email se valida primero en el cliente para UX.

3. **`POST /api/invoice/emit`** — `{ folio, amount, fiscal, consent: { acceptedPrivacy: true, acceptedTerms: true } }`
   Re-valida el monto (cierra el bypass de saltarse `lookup` e ir directo a `emit`), adquiere el cerrojo de base de datos con patrón **insert-first** (inserta una fila `pending` que toma el `UNIQUE(order_id, store_name)` antes de gastar en Facturama), timbra el CFDI, persiste el resultado y envía el correo con el CFDI (best-effort — un fallo de correo no tumba la respuesta). Devuelve `{ factura }`.

   **Consentimiento legal auditable (LFPDPPP):** `consent.acceptedPrivacy` y `consent.acceptedTerms` deben llegar en `true` — Zod rechaza el request si falta cualquiera (400 `FISCAL_INVALID`), y `EmitInvoiceUseCase` repite la misma validación como defensa en profundidad. La **versión vigente** de cada documento legal la estampa el SERVIDOR (`CONSENT_VERSIONS` en `src/domain/consent/ConsentVersions.ts`) — nunca se confía en el cliente para la cadena de versión. Al insertar la fila `pending` se persisten `privacy_version`, `terms_version` y `consent_at` en `invoices`, dejando un registro auditable de quién (rfc/email/orden, ya en la fila) aceptó qué versión y cuándo.

   **Reap-lazy de filas `pending` huérfanas:** si el proceso muere entre el insert-first y el timbrado/rollback (crash, timeout, redeploy), la fila `pending` queda huérfana y bloquearía reintentos del mismo pedido para siempre. Cuando el insert choca con el `UNIQUE`, `EmitInvoiceUseCase` revisa la fila existente: si sigue `pending` y es más vieja que `PENDING_TTL_MINUTES` (default 10 min), la borra y reintenta el insert una vez; si es `pending` pero reciente, o `emitted`, responde `ALREADY_INVOICED` (comportamiento normal). Si el CFDI se timbró en Facturama pero el `UPDATE` que lo confirma en la fila falla, la fila se marca `stamped_unconfirmed` en vez de quedar `pending` — ese status nunca se reapea (evita un segundo timbrado duplicado) y requiere conciliación manual. Ver `docs/08-plan-pre-deploy.md` §4 para el diseño completo.

4. **`GET /api/invoice/download/[invoiceId]/[format]`** y **`POST /api/invoice/resend`**
   Usan el `invoiceId` (UUID de la fila en DB) como **token de capacidad** — el `facturamaId` interno nunca se expone al cliente. `resend` solo reenvía al email guardado en la fila (nunca a uno provisto por el request).

## Seguridad

- **Sin login → segundo factor por monto:** el folio por sí solo no basta para operar sobre un pedido; se exige el monto exacto al centavo.
- **Rate limiting** por IP en los 5 endpoints públicos, y un límite adicional **por folio** en `lookup` (anti-fuerza-bruta de montos). Backend Redis con fallback en memoria por instancia si Redis cae; no-op si `REDIS_URL` no está configurada (dev/CI/tests).
- **Errores genéricos anti-enumeración:** `lookup` (folio-no-existe = monto-incorrecto) y `fiscal/validate` (no se revela qué campo fiscal falló).
- **Token de capacidad** (`invoices.id` UUID) para descarga y reenvío — el `facturamaId` real nunca sale del servidor.
- **Cerrojo insert-first** (`UNIQUE(order_id, store_name)`) contra doble timbrado por condición de carrera.
- **Redacción de PII en logs** (`maskEmail` / `maskRfc` en `src/infrastructure/observability/logRedact.ts`).
- **IP resistente a spoofing de `X-Forwarded-For`:** se toma el hop del proxy de confianza (`TRUSTED_PROXY_COUNT`), no el primer valor del header (que el cliente controla).
- **Headers de seguridad / CSP** configurados a nivel de aplicación (HSTS, `X-Frame-Options`, `nosniff`, etc.).

## Requisitos previos

- Node.js 20+
- Acceso a una base de datos PostgreSQL (Railway recomendado)
- Credenciales de Shopify por marca (Ariat: token estático; Stetson/WB: OAuth client credentials)
- Credenciales de Facturama (sandbox o producción)
- Redis (opcional en desarrollo — sin `REDIS_URL` el rate limiting queda en no-op)

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno y completarlas
cp .env.example .env

# 3. Aplicar migraciones a la base de datos
npm run db:migrate

# 4. Levantar el servidor de desarrollo
npm run dev
```

El servidor de desarrollo corre en `http://localhost:3000` (con `-H 0.0.0.0`, también accesible desde la red local).

> Para desarrollar sin credenciales de Shopify/Facturama: `NEXT_PUBLIC_LOOKUP_MOCK=true` sustituye `lookup` por tickets de demostración (`DEMO_TICKETS`), y `EMIT_MOCK=true` genera un CFDI de prueba en `emit` sin llamar a Facturama.

## Scripts

| Script | Comando | Descripción |
|---|---|---|
| `dev` | `next dev --webpack -H 0.0.0.0` | Servidor de desarrollo |
| `build` | `next build --webpack` | Build de producción |
| `start` | `next start` | Levanta el build de producción |
| `lint` | `eslint` | Lint del proyecto |
| `test` | `vitest run` | Corre la suite de tests una vez |
| `test:watch` | `vitest` | Tests en modo watch |
| `test:coverage` | `vitest run --coverage` | Tests con reporte de cobertura |
| `test:e2e` | `playwright test` | Pruebas E2E del portal en Chromium (ver [Testing](#testing)) |
| `test:e2e:ui` | `playwright test --ui` | E2E en modo interactivo, para depurar |
| `db:generate` | `drizzle-kit generate` | Genera una migración a partir del schema |
| `db:migrate` | `drizzle-kit migrate` | Aplica migraciones pendientes |

## Testing

El proyecto usa **Vitest** (`__tests__/`) para unitarias e integración, y **Playwright** (`e2e/`) para el recorrido del portal en el navegador. No se documenta aquí un conteo de tests (envejece en cada commit): el número real sale de la corrida.

Cobertura (Vitest): dominio (cálculo fiscal, ventana de facturación, reembolsos), clientes HTTP (Shopify, Facturama), handlers de rutas (mapa error→HTTP), orquestación de `emit` (insert-first, rollback, correo best-effort), clasificación de resultados de timbrado inciertos y manejo de timeouts, estados de error del portal, y utilidades (redacción de logs, rate limiting, matching de monto).

### Vitest

`vitest.config.ts` define dos proyectos:

- **`unit`**: todo `__tests__/` salvo los archivos de integración. Usa fakes y mocks en memoria, no necesita base de datos y puede correr en paralelo.
- **`integration`**: exactamente los archivos de `INTEGRATION_TEST_FILES` en `vitest.config.ts`: `invoice-repository.test.ts`, `invoiced-orders-gateway.test.ts` y `global-invoice-repository.test.ts`. Comparten las mismas tablas de una Postgres real, por eso se serializan entre sí (`fileParallelism: false`); en paralelo se pisarían y la suite quedaría intermitente. Se saltan solos si falta `DATABASE_URL_TEST`.

```bash
npx vitest run --project unit      # solo unitarias, sin base de datos
npm test -- --maxWorkers=1         # suite completa (unit + integration)
npm run test:watch                 # modo watch
npm run test:coverage              # con cobertura
```

El `--` de `npm test -- --maxWorkers=1` separa los argumentos de npm de los que se pasan a `vitest run`.

`vitest.config.ts` lee el `.env` local y, si existe `DATABASE_URL_TEST`, **sobrescribe `DATABASE_URL` con ese valor** en el proceso de tests. Así el código de producción (`getDb()`) conecta a la base de test sin necesidad de mocks.

> **⚠️ `DATABASE_URL_TEST` debe apuntar a una base usada ÚNICAMENTE para tests: nunca producción, nunca la base de la app sandbox.** Los tests de integración ejecutan `TRUNCATE TABLE invoices, global_invoices RESTART IDENTITY CASCADE` antes de cada test (`invoice-repository`, `invoiced-orders-gateway` y `global-invoice-repository`). Eso borra los candados anti-doble-facturación; ya vació la base del sandbox una vez, el 2026-10-07. Se recomienda una segunda base en el mismo proyecto de Railway.

Ningún test llama de verdad a Facturama, Shopify ni SMTP: los clientes HTTP se prueban con `fetch` mockeado, el timbrado y el correo con fakes. Lo único real que tocan es esa base de test.

Como el `.env` se carga en los tests, los que prueban el fallback de serie aíslan `ARIAT_FACTURAMA_SERIE`, `STETSON_FACTURAMA_SERIE` y `WB_FACTURAMA_SERIE` con `vi.stubEnv`, para que la serie real del `.env` no altere el resultado.

### E2E con Playwright

```bash
npm ci
npx playwright install chromium
npm run test:e2e        # corrida normal
npm run test:e2e:ui     # modo interactivo, para depurar
```

Playwright levanta su propio Next.js en `127.0.0.1:4173`; ese puerto debe estar libre (`reuseExistingServer=false`, para no reutilizar un servidor ajeno con otra configuración). Las trazas y capturas de los fallos quedan en `test-results/` y `playwright-report/`, que no se versionan.

- `e2e/portal.spec.ts` recorre el portal en Chromium: consulta del ticket, validación fiscal y consentimientos, confirmación, emisión, descargas, reenvío, errores, reinicio y persistencia de la sesión. Intercepta todas las llamadas del navegador a `/api/**` y falla ante una ruta inesperada.
- `e2e/api.spec.ts` llama a las rutas locales para verificar el rechazo de entradas inválidas y la respuesta de emisión simulada. No hace un timbrado real.

**Aislamiento:** el servidor de Playwright arranca con `EMIT_MOCK=true`, credenciales de Facturama y Shopify vacías, y sin `DATABASE_URL`, `REDIS_URL` ni secreto del cron global (`GLOBAL_INVOICE_SECRET`). También fija una fecha de desarrollo (`DEV_NOW_OVERRIDE`) para que la ventana de facturación siga abierta. Por eso Playwright **no prueba** Facturama, Shopify, SMTP, la base de datos ni el cron global real: eso lo cubren las pruebas de `__tests__/`, y una prueba fiscal completa necesita un ambiente sandbox con datos separados de producción.

## Variables de entorno

Ver `.env.example` para la plantilla completa. Agrupadas por propósito:

### Shopify (una credencial por marca)

| Variable | Descripción |
|---|---|
| `SHOPIFY_API_VERSION` | Versión del Admin API (default en código: `2025-07`) |
| `ARIAT_SHOPIFY_STORE` / `ARIAT_SHOPIFY_ACCESS_TOKEN` | Dominio de la tienda y token estático (`shpat_…`) |
| `STETSON_SHOPIFY_STORE` / `STETSON_SHOPIFY_CLIENT_ID` / `STETSON_SHOPIFY_CLIENT_SECRET` | Dominio y credenciales OAuth (client credentials) |
| `WB_SHOPIFY_STORE` / `WB_SHOPIFY_CLIENT_ID` / `WB_SHOPIFY_CLIENT_SECRET` | Dominio y credenciales OAuth (Western Brothers) |

### Facturama (PAC — cuenta única compartida entre las 3 marcas)

| Variable | Descripción |
|---|---|
| `FACTURAMA_USER` / `FACTURAMA_PASS` | Credenciales de la API |
| `FACTURAMA_ENV` | Entorno (`sandbox` / `production`) |
| `FACTURAMA_NAME_ID` | Identificador del emisor/CSD en Facturama |
| `FACTURAMA_DEFAULT_PRODUCT_CODE` | ClaveProdServ por defecto — **solo CFDI individual**. Default en código: `53102500`. El CFDI global usa `01010101` fijo (normativo, SAT 2.7.1.21), no lee esta var. |
| `FACTURAMA_DEFAULT_UNIT_CODE` | ClaveUnidad por defecto — **solo CFDI individual**. Default en código: `H87` (Pieza). El CFDI global usa `ACT` fijo (normativo, SAT 2.7.1.21), no lee esta var. |
| `FACTURAMA_DEFAULT_PAYMENT_FORM` | FormaPago por defecto |
| `FACTURAMA_EXPEDITION_PLACE` | **Opcional.** Override manual del Lugar de Expedición (CP). Por defecto (vacío) se resuelve en vivo desde el perfil fiscal del emisor en Facturama (`GET /TaxEntity` → `IssuedIn.ZipCode`, cacheado 1h en memoria de proceso). Nunca cae al CP del receptor — si Facturama no devuelve un CP registrado, el timbrado falla explícitamente. |
| `FACTURAMA_ISSUER_EMAIL` | Correo remitente del CFDI (opcional; el reenvío funciona sin ella) |

### Base de datos

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión a Postgres (Railway) |
| `DATABASE_URL_TEST` | Conexión a la base de datos de test (solo para tests de integración) |

### Redis / rate limiting

| Variable | Descripción |
|---|---|
| `REDIS_URL` | Conexión a Redis (Railway). Sin ella, el rate limiting es no-op |
| `TRUSTED_PROXY_COUNT` | Nº de proxies de confianza delante de la app (Railway = `1`). Determina de qué hop de `X-Forwarded-For` se toma la IP real del cliente |
| `RATE_LIMIT_LOOKUP_MAX` / `RATE_LIMIT_LOOKUP_WINDOW_SEC` | Límite de `lookup` por IP (default: 20 / 60s) |
| `RATE_LIMIT_EMIT_MAX` / `RATE_LIMIT_EMIT_WINDOW_SEC` | Límite de `emit` por IP (default: 5 / 60s) |
| `RATE_LIMIT_FISCAL_MAX` / `RATE_LIMIT_FISCAL_WINDOW_SEC` | Límite de `fiscal/validate` por IP (default: 15 / 60s) |
| `RATE_LIMIT_RESEND_MAX` / `RATE_LIMIT_RESEND_WINDOW_SEC` | Límite de `resend` por IP (default: 5 / 60s) |
| `RATE_LIMIT_DOWNLOAD_MAX` / `RATE_LIMIT_DOWNLOAD_WINDOW_SEC` | Límite de `download` por IP (default: 40 / 60s) |
| `RATE_LIMIT_VALIDATE_MAX` / `RATE_LIMIT_VALIDATE_WINDOW_SEC` | Límite de `lookup` **por folio** (default: 5 / 900s = 15 min) |

### Facturación global (`POST /api/global/emit`)

| Variable | Descripción |
|---|---|
| `GLOBAL_INVOICE_SECRET` | Secreto compartido que autentica al cron/job interno que dispara el endpoint (header `x-global-secret`, comparación en tiempo constante). Sin ella, el endpoint responde `503 FEATURE_NOT_CONFIGURED`. |
| `FACTURAMA_GLOBAL_TIMEOUT_MS` | Tiempo máximo del POST de CFDI global en milisegundos (entero >= 1; default `120000`). No altera el timeout de `15000` ms del CFDI individual. Un timeout deja la reserva en `stamped_unconfirmed` para conciliación. |
| `GLOBAL_RECONCILE_APPLY` | `true` (default) aplica confirmaciones y liberaciones tras consultar Facturama; `false` solo reporta decisiones para diagnóstico. |
| `GLOBAL_RECONCILE_MIN_AGE_MINUTES` | Edad mínima antes de liberar reservas sin timbrado (entero >= 1; default `60`). Da tiempo a que aparezca un timbrado tardío. |
| `GLOBAL_ORDER_CHECK_MAX_CFDIS` | Maximo de CFDI activos cuyos Items consulta la verificacion informativa por pedido (entero >= 1; default `30`); si se supera, reporta truncamiento. |
| `GLOBAL_ORDER_CHECK_BUDGET_MS` | Presupuesto total para consultar Items después de emitir todos los chunks (entero >= 1; default `30000` ms); al agotarse, reporta truncamiento. |
| `DEV_NOW_OVERRIDE` | **Solo fuera de producción** (guard duro por `NODE_ENV`, ver `getEvaluationNow`). Fecha ISO para simular el instante "ahora" al resolver periodos `relative` (R4) o la ventana de facturación (R3). **Nunca definir en el `.env` de producción.** |

### Otros

| Variable | Descripción |
|---|---|
| `EMIT_MOCK` | `true` genera un CFDI de prueba en `emit` sin llamar a Facturama ni Shopify (desarrollo) |
| `PENDING_TTL_MINUTES` | Minutos de antigüedad tras los cuales una fila `pending` huérfana se libera de forma lazy en `emit` (default: `10`) |
| `NEXT_PUBLIC_LOOKUP_MOCK` | `true` usa `DEMO_TICKETS` en vez de llamar a Shopify en `lookup` (desarrollo sin credenciales) |
| `INVOICE_WINDOW_MODE` | Modo de la ventana de facturación (default en código: `current-month`) |
| `INVOICE_WINDOW_CUTOFF_HOUR` | Hora (0-23, zona MX) del corte de facturación del último día del mes en curso — pasado el corte, la ventana individual se cierra aunque el mes no haya terminado (evita doble factura con la global). Default en código: `21` (decisión de contabilidad 2026-07-16). |
| `BILLING_CONTACT_EMAIL` | Correo de facturación mostrado en la pantalla de bloqueo del portal cuando la ventana del mes cerró (R3). Sin valor placeholder — lo define el usuario. |
| `TRUSTED_PROXY_COUNT` | Ver grupo de Redis / rate limiting arriba |
| `LOG_LEVEL` | Nivel mínimo del logger estructurado (pino → JSON a stdout, que es lo que recolecta Railway). Valores: `trace`/`debug`/`info`/`warn`/`error`/`fatal`. **Default en código: `info`**, que ya incluye toda la traza operativa de la facturación global (inicio/fin de corrida, enumeración por tienda, cada chunk timbrado) y los `error` accionables (rollback, `unmapped`, conciliación pendiente). Subir a `debug` solo para diagnóstico puntual; bajar a `warn` **oculta el detalle de las corridas exitosas** y deja solo lo que falla. |

## Cron — Facturación Global (Railway)

`POST /api/global/emit` se dispara desde un *Scheduled Job* de Railway.
El body admite `{year, month}` o `{"relative":"current-month"}` /
`{"relative":"previous-month"}`; un body vacío usa el mes anterior en zona MX.
El endpoint actual solo factura periodos mensuales.

**Cron de producción (mensual):** schedule `0 3 1 * *` UTC = 21:00 MX del
último día del mes, con body `{"relative":"current-month"}`. Regla de
negocio: contabilidad requiere el cierre el mismo día del mes (no el día 1
de madrugada) porque las tiendas POS no venden después de las 21:00 — ver
**`docs/adr/ADR-009-corte-mensual-2100.md`**.

**Segundo disparo de producción:** schedule `30 5 1 * *` UTC = 23:30 MX del
último día del mes, con el mismo body `{"relative":"current-month"}`.
`currentMxYearMonth` resuelve todavía el mes del corte a esa hora. Este disparo
concilia timbrados ambiguos y vuelve a facturar pedidos liberados a las 23:30 MX,
2.5 horas después del corte de las 21:00 y dentro del plazo de 24 horas.

**Runbook de conciliación:** `alert_duplicate` indica dos CFDI activos con la
misma llave; `alert_cancelled`, un CFDI cancelado; `alert_late_stamp`, un timbrado
tras liberar la reserva. En cualquiera de esos casos, revisar los CFDI en
Facturama y decidir con contabilidad la cancelación correspondiente. Un `wait`
indica edad mínima pendiente, listado incompleto o una global ajena sin explicar.
En este último caso, identificar quién la emitió en Facturama antes de liberar reservas.
La verificacion por pedido consulta conceptos de Facturama solo si hay pedidos bloqueados o globales no explicadas; es informativa y no libera ni excluye pedidos.
La conciliación compara llaves `GLB:` sin distinguir mayúsculas ni espacios externos. Un CFDI activo con llave `GLB:` huérfana veta la liberación y genera alerta. Un header con `facturamaId` guardado nunca se libera: se confirma si ese CFDI aparece activo, alerta si está cancelado y espera si falta en el listado.

## Despliegue (Railway)

1. Provisionar un servicio de PostgreSQL y uno de Redis en el mismo proyecto de Railway.
2. Configurar las variables de entorno del servicio Next.js (usar la URL **privada** de Redis, `${{ Redis.REDIS_PRIVATE_URL }}`, para evitar egress).
3. Correr `npm run db:migrate` contra la base de datos de producción antes del primer despliegue.
4. Build: `npm run build` — Start: `npm run start`.
5. Configurar el dominio y, si aplica, el CDN/proxy delante de la app — ajustar `TRUSTED_PROXY_COUNT` según la cantidad de proxies encadenados.
