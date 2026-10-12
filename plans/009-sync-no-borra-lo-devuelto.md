# Plan 009: "Traer mes" solo borra reservas que Stays realmente ya no tiene

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 261b949..HEAD -- server/stays/`. La fase 4 se
> escribió después de ese commit (sin commitear al planificar): compará con los
> extractos de abajo.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (pérdida de datos)
- **Planned at**: commit `261b949` + fase 4 sin commitear, 2026-10-12

## Why this matters
`sincronizarMes` (`server/stays/sync.ts`) borra las reservas del período que no
están en `traidas`, la lista de las que **se guardaron**. Una reserva que Stays
devolvió pero se descartó con aviso (alojamiento desconocido, fechas ilegibles)
se borra de la base junto con sus ajustes manuales. Y si Stays devuelve el export
vacío por un error suyo, se borran todas las reservas del mes.

## Current state
```ts
const viejas = db.prepare(`... WHERE codigo NOT IN (SELECT value FROM json_each(?)) AND (...)`)
  .all(JSON.stringify(traidas), cierre, inicio, inicio, cierre)
```
`porCodigo` (Map) tiene todos los códigos que devolvió Stays en las tres consultas.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/stays/sync.ts`, `server/stays/sync.test.ts`.

## Steps
### Step 1
Comparar contra `[...porCodigo.keys()]` en vez de `traidas`.

### Step 2
Si Stays no devolvió ninguna reserva (`porCodigo.size === 0`) y hay candidatas a
borrar, no borrar ninguna y avisar que el export vino vacío.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: tests
En `sync.test.ts`, después de una primera sync:
- cambiar el alojamiento de una reserva ya guardada a uno desconocido → no se borra;
- vaciar las reservas del Stays simulado → no se borra nada y aparece el aviso.

**Verify**: `npm test` → pasan.
