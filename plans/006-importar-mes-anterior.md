# Plan 006: Importar un mes anterior no pisa propietarios ni deptos con datos viejos

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 589b9b1..HEAD -- server/importador/`. El
> importador se escribió después de ese commit (fase 3, sin commitear al
> planificar): compará con los extractos de abajo.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug
- **Planned at**: commit `589b9b1` + fase 3 sin commitear, 2026-10-12

## Why this matters
`importarExcel` (`server/importador/excel.ts`) actualiza siempre los maestros
con los datos del archivo. Los meses anteriores a abril 2026 van a llegar
**después** de abril: importar marzo dejaría estados, CBU, mails y comisiones de
marzo sobre los de abril (p. ej. un depto finalizado en abril vuelve a "activo").
El histórico de OCUPACION tiene el mismo problema.

## Current state
- Plataformas: `INSERT ... ON CONFLICT(nombre_stays) DO UPDATE SET codigo = ..., gestiona_pago = ..., comision_pct = ...`
- Propietarios: si existe por nombre → `cambiarPropietario.run(...)`; si no, alta.
- Deptos: `INSERT ... ON CONFLICT(codigo) DO UPDATE SET nombre = ..., estado = ..., propietario_id = ...`
- Histórico: `INSERT ... ON CONFLICT(depto_id, mes) DO UPDATE SET noches_ocupadas = ...`
- Cuentas ya usan `DO NOTHING` (no cambian).
- El período se identifica por `mes` ('2026-04'); importar el mismo mes dos veces ya se rechaza.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/importador/excel.ts`, `server/importador/excel.test.ts`.
**Out**: reservas/Stays; la UI.

## Steps
### Step 1: decidir si el archivo es el más nuevo
Antes de crear el período: `actualizar = mes > max(periodo.mes)` (o no hay
períodos). Si no actualiza, sumar un aviso que lo diga.

### Step 2: condicionar las actualizaciones
Plataformas, deptos e histórico: agregar `WHERE ?` al `DO UPDATE` del upsert y
pasar `actualizar ? 1 : 0` como último parámetro. Propietarios existentes: solo
`cambiarPropietario` si `actualizar`. Las altas de lo que falta se hacen siempre.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: test
Con el export de abril (test existente que se saltea sin el archivo): importar
abril; modificar en memoria el libro (SheetJS) para que sea marzo y cambiar el
estado de un depto en Propiedades; importarlo → el depto conserva el estado de
abril y aparece el aviso. Repetir como junio → el estado sí cambia.

**Verify**: `npm test` → pasa.

## STOP conditions
- Si `ON CONFLICT ... DO UPDATE ... WHERE ?` no acepta parámetros en esta versión de SQLite.

## Maintenance
Cuando la app reemplace al Excel (1.0.0), los maestros se editan en la app y el
importador deja de actualizarlos.
