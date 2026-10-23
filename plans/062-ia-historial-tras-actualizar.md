# Plan 062: Una conversación del asistente se puede retomar después de actualizar la app

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 061 pasos 0–4 hechos)
- **Category**: bug
- **Planned at**: commit `fba59f6`, 2026-10-23

## Why this matters

El asistente (plan 061) guarda cada conversación tal cual se mandó a la API, incluidos los bloques de *thinking*.
La API de Claude ata cada bloque de thinking al prefijo exacto que lo produjo: el `system` (reglas + manual), el array
`tools` y los mensajes anteriores. En las cuentas creadas desde el 2026-08-31 (la cuenta de API del negocio es nueva),
si ese prefijo cambió, retomar la conversación da **400** ("Invalid `signature` in `thinking` block…").

En Hornera el prefijo cambia solo con cada versión nueva: se edita el manual (`manual/manual.html` va entero en el
system), las reglas (`REGLAS`), la descripción de una herramienta, o una migración cambia el esquema que lleva la
descripción de `consulta_sql`. Resultado: después de instalar una versión, toda conversación vieja falla al retomarla.

## Current state

`server/ia/asistente.ts`, dentro de `preguntar()`:

```ts
respuesta = await cliente.create({
  model: configurado,
  max_tokens: 16000,
  thinking: { type: 'adaptive' },
  ...
  ...(configurado === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
});
```

Documentación (skill `claude-api`, `shared/model-migration.md`, "Making a harness compatible"): con el beta
`thinking-binding-controls-2026-08-01` se puede mandar
`thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }`. La API descarta el
primer bloque desalineado y los siguientes, y el pedido sigue. Hay que mandarlo en **todos** los pedidos (el descarte
vale solo para ese pedido). Sin el header, mandar `block_binding` da 400. Funciona en Haiku, Sonnet y Opus 5.5.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | sin errores |
| Tests del asistente | `node --test server/ia/asistente.test.ts` | todos `✔` |
| Todo | `npm test` | `fail 0` y `schema OK` |

## Scope

**In scope**: `server/ia/asistente.ts`, `server/ia/asistente.test.ts`.
**Out of scope**: el formato de `mensajes_json` (no reescribir historiales guardados); `herramientas.ts`.

## Steps

### Step 1: mandar `block_binding` con su beta en todo pedido
En el `cliente.create` de `preguntar()`: `thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }`
y `betas` siempre con `'thinking-binding-controls-2026-08-01'`, más `'server-side-fallback-2026-07-01'` salvo en Haiku.
Si el tipo del SDK no acepta `block_binding`, castear solo ese objeto (no `any` en todo el pedido).
Comentar en una línea por qué (`ponytail:` no hace falta: no es una simplificación).

**Verify**: `npm run typecheck` sin errores.

### Step 2: test
En `server/ia/asistente.test.ts`, en el primer test (Sonnet) y en el de Haiku, verificar que `pedidos[0].thinking`
lleva `block_binding.prefix_mismatch_behavior === 'drop_block'` y que `pedidos[0].betas` incluye
`'thinking-binding-controls-2026-08-01'` (en Haiku, sin el de fallback).

**Verify**: `node --test server/ia/asistente.test.ts` todo `✔`.

## Done criteria

- [ ] `npm test` → `fail 0`.
- [ ] `grep -n "thinking-binding-controls-2026-08-01" server/ia/asistente.ts` → 1 línea.

## STOP conditions

- La API real responde 400 nombrando `block_binding` o el beta (con key cargada): parar y reportar el mensaje.

## Maintenance notes

- Cambiar el manual, las reglas o las herramientas ya no rompe conversaciones; el costo de una conversación vieja
  después de actualizar es que el modelo la retoma sin su razonamiento anterior (el texto visible sigue).
- Si algún día se usa streaming o compaction, este campo sigue igual.
