# Plan 015: La regresión de abril prueba importador + motor juntos

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/liquidacion/ scripts/`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: LOW · **Depends on**: plans/013
- **Category**: tests
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
`server/liquidacion/motor.test.ts` compara el motor contra `tests/fixtures/2026-04.json`, que arma
un segundo lector del Excel en Python (`scripts/extraer_fixture_excel.py`). En la fase 5 el motor
se alimenta de lo que guarda el importador TS, y ese camino no tiene test. Los dos lectores ya
difieren (fechas: `int()` vs `Math.round`).

## Scope
**In**: `server/liquidacion/regresion.test.ts` (nuevo), `server/liquidacion/motor.test.ts`,
`scripts/extraer_fixture_excel.py` (se borra), `.gitignore`, docs que lo mencionen.

## Steps
1. Test nuevo (se saltea sin `Archivos Originales/2026-04.xlsx`): importar abril en `:memory:`;
   por cada liquidación importada armar la entrada del motor con período, depto, propietario,
   comisiones, noches no disponibles y movimientos (sin pagos) **de la base**, y las reservas de
   la hoja RESERVAS (SheetJS). Comparar contra el snapshot: ingresos, costos, bruto, honorarios,
   cambio de moneda, saldo final y noches. RIO y AND (costos editados a mano en el Excel): solo
   ingresos y noches.
2. Sacar de `motor.test.ts` el test basado en el fixture; borrar el script Python y la entrada
   `tests/fixtures/` de `.gitignore`.
3. Actualizar menciones en DECISIONES.md / CLAUDE.md.

**Verify**: `npm test` → pasa y el test nuevo no se saltea en esta PC.

## STOP conditions
Si algún depto distinto de RIO/AND no coincide: reportar el depto y el campo (es un bug del
importador o del motor, no del test).
