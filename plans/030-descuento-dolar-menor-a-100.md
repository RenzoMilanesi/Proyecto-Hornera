# Plan 030: El descuento sobre el dólar cripto tiene que ser menor a 100 %

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá A TESTEAR en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 63d8b7e..HEAD -- server/app.ts src/Variables.tsx`
> (las variables operativas todavía sin commitear al escribir este; si `src/Variables.tsx`
> no existe o `server/app.ts` no tiene `const PARAMETROS`, STOP).

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: — (variables operativas, punto 4 del ROADMAP)
- **Category**: correctness
- **Planned at**: `63d8b7e` + diff de variables operativas, 2026-10-16 (revisión `improve deep`)

## Why this matters
`PUT /api/periodos/:mes/parametros` (`server/app.ts`, `PARAMETROS`) valida `usd_descuento_pct`
con la regla `'pct'`, que acepta de 0 a 1 **inclusive**. El modal "Variables del mes"
(`src/Variables.tsx`) deja escribir hasta 100 %. Con 100 %:

- `server/liquidacion/motor.ts:175`: `cambioDelPeriodo = cotizacionUsd * (1 - descuentoPct)` → 0.
- `server/liquidacion/motor.ts:150` (deptos que liquidan en USD):
  `const cambioUsd = p.cambio / (1 - d.comisionCobroUsdPct); conversion = { ars: -lineasArs, usd: lineasArs / cambioUsd };`
  → división por 0: saldo `Infinity`/`NaN`, que se muestra y al cerrar el mes se intenta guardar.

Un 100 % es un error de tipeo (quisieron poner 10), no un valor válido. La comisión del depto
(`comision_pct`) sí puede ser 1 (el esquema lo admite), así que no se toca.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan, `schema OK` |

## Scope
**In**: `server/app.ts` (solo `Regla`, `PARAMETROS`, `validar`), `server/app.test.ts`, `src/Variables.tsx`.
**Out**: `motor.ts`, esquema (`schema.sql`, migraciones), `VARIABLES_DEPTO`, `src/Deptos.tsx`.

## Steps
1. En `server/app.ts` agregar la regla `'pct<1'` al tipo `Regla` y usarla en
   `PARAMETROS.usd_descuento_pct`. En `validar`, `'pct<1'` acepta `typeof v === 'number' && v >= 0 && v < 1`.
   Mantener el estilo de la expresión actual (un solo `ok` con ternarios); actualizar el comentario
   de `Regla` (`'pct<1'` = fracción desde 0 y menor a 1).
2. En `src/Variables.tsx`, el `InputNumber` de `usd_descuento_pct` pasa a `max={99.99}`.
3. En `server/app.test.ts`, test "variables operativas del mes y del depto…": agregar
   `assert.equal((await enviar('periodos/2026-05/parametros', { usd_descuento_pct: 1 })).status, 400);`
   junto a los otros 400 del período (antes del PUT que da 200, para no cambiar la auditoría esperada).

Verificación: `npm test` pasa; `npm run typecheck` exit 0.

## Done criteria
- `grep -n "'pct<1'" server/app.ts` muestra el tipo, `PARAMETROS` y `validar`.
- `npm test` pasa con la aserción nueva.

## STOP conditions
- Si `validar` ya no existe o cambió de forma (otra validación por campo), STOP y reportá.

## Maintenance
Cualquier variable nueva que termine dividiendo (p. ej. un % que se resta de 1) usa `'pct<1'`.
