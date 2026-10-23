# 053 — Test: alojamiento y métricas de un mes cerrado con detalle de reservas

Escrito contra `fcbdf9e` (2026-10-23). P3 · S · riesgo BAJO. Depende de: ninguno.

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 053 de `plans/README.md`.
>
> **Chequeo de cambios (primero):** `grep -n "alojamiento: reservas.length === 0" server/liquidacion/servicio.ts`
> → 1 línea. Si no aparece, parar y avisar.

## Por qué

La pantalla Resumen calcula ADR y RevPAR con `alojamiento` = lo que pagaron los huéspedes por las noches, sin
la tarifa por estadía y **sin las estadías del propietario** (canal `P`). Para un mes cerrado sale de
`liquidacionGuardada` en `server/liquidacion/servicio.ts`, leyendo el detalle guardado (`liquidacion_reserva`)
y el canal de cada reserva:

```ts
  const reservasDe = db.prepare(`
    SELECT r.id, r.codigo, r.codigo_ota, r.llegada, r.huespedes, r.ajuste_ars, r.ajuste_usd, r.ajuste_comision_ars, r.ajuste_comision_usd,
           r.observacion, pl.codigo AS canal, lr.*
    FROM liquidacion_reserva lr JOIN reserva r ON r.id = lr.reserva_id LEFT JOIN plataforma pl ON pl.id = r.plataforma_id
    WHERE lr.liquidacion_id = ? ORDER BY r.llegada, r.codigo`);
  ...
      // ponytail: mes importado del Excel, sin detalle de reservas: no se puede separar al propietario.
      alojamiento: reservas.length === 0 ? l.bruto - l.costos_operativos : redondearPesos(reservas.reduce((s, x) => (x.canal === 'P' ? s
        : s + x.importe_periodo_ars + x.importe_periodo_usd * l.cambio - x.tarifa_periodo), 0)),
```

Los tests de `server/resumen.test.ts` solo cubren la rama **sin** detalle (mes importado del Excel). La rama
con detalle (la de todos los meses cerrados en la app) no tiene test: si alguien cambia el `JOIN` o el nombre
`canal`, el ADR de los meses cerrados se rompe sin aviso. Además `server/resumen.ts` toma la cantidad de
reservas de `liquidacion.cant_reservas`, no del detalle.

## Paso 1 — Test nuevo en `server/resumen.test.ts`

Leer el archivo entero: tiene los helpers `periodo(db, mes, inicio, cierre, estado)` y
`liquidacion(db, periodoId, deptoId, ocupadas, bruto, costos, honorarios)` (este último inserta con
`cant_reservas = 2`, `cambio = 1000`, `noches_disponibles = 30` y `noches_propietario` en 0 por defecto).

Test nuevo: **"mes cerrado con detalle: el alojamiento no cuenta al propietario ni la tarifa por estadía"**.

1. Base `abrirDb(':memory:')`, período `2026-04` abierto, propietario, depto `AAA` (id 1).
2. Plataformas: `INSERT INTO plataforma(nombre_stays, nombre, codigo, gestiona_pago) VALUES ('API airbnb', 'Airbnb', 'A', 1), ('Propietario', 'Propietario', 'P', 0)`.
3. Reservas (columnas obligatorias: `codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en`,
   más `plataforma_id`):
   - `R1`, Airbnb, 04-05 al 04-15 (10 noches), ARS.
   - `R2`, Airbnb, 04-20 al 04-22 (2 noches), USD.
   - `RP`, Propietario, 04-25 al 04-30 (5 noches), ARS.
4. `liquidacion(db, abril, 1, 17, <bruto>, <costos>, <honorarios>)` y después
   `UPDATE liquidacion SET noches_propietario = 5` (y `RETURNING id` o `SELECT id` para usar en el detalle).
5. `liquidacion_reserva` (todas las columnas `NOT NULL` de `schema.sql`; las que no importan, 0):
   - R1: `noches_periodo 10`, `importe_periodo_ars 50000000` ($500.000), `importe_periodo_usd 0`, `tarifa_periodo 6000000` ($60.000).
   - R2: `noches_periodo 2`, `importe_periodo_ars 0`, `importe_periodo_usd 20000` (US$ 200), `tarifa_periodo 2000000` ($20.000).
   - RP: `noches_periodo 5`, `importe_periodo_ars 0`, `importe_periodo_usd 0`, `tarifa_periodo 3000000` ($30.000).
6. `UPDATE periodo SET estado = 'cerrado'`.
7. `const d = resumenDelMes(db, '2026-04').deptos[0]` y asertar:
   - `d.alojamiento === 50000000 - 6000000 + 20000 * 1000 - 2000000` → `62000000` ($620.000). RP no suma ni resta.
   - `d.noches_vendidas === 12`, `d.noches_venta === 25`.
   - `d.adr === Math.round(62000000 / 12)` y `d.revpar === Math.round(62000000 / 25)`.
   - `d.reservas === 2` (sale de `cant_reservas` del snapshot, no del detalle de 3).

Datos ficticios. Elegir `bruto`, `costos` y `honorarios` coherentes (por ejemplo bruto = 70000000,
costos = 11000000, honorarios = −10000000); no se asertan.

Verificación: `node --test server/resumen.test.ts` → todos pasan.

## Paso 2 — Que el test falle si se rompe

Cambiar a mano, **temporalmente**, `x.canal === 'P'` por `x.canal === 'X'` en `servicio.ts` y correr el test:
tiene que fallar en `alojamiento`. Volver el cambio atrás y confirmar con `git diff server/liquidacion/servicio.ts`
→ vacío.

## Hecho cuando

- `npm test` → `fail 0`, con un test más que antes.
- `git diff --stat` → solo `server/resumen.test.ts` (y `plans/README.md`).

## Fuera de alcance

- Cualquier cambio en `server/resumen.ts`, `servicio.ts` o el motor. Si el test muestra un error real en el
  cálculo, **parar y avisar** con el valor obtenido y el esperado.

## Parar y avisar

- Si `alojamiento` no da 62000000 y la diferencia no es un error del propio test.
- Si insertar en `liquidacion_reserva` pide columnas que no están en `schema.sql`.

## Mantenimiento

- Si cambia cómo se identifica una estadía del propietario (hoy: plataforma con `codigo = 'P'`), este test es
  el que tiene que cambiar primero.
