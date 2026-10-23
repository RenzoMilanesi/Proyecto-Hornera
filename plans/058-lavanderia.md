# 058 — Lavandería: cargar cada pago en la app como gasto de la empresa

Escrito contra `ad5d3f7` (2026-10-23). P2 · S. Depende de: 057 (misma pantalla `src/Limpieza.tsx`).

## Por qué
Parte de centralizar los gastos de HORNERA. La lavandería se pagaba anotándolo en la hoja "Lavanderia" del Excel
de limpieza (fecha, cantidad de lavados, monto, precio por lavado). De ahora en más se carga en la app.

Decisiones del usuario (2026-10-23):
1. Se carga **desde la app**. El Excel viejo **no se importa**: lo de antes ya pasó.
2. El pago de lavandería del 02/10/2026 entró por el Excel de gastos varios con concepto "Gastos varios": está mal
   cargado. Cuando exista la sección, se pasa a lavandería (a mano: anular ese movimiento y cargarlo acá).

## Reglas del repo
Como en 057: centavos, fechas ISO, esquema + migración + `schema.check.mjs` juntos, skill `modales`, datos ficticios.

## Pasos

### 1. Esquema
```sql
-- Pagos de lavandería (plan 058). Cada uno genera su gasto de la empresa.
CREATE TABLE lavanderia (
    id             INTEGER PRIMARY KEY,
    fecha          TEXT    NOT NULL CHECK (date(fecha) IS fecha),
    lavados        INTEGER CHECK (lavados IS NULL OR lavados > 0),  -- informativo
    importe        INTEGER NOT NULL CHECK (importe > 0),            -- centavos: lo pagado
    movimiento_id  INTEGER NOT NULL REFERENCES movimiento(id)
) STRICT;
```
Se guarda el **importe pagado**, no precio × cantidad: los montos reales no siempre dan exacto. El precio por
lavado se muestra como `importe / lavados`.

### 2. `server/limpieza.ts`
- `cargarLavanderia(db, { fecha, lavados, importe, cuenta_id })`: en una transacción crea con `crearMovimiento`
  el gasto de la empresa (concepto `Lavandería`, detalle `Lavandería · N lavados`) y la fila.
- Editar y anular pasan por el movimiento (`editarMovimiento` / `anularMovimiento`); la lista muestra solo las
  filas con el movimiento vigente.
- `listarLavanderia(db, { desde, hasta })`: filas + totales (lavados, importe, precio promedio).

### 3. Rutas y pantalla
`GET/POST /api/limpieza/lavanderia`. Pestaña "Lavandería" en `src/Limpieza.tsx`: lista y botón "Cargar pago"
(modal: fecha, lavados, importe, cuenta). Totales por mes.

### 4. Importador de gastos varios
En `server/importador/gastos.ts`, una fila de la empresa cuya descripción contenga "lavander" se importa igual,
con un aviso: `Fila N: lavandería, cargala en Limpieza → Lavandería`. Así no vuelve a quedar mal sin que se note.

## Tests
Cargar un pago crea el movimiento (empresa, concepto Lavandería, importe negativo) y la fila; anular el movimiento
lo saca de la lista; el aviso del importador de gastos aparece.

## Done
`npm test` y `npm run typecheck` pasan; el pago cargado aparece en Movimientos y en el Resultado de Hornera.
