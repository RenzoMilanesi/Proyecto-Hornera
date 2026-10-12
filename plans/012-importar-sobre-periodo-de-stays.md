# Plan 012: Importar el Excel de un mes ya traído de Stays

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/importador/`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
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

## Why this matters
"Traer mes" crea el período si no existe. Después, importar el Excel de ese mes falla con
"El período M ya está importado" (`server/importador/excel.ts`, chequeo
`SELECT 1 FROM periodo WHERE mes = ?`), y ese período abierto cuenta como "el último mes"
(`SELECT max(mes) FROM periodo`), así que el Excel más nuevo deja de actualizar maestros.
En la marcha en paralelo es el flujo normal.

## Scope
**In**: `server/importador/excel.ts`, `server/importador/excel.test.ts`.

## Steps
1. "Último mes" = `max(mes)` de los períodos **cerrados**.
2. Mes cerrado → error "ya está cerrado". Abierto con movimientos → error claro (ya hay
   movimientos cargados en la app). Abierto sin movimientos (lo creó "traer mes") → se importa
   encima: el alta del período pasa a `INSERT ... ON CONFLICT(mes) DO UPDATE ... RETURNING id`.
3. Tests (con el Excel real; se saltean sin él): período 2026-04 abierto creado a mano →
   importar funciona y queda cerrado con los parámetros del Excel; con un movimiento → error.
   Un período abierto 2026-06 no impide que abril actualice maestros.

**Verify**: `npm test` → pasa.
