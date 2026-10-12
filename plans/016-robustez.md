# Plan 016: Errores chicos de robustez en importador, sync, backups y pantalla

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/ src/Stays.tsx`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8188cfe`, 2026-10-12 (auditoría `improve deep` de las fases 1-4)

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan, `schema OK` |

Convenciones: TypeScript ejecutado directo por Node/Electron (sin enums ni sintaxis no
borrable, imports con extensión `.ts`), comentarios e identificadores en español,
importes en centavos, estilo mínimo (comentario `ponytail:` en simplificaciones a propósito).

## Steps
1. `excel.ts`: validar "Datos balance" B1/B2 (números, B1 día 1, año 2000-2100, B1 < B2); si no,
   error claro. Hoy fechas vacías crean un período 1899-12 cerrado.
2. `excel.ts` y `sync.ts`: serial de Excel → fecha con `Math.floor` (`Math.round` corre el día
   si la celda tiene hora ≥ 12:00).
3. `sync.ts`: moneda de reserva "ARS"/"USD" explícita; otra cosa → aviso y USD (como hoy).
4. `sync.ts`: un medio de pago creado como "desconocido" toma moneda y comisión reales cuando
   Stays lo informa (en el upsert, `CASE WHEN medio_pago.tipo_stays = 'desconocido'`).
5. `sync.ts`: `stays_id = COALESCE(excluded.stays_id, reserva.stays_id)`.
6. `excel.ts`, `sync.ts`, `db.ts`: `ROLLBACK` solo si `db.isTransaction`, para no tapar el error.
7. `backup.ts`: un error al borrar copias viejas se loguea y no hace fallar el backup.
8. `src/Stays.tsx`: mes por defecto en hora local, no UTC.

## Scope
**In**: los archivos nombrados y sus tests.

## Test plan
Libro sintético sin fecha en B1 → error. Sync: reserva en "EUR" → aviso; medio desconocido que
después aparece → toma la moneda real; reserva sin pagos conserva `stays_id`.

**Verify**: `npm test` → pasa.
