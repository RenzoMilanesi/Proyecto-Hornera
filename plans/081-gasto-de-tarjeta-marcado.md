# Plan 081: Los gastos cargados desde la tarjeta quedan marcados y no se pueden duplicar al desvincular

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git log --oneline -3 -- server/tarjeta.ts server/importador/gastos.ts`
> Written against v0.58.0. If `cargar`, `desvincular` or the `desdeTarjeta` query no longer match the excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independiente de 080)
- **Category**: bug
- **Planned at**: v0.58.0 (sobre `49e491b`), 2026-11-26

## Why this matters

En Hornera → Tarjetas, "Cargar como gasto" crea un movimiento (o gasto personal) ligado a los consumos. Si después se
aprieta "Desvincular" en esos consumos, el gasto creado **sigue vigente** pero sin consumo, y el consumo vuelve a
pendiente: cargarlo otra vez crea un segundo gasto → conteo doble, que es justo lo que la pantalla tiene que evitar.
Además, el aviso del importador de gastos reconoce un gasto "de tarjeta" por `detalle LIKE 'Tarjeta:%'`: si alguien edita
el detalle, el aviso deja de funcionar. Marcar el origen resuelve las dos cosas.

## Current state

- `server/tarjeta.ts`:
  - `cargar(db, d)` crea con `crearMovimiento(db, { ..., detalle: \`Tarjeta: ${detalle}\`, ... })` o
    `crearGastoAjeno(db, { fecha, codigo, descripcion: \`Tarjeta: ${detalle}\`, importe })`, sin `origen`.
  - `desvincular(db, ids)` = `enTransaccion(db, () => marcar(db, elegidos(db, ids), {}, 'desvincular'))`: limpia el destino sin mirar de dónde salió.
- `server/movimientos.ts` — `DatosMovimiento.origen?: string | null` ("solo al crear"); `movimiento.origen` tiene índice
  único `uq_mov_origen` (ver `schema.sql`). `server/gastosAjenos.ts` — `DatosGastoAjeno.origen?`, columna `origen TEXT UNIQUE`.
- `server/importador/gastos.ts` — consulta `desdeTarjeta`:
  ```sql
  SELECT m.detalle FROM movimiento m JOIN periodo p ON p.id = m.periodo_id
  WHERE p.mes = ? AND m.estado = 'vigente' AND m.origen IS NULL AND m.detalle LIKE 'Tarjeta:%' AND abs(-m.importe_ars - ?) <= 100
    AND EXISTS (SELECT 1 FROM consumo_tarjeta c WHERE c.movimiento_id = m.id) LIMIT 1
  ```
  El importador usa `origen` = `gastos:<mensaje>:<n>` para sus filas; `tarjeta:` no choca.
- Tests modelo: `server/tarjeta.test.ts` (`cargar: crea el gasto o el personal ya vinculado…` y
  `importar el Excel después del resumen…`).

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                  | exit 0              |
| Tests     | `node --test server/tarjeta.test.ts` | all pass            |
| Todo      | `npm test`                           | all pass            |

## Scope

**In scope**: `server/tarjeta.ts` (`cargar`, `desvincular`), `server/importador/gastos.ts` (consulta `desdeTarjeta`), `server/tarjeta.test.ts`.

**Out of scope**: esquema (no hace falta columna nueva: se usa `origen`), `src/`, `server/movimientos.ts`, `server/gastosAjenos.ts`.

## Steps

### Step 1: Tests que fallan

En `server/tarjeta.test.ts`: (a) cargar un consumo como gasto INT y después `desvincular` ese consumo → tiene que tirar
un error que mencione "Movimientos" (anular el gasto ahí); (b) lo mismo con un gasto personal (`codigo: 'CAY'`) → error que
mencione "Gastos personales"; (c) en el test del importador, cambiar a mano el detalle del movimiento creado por `cargar`
(`UPDATE movimiento SET detalle = 'otro'`) y comprobar que el aviso de conteo doble igual aparece.

**Verify**: `node --test server/tarjeta.test.ts` → los nuevos fallan.

### Step 2: Marcar el origen al cargar

En `cargar`, pasar `origen: \`tarjeta:${filas[0].id}\`` a `crearMovimiento` y a `crearGastoAjeno` (el primer consumo
elegido: único, porque un consumo ya cargado no vuelve a quedar pendiente mientras su gasto esté vigente).

### Step 3: Desvincular no suelta un gasto creado desde la tarjeta

En `desvincular`, antes de `marcar`: si algún consumo elegido tiene `movimiento_id` de un movimiento **vigente** con
`origen LIKE 'tarjeta:%'`, tirar `Error('Ese gasto se cargó desde la tarjeta: anulalo en Movimientos y el consumo vuelve a pendiente.')`;
lo mismo para `gasto_ajeno` vigente con ese origen ("…anulalo en Gastos personales…").

### Step 4: Aviso del importador por origen

En `server/importador/gastos.ts`, en `desdeTarjeta` reemplazar `m.origen IS NULL AND m.detalle LIKE 'Tarjeta:%'` por
`m.origen LIKE 'tarjeta:%'` (el `EXISTS` puede quedar).

**Verify**: `node --test server/tarjeta.test.ts server/importador/gastos.test.ts` → todos pasan.

### Step 5: Suite completa

**Verify**: `npm run typecheck` → exit 0; `npm test` → todos pasan.

## Done criteria

- [ ] `npm run typecheck` exit 0; `npm test` exit 0 con los 3 casos nuevos
- [ ] `grep -n "detalle LIKE 'Tarjeta:%'" server/importador/gastos.ts` → sin resultados
- [ ] `git status` solo muestra los archivos en scope y `plans/README.md`

## STOP conditions

- `crearMovimiento` o `crearGastoAjeno` no aceptan `origen` (drift).
- Un `origen` `tarjeta:<id>` choca con el índice único en algún test (significaría que un consumo se cargó dos veces: reportar).

## Maintenance notes

- Los gastos cargados desde la tarjeta antes de este plan no tienen origen: siguen pudiéndose desvincular (no hay datos reales todavía en las PCs; no hace falta migración).
- El botón "Desvincular" de la pantalla va a mostrar el error del servidor tal cual; no hace falta tocar `src/Tarjetas.tsx`.
