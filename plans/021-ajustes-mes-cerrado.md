# Plan 021: No se cambian ajustes de reservas que forman parte de un mes cerrado

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 5ba95a6..HEAD -- server/app.ts`. La fase 5a se escribió
> después de ese commit (sin commitear al planificar): compará con los extractos.

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5ba95a6` + fase 5a sin commitear, 2026-10-12

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

Convenciones: ver `CLAUDE.md` (TypeScript sin build, centavos, datos ficticios en tests).

## Why this matters
`PUT /api/reservas/:id` (`server/app.ts`) acepta cambios en reservas de un mes cerrado: el mes cerrado
queda con los valores viejos (snapshot) y el abierto toma los nuevos, así que el total deja de cerrar.
DECISIONES: el mes cerrado queda congelado y se reabre a mano.

## Steps
1. Antes de guardar, buscar un período cerrado donde la reserva entre (misma regla que
   `SQL_EN_PERIODO` de `server/periodo.ts`, aplicada a las fechas del período). Si hay, 400:
   "La reserva es parte del mes cerrado M: reabrilo para cambiar sus ajustes."
2. Test en `server/app.test.ts`.

**Verify**: `npm test` → pasa.

## Maintenance
La reapertura (fase 5c) habilita de nuevo estos cambios.
