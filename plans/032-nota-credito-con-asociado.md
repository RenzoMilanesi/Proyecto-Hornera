# Plan 032: Una nota de crédito siempre dice qué factura anula

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación. Si aparece una
> condición STOP, frená y reportá. Al terminar, marcá A TESTEAR en `plans/README.md`.
>
> **Drift check**: `git diff --stat 7674289..HEAD -- schema.sql server/db.ts schema.check.mjs`.
> Si `server/db.ts` ya tiene una migración posterior a la 9 → 10, STOP (ver STOP conditions).

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: 031 etapa 1 (hecha)
- **Category**: correctness (integridad de datos)
- **Planned at**: `7674289` (v0.17.0), 2026-10-16 (revisión `improve deep` de la etapa 1 del plan 031)

## Why this matters
En `comprobante` (`schema.sql`, sección FACTURACIÓN ARCA), `asociado_id` marca la factura que
anula una nota de crédito, pero nada obliga a que:
- una NC (`cbte_tipo` 3, 8 o 13) tenga `asociado_id`, ni
- una factura (1, 6, 11) **no** lo tenga.

Una NC sin asociado deja la factura como "vigente" para siempre (el plan 031 calcula lo
facturado como aprobadas − NC por `asociado_id`) y ARCA la autoriza igual, huérfana. Un CHECK lo
cierra en la base. La migración 9 → 10 todavía no se instaló en ninguna PC (v0.17.0 sin build),
así que se corrige **en la misma migración**, sin agregar otra.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Esquema | `node schema.check.mjs` | `schema OK` |
| Tests | `npm test` | todos pasan |
| Tipos | `npm run typecheck` | exit 0 |

## Scope
**In**: `schema.sql` (tabla `comprobante`), `server/db.ts` (migración 9 → 10, la última de
`MIGRACIONES`), `schema.check.mjs`.
**Out**: todo lo demás.

## Steps
1. En `schema.sql`, dentro de `CREATE TABLE comprobante`, después de `ck_comprobante_estado`,
   agregar (con coma en el constraint anterior):
   ```sql
       CONSTRAINT ck_comprobante_nc CHECK ((cbte_tipo IN (3, 8, 13)) = (asociado_id IS NOT NULL))
   ```
   No usar `;` en comentarios dentro de la tabla: la prueba de migración la recorta con `[^;]*;`.
2. Copiar el mismo constraint, igual, en el `CREATE TABLE comprobante` de la última migración de
   `server/db.ts`.
3. En `schema.check.mjs`, sección "Comprobante", después de los `falla(...)` existentes:
   - una NC (`cbte_tipo` 13) sin `asociado_id` falla con `ck_comprobante_nc`;
   - una factura (11) con `asociado_id = 1` falla con `ck_comprobante_nc`;
   - una NC 13 rechazada con `asociado_id = 1` pasa.
   El helper `cbte(...)` actual fija `cbte_tipo` 11 y no tiene `asociado_id`: agregale dos
   parámetros opcionales (`tipo = 11`, `asociado = 'NULL'`) en vez de escribir otro INSERT.

Verificación: `npm test` (corre `schema.check.mjs` y la prueba "una base del esquema 1 migrada
queda igual que una base nueva").

## Done criteria
- `grep -c ck_comprobante_nc schema.sql server/db.ts schema.check.mjs` da ≥ 1 en cada archivo.
- `npm test` pasa.

## STOP conditions
- Si ya existe una migración posterior a la 9 → 10, o la v0.17.0 ya se instaló (hay tag `v0.17.0`
  o build en `release\`): no tocar la 9 → 10; STOP y reportá (hace falta una migración nueva que
  recree la tabla).

## Maintenance
Si se agrega otro tipo de comprobante (p. ej. nota de débito 2/7/12), revisar este CHECK.
