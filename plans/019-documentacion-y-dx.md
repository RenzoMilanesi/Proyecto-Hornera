# Plan 019: CLAUDE.md, docs al día y tests que limpian

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- CLAUDE.md DECISIONES.md .claude/skills/commit-version server/app.test.ts`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: plans/015
- **Category**: docs / dx
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
1. `CLAUDE.md` en la raíz (~30 líneas): comandos, estructura, reglas de datos reales (nunca
   abrir ni commitear `Archivos Originales/`), qué tests se saltean sin el Excel local, esquema +
   migración + check juntos, TypeScript sin build, estilo ponytail, skill de commits.
2. `.claude/skills/commit-version/SKILL.md`: los tests viven en `server/**/*.test.ts`; el hook
   corre typecheck + tests (no hay lint); sacar el texto de "antes de package.json".
3. `DECISIONES.md`: "capa repos" no se adoptó (SQL junto a cada módulo).
4. `server/app.test.ts`: borrar las carpetas temporales y cerrar las bases al terminar.

**Verify**: `npm test` → pasa; después no quedan carpetas `hornera-*` nuevas en `%TEMP%`.
