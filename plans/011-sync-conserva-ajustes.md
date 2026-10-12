# Plan 011: "Traer mes" no borra reservas con datos cargados a mano

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/stays/`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (pérdida de datos)
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
`sincronizarMes` (`server/stays/sync.ts`, bloque "Reservas del período que Stays ya no
devuelve") borra toda reserva del período que el export de Stays no trajo. Una reserva
**cambiada de fecha** a otro mes en Stays no aparece en el export del mes viejo y se borra
aunque existe, con sus ajustes manuales (`ajuste_ars`, `ajuste_usd`, `ajuste_comision_*`,
`observacion`, `excluida`). Al traer el mes nuevo vuelve sin ajustes.

## Current state
La consulta `viejas` calcula `tenia_ajuste` y `liquidada`; borra si no está liquidada y solo
agrega "(tenía ajustes manuales)" al aviso.

## Scope
**In**: `server/stays/sync.ts`, `server/stays/sync.test.ts`.

## Steps
1. Ampliar `tenia_ajuste`: ajuste_ars, ajuste_usd, ajuste_comision_ars, ajuste_comision_usd
   distintos de 0, observacion no nula o excluida = 1.
2. Con ajustes: no borrar; avisar que ya no aparece en el mes en Stays (si cambió de fecha se
   actualiza al traer el mes nuevo; si se canceló, revisarla). Sin ajustes: borrar como hoy.
3. Test: con ajuste en R2, sacarla del Stays simulado y volver a traer → sigue en la base,
   `eliminadas` = 0 y aparece el aviso. El test existente (R5 sin ajustes se borra) sigue pasando.

**Verify**: `npm test` → pasa.

## Maintenance
Cuando exista una pantalla para borrar reservas a mano (fase 5), el aviso puede enlazarla.
