# Plan 013: La moneda de liquidación del propietario sale solo de las hojas de depto

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/importador/`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (plata)
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
En `server/importador/excel.ts` un depto sin hoja (finalizado/pausado) usa
`{ moneda: 'ARS', recargo: 0 }`. Si es la primera fila del propietario en Propiedades, el
propietario queda en ARS aunque la hoja de otro depto suyo diga USD, y `cambiarPropietario`
además pisa con ARS un USD ya guardado.

## Scope
**In**: `server/importador/excel.ts`, `server/importador/excel.test.ts`.

## Steps
1. `cambiarPropietario` deja de tocar la moneda; una sentencia aparte actualiza
   `moneda_liquidacion`/`comision_cobro_usd_pct` solo desde deptos **con hoja** (si el archivo
   es el más nuevo o el propietario es nuevo).
2. El aviso de monedas distintas solo compara deptos con hoja.
3. Test: libro de abril modificado en memoria donde un depto sin hoja que aparece antes
   (MIT, fila 4) tiene el mismo facturante que S38 (fila 9, USD) → el propietario queda USD.

**Verify**: `npm test` → pasa; el test falla si se revierte el paso 1.
