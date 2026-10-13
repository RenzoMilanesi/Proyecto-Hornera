# Plan 020: La comisión de una reserva se cobra una sola vez

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 5ba95a6..HEAD -- server/liquidacion/`. La fase 5a se escribió
> después de ese commit (sin commitear al planificar): compará con los extractos.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (plata)
- **Planned at**: commit `5ba95a6` + fase 5a sin commitear, 2026-10-12

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

Convenciones: ver `CLAUDE.md` (TypeScript sin build, centavos, datos ficticios en tests).

## Why this matters
`liquidarPeriodo` (`server/liquidacion/servicio.ts`) suma `ajuste_comision_ars/usd` de todas las
reservas del período. Una reserva que cruza de un mes a otro aparece en los dos y su comisión se
descuenta dos veces (la corrección de lo cobrado, en cambio, el motor la prorratea por noches).

## Steps
1. Sumar la comisión solo de las reservas que **llegan** en el período (`llegada >= inicio` y
   `< cierre`). En el Excel la comisión se tipea una vez, en un mes.
2. `server/liquidacion/abril-en-base.ts`: poner la comisión de cada depto en su primera reserva
   que llega en abril (no en una que viene de marzo).
3. Test en `servicio.test.ts`: reserva del 28/4 al 3/5 con comisión → no cuenta en mayo; una que
   llega en mayo sí.

**Verify**: `npm test` → pasa (incluida la de abril armado en la base).
