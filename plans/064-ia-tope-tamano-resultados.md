# Plan 064: Lo que devuelve una herramienta del asistente tiene tope de tamaño

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (si 063 está hecho, el tope por celda va en el Worker)
- **Category**: perf / costo
- **Planned at**: commit `fba59f6`, 2026-10-23

## Why this matters

Cada resultado de herramienta va a la API como texto y queda en el historial de la conversación, que se reenvía en
cada pregunta siguiente (con caché, al 10 %, pero sin tope). Hoy nada limita el tamaño:

- `consulta_sql` con `SELECT * FROM reserva` trae `raw_json` (el JSON completo de Stays de cada reserva) y
  `desglose_json`: 200 filas × varios KB.
- `liquidacion` de un mes con todos los deptos ronda 10 KB con 5 deptos en la demo; con ~24 deptos reales, varias veces más.

Medido en la demo (`manual/seed.ts`): `liquidacion` 10,6 KB, `hoja_depto` 37 KB antes de sacar el QR. El `raw_json`
real no se midió (está en datos reales, que no se abren): confianza media.

## Current state

`server/ia/asistente.ts`, en el bucle:

```ts
const r = h.correr(db, b.input as Record<string, unknown>);
...
resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r) });
```

`server/ia/herramientas.ts` → `consultaSql` devuelve las filas tal cual.

## Steps

1. En `consultaSql`: cada valor de texto de más de 2.000 caracteres se corta y termina en `… (cortado: N caracteres)`.
   Comentario de una línea: es para `raw_json` / `desglose_json`.
2. En `preguntar`: si `JSON.stringify(r)` pasa de 100.000 caracteres, mandar los primeros 100.000 más
   `\n[Resultado cortado: tenía N caracteres. Pedí menos datos (un depto, un mes, menos columnas).]`.
   Constante exportada `MAX_RESULTADO = 100_000` en `asistente.ts`.
3. Descripción de `consulta_sql`: agregar "Evitá SELECT * en reserva y pago (raw_json es grande): elegí columnas."
4. Tests: en `herramientas.test.ts`, una reserva con `raw_json` de 5.000 caracteres sale cortada con el aviso;
   en `asistente.test.ts`, una herramienta que devuelve > 100.000 caracteres llega cortada al segundo pedido
   (`pedidos[1].messages[2].content[0].content` termina con el aviso).

## Done criteria

- [ ] `npm test` → `fail 0`.
- [ ] Los dos tests nuevos pasan.

## STOP conditions

- Cortar el JSON a la mitad hace que la IA conteste con números de la parte cortada sin avisar: el aviso tiene que
  quedar al final del texto, siempre.

## Maintenance notes

- Si en la validación (paso 9 del plan 061) una pregunta legítima se corta, subir `MAX_RESULTADO` o agregar un
  parámetro `depto` a la herramienta, antes que sacar el tope.
