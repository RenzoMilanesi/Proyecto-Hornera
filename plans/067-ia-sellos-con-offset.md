# 067 — El asistente sabe que los sellos llevan offset

Escrito sobre `65956b9` (v0.47.0), 2026-10-24. Sale de la revisión `improve deep` del cambio a sellos ISO 8601 con offset.

## Por qué

Desde v0.47.0 los campos `*_en` y `auditoria.fecha` se guardan como `2026-10-24T23:30:00-03:00` (`server/sello.ts`,
DECISIONES → "Fechas y sellos"). Las funciones de fecha de SQLite (`date()`, `datetime()`, `strftime()`) **pasan ese valor
a UTC**: `date('2026-10-24T23:30:00-03:00')` da `'2026-10-25'`. La app no usa esas funciones sobre los sellos salvo para
comparar instantes (`datetime(creada_en) >= datetime(?)` en `server/ia/asistente.ts`, que está bien).

El riesgo está en `consulta_sql` del asistente: su descripción (`server/ia/herramientas.ts`, función `herramientas`) dice
solo "fechas YYYY-MM-DD". Si el modelo arma `GROUP BY date(creado_en)` o `WHERE date(fecha) = '2026-10-24'` sobre la
auditoría, lo hecho después de las 21 h cae en el día siguiente.

## Paso único

En `server/ia/herramientas.ts`, en el texto de `consulta_sql`, después de `fechas YYYY-MM-DD, meses YYYY-MM.` agregar:

```
Los sellos de cuándo se hizo algo (columnas *_en y auditoria.fecha) son ISO con offset, p. ej. 2026-10-24T23:30:00-03:00:
para el día o el mes local usar substr(col, 1, 10) o substr(col, 1, 7), nunca date()/strftime() (las pasan a UTC).
```

Mismo estilo que el resto del string (concatenación con `+`, frases cortas). No tocar nada más.

## Verificación

- `npm run typecheck` sin errores.
- `npm test`: pasa igual (el test `herramientas: la descripción del SQL no nombra las tablas ocultas…` sigue en verde).

## Escape

Si la descripción de `consulta_sql` ya no tiene la frase `fechas YYYY-MM-DD`, ubicar dónde se describen los formatos y
agregar ahí; si no hay ningún lugar así, parar y avisar.

**Hecho (v0.47.1).**
