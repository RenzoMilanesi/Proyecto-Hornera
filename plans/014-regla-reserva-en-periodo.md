# Plan 014: Una sola regla de "reserva del período"

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: plans/011
- **Category**: tech-debt
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
"La reserva entra en el período si tiene noches en él o llega en él" está escrita tres veces:
filtro JS en `server/stays/sync.ts` (`delPeriodo`), SQL de borrado en el mismo archivo y SQL de
`GET /api/reservas` en `server/app.ts`. Si una cambia, la pantalla, el borrado y la
liquidación dejan de coincidir.

## Scope
**In**: `server/periodo.ts` (nuevo), `server/stays/sync.ts`, `server/app.ts`, un test.
**Out**: `server/liquidacion/motor.ts` (recibe reservas ya filtradas; solo un comentario).

## Steps
1. `server/periodo.ts`: `enPeriodo(llegada, salida, inicio, cierre)` en JS y `SQL_EN_PERIODO`
   con parámetros nombrados `:inicio`/`:cierre` sobre `r.llegada`/`r.salida`.
2. Usarlos en los tres lugares (esas consultas pasan a parámetros nombrados).
3. Test que compare JS y SQL en los bordes: sale el día de inicio, llega el día de cierre,
   0 noches dentro, cruza el inicio, cruza el cierre.

**Verify**: `npm test` → pasa.
