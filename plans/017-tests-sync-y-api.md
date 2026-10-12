# Plan 017: Tests que faltan en "traer mes", la API y la migración

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: plans/011, plans/014
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

## Steps
1. Stays simulado (`server/stays/sync.test.ts`): registrar las URLs pedidas y verificar las tres
   consultas de 2026-05 (arrival 05-01→06-01, departure 05-02→06-02, included 05-01→06-01).
2. Falla a mitad de la descarga (500 en los pagos de una reserva) → rechaza, la base no cambia
   y queda una `sincronizacion` con 'error'.
3. Reserva que forma parte de una liquidación (`liquidacion_reserva`) y Stays ya no devuelve →
   se conserva con aviso.
4. API (`server/app.test.ts`): `GET /api/reservas?mes=` con una reserva que cruza el borde;
   `POST /api/importar/excel` vacío → 400 JSON; dos "traer mes" a la vez → uno 409.
5. Migración: armar el esquema 1 desde `schema.sql` (la tabla `liquidacion` con `saldo_final`
   en vez de las columnas nuevas), migrarlo y comparar columnas (nombre y NOT NULL) de todas las
   tablas contra una base nueva. Sin fixtures con datos.

**Verify**: `npm test` → pasa.
