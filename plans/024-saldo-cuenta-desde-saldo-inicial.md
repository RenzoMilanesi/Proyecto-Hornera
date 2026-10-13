# Plan 024: El saldo de una cuenta arranca en su "Saldo inicial"

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 4745948..HEAD -- schema.sql server/db.ts server/movimientos.test.ts server/app.ts src/Cuentas.tsx`.
> La fase 5b se escribió después de ese commit (sin commitear al planificar).

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (plata)
- **Planned at**: commit `4745948` + fase 5b sin commitear, 2026-10-12

## Why this matters
`v_saldo_cuenta` (`schema.sql`, migración 2 → 3 en `server/db.ts`) suma todos los movimientos de la
cuenta y todos los pagos de Stays de sus medios de pago, de cualquier fecha. El saldo inicial que se
carga al empezar a usar la app (lo que dice el banco ese día) ya incluye lo cobrado antes; si esos meses
se trajeron de Stays (marcha en paralelo), se cuentan dos veces.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan, `schema OK` |

## Scope
**In**: `schema.sql`, `server/db.ts`, `server/movimientos.test.ts`, `server/app.ts` (GET /api/cuentas),
`src/Cuentas.tsx`, `DECISIONES.md`.

## Steps
1. La vista calcula `saldo_desde` = fecha del primer movimiento "Saldo inicial" vigente de la cuenta y
   suma solo movimientos con fecha ≥ esa y pagos con `fecha_pago` ≥ esa (los pagos sin fecha cuentan).
   Sin saldo inicial, suma todo como antes. El esquema 3 todavía no se publicó: se corrige la misma
   migración 2 → 3 (no hace falta una 3 → 4).
2. `GET /api/cuentas` devuelve `saldo_desde`; la pantalla Cuentas lo muestra ("desde DD/MM/AAAA").
3. Test en `server/movimientos.test.ts`: saldo inicial el 10/5; un pago del 5/5 y un movimiento del 3/5
   no cuentan; un pago del 12/5 sí.

**Verify**: `npm test` → pasa (incluido "una base del esquema 1 migrada queda igual que una base nueva").

## STOP conditions
- Si alguna base instalada ya está en el esquema 3 (no debería: la fase 5b no se publicó): entonces
  hace falta una migración 3 → 4 en vez de editar la 2 → 3.
