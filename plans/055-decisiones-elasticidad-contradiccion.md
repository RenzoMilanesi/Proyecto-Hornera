# 055 — DECISIONES: sacar la elasticidad de "Quedan afuera del sistema"

Escrito contra `4a42a69` (2026-10-23). P3 · S · riesgo BAJO. Depende de: ninguno.

> **Para quien ejecute:** es un cambio de una línea de documentación. Al terminar, actualizá la fila 055 de
> `plans/README.md`.
>
> **Chequeo de cambios (primero):** `grep -n "y elasticidad (no se puede medir con estos datos)" DECISIONES.md`
> → 1 línea. Si no aparece, parar y avisar.

## Por qué

Desde v0.38.0 la pantalla Resumen calcula una elasticidad precio indicativa, y `DECISIONES.md` la describe en el
renglón que empieza con `- **Elasticidad (indicativa`. Pero dos renglones más abajo sigue el texto de antes, que
dice lo contrario:

```
- Quedan afuera del sistema: costo operativo real por reserva y márgenes de Hornera (falta clasificar los gastos de la empresa), lead time (falta la fecha de creación de la reserva), cap rate (falta el valor de la propiedad) y elasticidad (no se puede medir con estos datos).
```

Quien lea DECISIONES no sabe cuál de los dos vale.

## Paso 1 — Editar ese renglón

Reemplazar el final `, cap rate (falta el valor de la propiedad) y elasticidad (no se puede medir con estos datos).`
por ` y cap rate (falta el valor de la propiedad).`

Queda:

```
- Quedan afuera del sistema: costo operativo real por reserva y márgenes de Hornera (falta clasificar los gastos de la empresa), lead time (falta la fecha de creación de la reserva) y cap rate (falta el valor de la propiedad).
```

No tocar el renglón de la elasticidad ni ningún otro.

## Hecho cuando

- `grep -c "elasticidad (no se puede medir" DECISIONES.md` → 0.
- `git diff --stat` → solo `DECISIONES.md` (y `plans/README.md`), 1 línea cambiada.

## Fuera de alcance

- Código, manual, ROADMAP. No hace falta bump de versión (solo docs).

## Parar y avisar

- Si el renglón cambió de forma y el reemplazo no es obvio.
