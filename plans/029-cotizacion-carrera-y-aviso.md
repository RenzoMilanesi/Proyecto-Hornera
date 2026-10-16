# Plan 029: La cotización manual no se pisa en carrera, y "Pedir a la API" muestra su aviso

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá A TESTEAR en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat b0850f2..HEAD -- server/cotizacion.ts src/Liquidacion.tsx`
> (el plan 026 todavía sin commitear al escribir este; si `server/cotizacion.ts` no existe, STOP).

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: 026
- **Category**: correctness + UX
- **Planned at**: `b0850f2` + diff del plan 026, 2026-10-16 (revisión `improve deep` del 026)

## Why this matters
1. **Carrera** (`server/cotizacion.ts`, `actualizarCotizacion`): lee el período, hace `await
   cotizacionCripto(...)` (hasta 15 s por pedido) y después hace `UPDATE periodo SET usd_cotizacion = ?, usd_cotizacion_fuente = 'api' ... WHERE id = ?`.
   Si durante ese `await` alguien guarda una cotización a mano (PUT `/api/periodos/:mes/cotizacion`,
   desde esta PC o una terminal), el "traer mes" la pisa. Eso rompe la decisión "la manual manda"
   (DECISIONES, Tipo de cambio). Ventana chica pero real con terminales.
2. **Aviso perdido** (`src/Liquidacion.tsx`): el botón "Pedir a la API" llama
   `accion('dolar', () => enviar(.../cotizacion/traer ...))` sin mostrar `aviso` de la respuesta (p. ej.
   "Todavía no está la cotización del dólar del 2026-05-31: se usó la de hoy como provisoria.").
   La etiqueta "provisoria" se ve, pero no el porqué.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan, `schema OK` |

## Scope
**In**: `server/cotizacion.ts`, `server/cotizacion.test.ts`, `src/Liquidacion.tsx`.
**Out**: rutas de `server/app.ts`, esquema, importador.

## Steps
1. En `actualizarCotizacion`, el UPDATE pasa a ser condicional cuando no se fuerza:
   `UPDATE periodo SET ... WHERE id = :id AND (:forzar OR usd_cotizacion_fuente IS NOT 'manual')`
   (`forzar` como 0/1). Si `.run(...).changes === 0`, no auditar y devolver
   `{ aviso: 'La cotización del dólar se cargó a mano mientras se pedía a la API: se dejó la manual.' }`.
2. Test en `server/cotizacion.test.ts`: un `fetchFn` falso que, antes de responder, ejecuta
   `db.exec("UPDATE periodo SET usd_cotizacion = 1400, usd_cotizacion_fuente = 'manual'")`; después
   de `actualizarCotizacion(db, '2026-05', false, ...)` el período sigue `{ c: 1400, f: 'manual' }`, no hay
   fila nueva en `auditoria` y vuelve el aviso. Seguir el patrón de `apiFalsa` del mismo archivo.
3. `src/Liquidacion.tsx`: en el `onClick` de "Pedir a la API", usar el aviso de la respuesta:
   `accion('dolar', async () => { const r = await enviar<{ aviso?: string }>(...); if (r.aviso) setAviso(r.aviso); })`.
   Ojo: `accion` limpia `aviso` al empezar y no lo toca al terminar si no se pasa `exito`, así que
   `setAviso` adentro del fn queda visible. Si no queda visible, STOP y reportá.

**Verify**: `npm test` y `npm run typecheck` pasan; el test nuevo falla si se saca la condición del WHERE.

## Maintenance
Cualquier otra escritura automática de `usd_cotizacion` tiene que respetar la misma condición.
