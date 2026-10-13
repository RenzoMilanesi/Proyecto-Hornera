# Plan 022: Avisar cuando el saldo se arrastra desde un mes que no es el anterior

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 5ba95a6..HEAD -- server/liquidacion/servicio.ts`. La fase 5a se escribió
> después de ese commit (sin commitear al planificar): compará con los extractos.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5ba95a6` + fase 5a sin commitear, 2026-10-12

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

Convenciones: ver `CLAUDE.md` (TypeScript sin build, centavos, datos ficticios en tests).

## Steps
1. En `liquidarPeriodo`, si el período anterior encontrado no es el mes inmediatamente anterior,
   avisar ("se arrastra el saldo de M; falta cargar el mes del medio").
2. Test en `servicio.test.ts`.

**Verify**: `npm test` → pasa.
