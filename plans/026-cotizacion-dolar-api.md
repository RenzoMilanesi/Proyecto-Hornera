# Plan 026: Traer la cotización del dólar de una API (con histórico del mes)

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat dc87918..HEAD -- server/app.ts src/Liquidacion.tsx schema.sql server/db.ts`.

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MEDIUM (cambia saldos en USD) · **Depends on**: decisión del usuario (abajo)
- **Category**: feature (fase 5, tipo de cambio)
- **Planned at**: commit `dc87918`, 2026-10-13

## Why this matters
`DECISIONES.md` ya define el tipo de cambio como "se trae automático (dólar cripto) menos el %
configurable (hoy 6 %), con override manual". Hoy solo existe la carga manual:
- `server/app.ts` `PUT /api/periodos/:mes/cotizacion` guarda `usd_cotizacion` con
  `usd_cotizacion_fuente = 'manual'` y audita el cambio.
- `src/Liquidacion.tsx` tiene el `InputNumber` + "Guardar" de la cotización (solo con el período abierto).
- `schema.sql`: `periodo.usd_cotizacion REAL`, `usd_cotizacion_fuente CHECK IN ('api','manual')` — el
  valor `'api'` ya está previsto. El cambio efectivo es `cotizacion × (1 − usd_descuento_pct)`
  (`cambioDelPeriodo` en `server/liquidacion/motor.ts`).

El dólar fluctúa semana a semana y la liquidación usa un solo valor por mes: cada $100 de diferencia
mueve el saldo de un depto con cobros en USD (ej. un depto con ~US$ 150 netos en el mes → ~$12.000 con
honorarios). Hace falta ver la evolución del mes y traer el valor sin tipearlo.

## Decisión pendiente del usuario (STOP hasta tenerla)
¿Qué fecha de cotización usa la liquidación? Opciones: día de cierre del mes, `fecha_pago` del período,
último día del período, o promedio del mes. Preguntar cuál usaba el Google Sheet. El paso 3 depende de esto;
los pasos 1, 2 y 4 no.

## APIs (verificar que respondan antes de empezar; STOP si cambiaron)
- Actual: `GET https://dolarapi.com/v1/dolares/cripto` → `{ compra, venta, fechaActualizacion, ... }`.
- Histórico: `GET https://api.argentinadatos.com/v1/cotizaciones/dolares/cripto` → lista
  `{ fecha: 'YYYY-MM-DD', compra, venta }`. Gratis, sin clave. Usar `venta` (confirmar con el usuario).

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/cotizacion.ts` (nuevo), `server/cotizacion.test.ts` (nuevo), `server/app.ts`, `src/Liquidacion.tsx`.
**Out**: el motor (`motor.ts`) y el cálculo de `cambioDelPeriodo` no cambian. Sin cambio de esquema
salvo que la decisión pida guardar el histórico (si pasa: `schema.sql` + `MIGRACIONES` en `server/db.ts` +
`schema.check.mjs`, juntos).

## Steps
1. `server/cotizacion.ts`: `historicoCripto(desde, hasta, fetchFn = fetch)` → `{ fecha, venta }[]` del
   rango, con `AbortSignal.timeout(15_000)` y `redirect: 'error'` (como `server/stays/cliente.ts`).
   Errores de red → `Error('No se pudo traer la cotización: …')`; la carga manual sigue funcionando.
2. `GET /api/periodos/:mes/cotizaciones` → histórico del período (`fecha_inicio` a `fecha_cierre_reservas`)
   + la actual si el mes está en curso. Solo lectura.
3. `POST /api/periodos/:mes/cotizacion/traer` → toma el valor según la decisión pendiente, lo guarda con
   `usd_cotizacion_fuente = 'api'` y audita igual que el PUT manual (mismo `auditar`, `despues` incluye
   la fecha usada). Período cerrado → 400 como el PUT.
4. `src/Liquidacion.tsx`: botón "Traer de la API" al lado de "Guardar", y una tabla chica (fecha, venta,
   venta × (1 − descuento)) del histórico del mes, con mínimo y máximo. El override manual queda igual.
5. Test en `server/cotizacion.test.ts` con `fetchFn` falso (sin red): filtra el rango, elige la fecha
   correcta y falla con mensaje claro si la API no responde.

**Verify**: `npm test` y `npm run typecheck` → pasan. Manual: en un mes abierto, "Traer de la API"
llena la cotización y la auditoría muestra fuente `api`.

## Maintenance
Si la API cambia o desaparece, solo se toca `server/cotizacion.ts`; la carga manual es el respaldo.
