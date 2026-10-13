# Plan 023: La comparación con el Excel se borra al recalcular

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 5ba95a6..HEAD -- src/Liquidacion.tsx`. La fase 5a se escribió
> después de ese commit (sin commitear al planificar): compará con los extractos.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: ux
- **Planned at**: commit `5ba95a6` + fase 5a sin commitear, 2026-10-12

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

Convenciones: ver `CLAUDE.md` (TypeScript sin build, centavos, datos ficticios en tests).

## Steps
1. `src/Liquidacion.tsx`: borrar la comparación cada vez que se recalcula la liquidación (cambio de
   mes o de cotización), para no mostrar diferencias de un cálculo anterior.

**Verify**: `npm run typecheck` → exit 0; manual: comparar, cambiar la cotización → la columna "Excel" desaparece.
