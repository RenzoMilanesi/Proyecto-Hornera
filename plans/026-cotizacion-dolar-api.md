# Plan 026: Traer la cotización del dólar junto con "traer mes"

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá A TESTEAR en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat b0850f2..HEAD -- server/app.ts server/db.ts schema.sql src/Liquidacion.tsx src/Stays.tsx`.

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MEDIUM (cambia saldos en USD) · **Depends on**: —
- **Category**: feature (fase 5, tipo de cambio)
- **Planned at**: commit `b0850f2`, 2026-10-16 (reemplaza la versión del 2026-10-13)

## Why this matters
`DECISIONES.md`: "se trae automático (dólar cripto) menos el % configurable (hoy 6 %), con override
manual". Hoy solo existe la carga manual (`PUT /api/periodos/:mes/cotizacion`, `src/Liquidacion.tsx`).

## Decisiones (grill-me con el usuario, 2026-10-16)
1. **Valor**: dólar cripto, **venta**. El usuario no sabe cuál usaba el Sheet; la diferencia con
   compra es < 0,2 %.
2. **Fecha**: día de cierre del período = día anterior a `fecha_cierre_reservas` (en la práctica, el
   último día del mes).
3. **Cuándo**: automáticamente al **"traer mes" de Stays**. Además, un botón "Pedir a la API" en
   Liquidación para volver a pedirla.
4. **Mes en curso** (el día de cierre todavía no llegó): se guarda la venta **de hoy** como
   **provisoria**. El próximo "traer mes" la reemplaza; una vez pasado el cierre, por la del cierre.
5. **Manual manda**: si `usd_cotizacion_fuente = 'manual'`, "traer mes" no la toca y agrega un aviso
   ("la cotización está cargada a mano: $ X"). En Liquidación se ve una etiqueta "manual", sigue editable,
   y "Pedir a la API" la reemplaza por la de la API (fuente vuelve a `'api'`).
6. **API caída**: "traer mes" sigue igual y agrega un aviso ("No se pudo traer el dólar: …"); queda el
   valor anterior o vacío para cargar a mano. "Pedir a la API" muestra el error.
7. **Cerrar con provisoria**: se permite, pero el Popconfirm de "Cerrar mes" advierte que la cotización
   es provisoria (del día X, no del cierre).

## APIs (verificadas 2026-10-16; STOP si cambiaron)
- Cierre (histórico): `GET https://api.argentinadatos.com/v1/cotizaciones/dolares/cripto/AAAA/MM/DD`
  → `{ casa, compra, venta, fecha }`. Tiene fines de semana (probado 2026-05-31, domingo).
- Provisoria (ahora): `GET https://dolarapi.com/v1/dolares/cripto`
  → `{ moneda, casa, nombre, compra, venta, fechaActualizacion }` (ISO UTC).
- Si el histórico todavía no tiene el día de cierre (p. ej. la madrugada del 1°), se usa la de hoy como
  provisoria y se avisa; el próximo "traer" la corrige.

## Esquema (una migración, 8 → 9)
`periodo.usd_cotizacion_fecha TEXT` (fecha `YYYY-MM-DD` del valor). **Provisoria** = fuente `'api'` y
`usd_cotizacion_fecha` < día de cierre. No hace falta tocar el CHECK de `usd_cotizacion_fuente`.
`schema.sql` + `MIGRACIONES` en `server/db.ts` + `schema.check.mjs`, juntos. La carga manual guarda
`usd_cotizacion_fecha = NULL`.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/cotizacion.ts` (nuevo), `server/cotizacion.test.ts` (nuevo), `server/app.ts`,
`server/db.ts`, `schema.sql`, `schema.check.mjs`, `src/Liquidacion.tsx`, `DECISIONES.md`.
**Out**: el motor y `cambioDelPeriodo` no cambian. `server/stays/sync.ts` no cambia (el dólar se pide
desde la ruta, después del sync). Sin tabla ni gráfico del histórico del mes (se descartó; agregar si
lo piden).

## Steps
1. **`server/cotizacion.ts`**
   - `cotizacionCripto(diaCierre, hoy, fetchFn = fetch)` → `{ venta, fecha }`. Si `hoy > diaCierre`,
     histórico de ese día; si no (o si el histórico da 404), DolarApi de ahora con `fecha = hoy`.
     `AbortSignal.timeout(15_000)` y `redirect: 'error'` como `server/stays/cliente.ts`. Valida que
     `venta` sea número > 0; si no, `Error('No se pudo traer el dólar: …')`.
   - `actualizarCotizacion(db, mes, { forzar }, fetchFn?)` → `{ cotizacion, fecha, provisoria } | { aviso }`.
     Período cerrado → error. Fuente `'manual'` y sin `forzar` → devuelve aviso sin pedir nada. Si no,
     guarda `usd_cotizacion`, `usd_cotizacion_fuente = 'api'`, `usd_cotizacion_fecha` y audita con el
     mismo `auditar` que el PUT (antes/después con valor, fuente y fecha). Si el valor y la fecha no
     cambiaron, no audita.
2. **`server/app.ts`**
   - En `POST /api/stays/sincronizar`, después de `sincronizarMes`: `actualizarCotizacion(db, mes, { forzar: false })`
     dentro de try/catch; un error o un aviso van a `reporte.avisos`. El sync nunca falla por el dólar.
   - `POST /api/periodos/:mes/cotizacion/traer` → `actualizarCotizacion(..., { forzar: true })`; error → 502 con mensaje.
   - `PUT /api/periodos/:mes/cotizacion` (manual) pone también `usd_cotizacion_fecha = NULL`.
   - `GET /api/periodos` y lo que devuelve `liquidacion` incluyen `usd_cotizacion_fuente`,
     `usd_cotizacion_fecha` y `provisoria`.
3. **`src/Liquidacion.tsx`** (al lado del `InputNumber` de "Dólar cripto al cierre")
   - Etiqueta: `manual` / `API · 31/10` / `provisoria · 16/10` (naranja).
   - Botón "Pedir a la API" (solo período abierto) → `POST .../cotizacion/traer`, recalcula.
   - Popconfirm de "Cerrar mes": si es provisoria, agrega a la descripción "La cotización es provisoria
     (del 16/10), no la del cierre."
4. **`src/Stays.tsx`**: nada que tocar si ya muestra `reporte.avisos` (verificar en la línea ~124).
5. **`DECISIONES.md`**: reemplazar "(manual por ahora)" con las decisiones 1 a 7, en una o dos líneas.
6. **Tests** (`server/cotizacion.test.ts`, `fetchFn` falso, sin red):
   - mes terminado → pide el histórico del día de cierre y guarda `'api'` con esa fecha;
   - mes en curso → pide DolarApi y queda provisoria;
   - manual sin forzar → no pide nada y devuelve aviso; con forzar → la reemplaza;
   - fetch que falla → error con mensaje claro y la cotización anterior intacta;
   - período cerrado → error.
   Y en `server/app.test.ts`: "traer mes" con el dólar caído sigue OK y trae el aviso
   (si el test de sync existente permite inyectar el fetch; si no, cubrirlo solo en `cotizacion.test.ts`).

**Verify**: `npm test` y `npm run typecheck` → pasan. Manual: "traer mes" del mes en curso deja la
cotización con etiqueta "provisoria"; cargar una a mano → etiqueta "manual" y otro "traer mes" no la
pisa (aparece el aviso); "Pedir a la API" la vuelve a `API`.

## Maintenance
Si alguna API cambia o desaparece, solo se toca `server/cotizacion.ts`; la carga manual es el respaldo.
