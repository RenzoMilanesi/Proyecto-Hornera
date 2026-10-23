# Plan 065: El costo se ve también cuando contesta el modelo de respaldo

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fba59f6`, 2026-10-23

## Why this matters

Cuando un clasificador rechaza la pregunta, la API la reintenta en otro modelo (`fallbacks: 'default'`):
Sonnet 5.5 → `claude-sonnet-5`; Opus 5.5 → `claude-opus-5` o `claude-opus-4-8`. Cada respuesta guarda
`response.model` (el que contestó de verdad, decisión 8 del plan 061). Pero `costo()` busca ese modelo en la tabla de
precios con `startsWith`, y `claude-sonnet-5` no empieza con `claude-sonnet-5-5`: el costo da `null` justo cuando hubo
respaldo.

## Current state

`server/ia/asistente.ts`:

```ts
const PRECIOS: Record<string, [number, number, number]> = {
  'claude-haiku-5-5': [0.10, 0.50, 0.01],
  'claude-sonnet-5-5': [2, 10, 0.20],
  'claude-opus-5-5': [4, 20, 0.20],
};
export function costo(modelo, t) {
  const p = PRECIOS[Object.keys(PRECIOS).find((m) => modelo.startsWith(m)) ?? ''];
  ...
}
```

Precios (skill `claude-api`, tabla de modelos 2026-10, US$/M tokens entrada/salida): Sonnet 5 2/10, Opus 5 5/25,
Opus 4.8 5/25. Lectura de caché = 10 % de la entrada (0,20 / 0,50 / 0,50).

## Steps

1. Sumar `'claude-sonnet-5': [2, 10, 0.20]`, `'claude-opus-5': [5, 25, 0.50]`, `'claude-opus-4-8': [5, 25, 0.50]`.
2. Buscar por igualdad primero y, si no está, por prefijo **más largo** (para que `claude-opus-5-5` no caiga en
   `claude-opus-5`): ordenar las claves por largo descendente antes del `find`.
3. Test en `asistente.test.ts`: `costo('claude-sonnet-5', …)` y `costo('claude-opus-5-5', …)` dan lo esperado
   (calcular a mano en el test); un modelo desconocido da `null`.

## Done criteria

- [ ] `npm test` → `fail 0`.

## STOP conditions

- Ninguna esperable.

## Maintenance notes

- `ponytail:` existente: precios a mano; el número real está en la consola de Anthropic.
