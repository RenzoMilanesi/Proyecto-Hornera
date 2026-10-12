# Plan 007: Si una migración del esquema falla, la base queda como estaba

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Al terminar, marcá DONE en `plans/README.md`.
>
> **Drift check**: `git diff --stat 589b9b1..HEAD -- server/db.ts`.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug
- **Planned at**: commit `589b9b1` + fase 3 sin commitear, 2026-10-12

## Why this matters
`abrirDb` aplica el esquema o las migraciones con
`db.exec(\`BEGIN; ${cambios}; PRAGMA user_version = N; COMMIT;\`)`. Si una
sentencia falla, `exec` lanza el error con la transacción abierta y sin
`ROLLBACK` explícito. La app no arranca igual, pero una conexión que siga
usándose (tests, o un reintento futuro) quedaría dentro de esa transacción.

## Current state
`server/db.ts`, función `abrirDb`, bloque `if (version < VERSION_ESQUEMA)`.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/db.ts`, `server/app.test.ts`. **Out**: el contenido de las migraciones.

## Steps
### Step 1
Separar `BEGIN` y envolver el resto en `try { ... COMMIT } catch { ROLLBACK; throw }`,
igual que `importarExcel`.

### Step 2: test
Base con `user_version = 1` y una tabla `liquidacion` sin la columna
`saldo_final` (la migración falla) → `abrirDb` lanza y la base sigue en
`user_version = 1` con la tabla intacta.

**Verify**: `npm test` → pasa.
