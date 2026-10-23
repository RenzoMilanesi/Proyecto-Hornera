# 051 — Noches no disponibles a partir del calendario de Stays

Escrito contra `fcbdf9e` (2026-10-23). P2 · M · riesgo MEDIO. Depende de: **050** (tabla `calendario_precio`).

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 051 de `plans/README.md`.
>
> **Chequeo de cambios (primero):**
> 1. `grep -n "CREATE TABLE calendario_precio" schema.sql` → tiene que aparecer. Si no, el plan 050 no está
>    hecho: **parar**.
> 2. `grep -n "nochesBloqueadas" server/liquidacion/servicio.ts` → tiene que aparecer (ver el extracto de abajo).
>    Si cambió de forma, parar y avisar.

## Por qué

La pantalla Resumen (v0.37.0) calcula **ocupación** y **RevPAR** sobre las "noches a la venta" = noches del
mes − noches no disponibles − estadías del propietario. Las noches no disponibles salen de la tabla `bloqueo`,
pero **nada la llena**: no hay pantalla para cargar bloqueos y "traer mes" no los trae de Stays (solo la usa el
armado de prueba `server/liquidacion/abril-en-base.ts`). Resultado: un depto cerrado por arreglos dos semanas
aparece con ocupación y RevPAR bajos, como si no se hubiera alquilado. `DECISIONES.md` lo tiene como pendiente
("Bloqueos desde Stays", sección `## Pendiente`).

El plan 050 guarda cada día una foto del calendario de Stays por depto y noche, con `disponible` 0/1. Una noche
con `disponible = 0` **sin una reserva que la cubra** es una noche bloqueada en Stays. Este plan la cuenta como
no disponible al calcular el mes abierto.

## Estado actual

`server/liquidacion/servicio.ts`, dentro de `liquidarPeriodo` (mes abierto):

```ts
  const nochesBloqueadas = db.prepare(`
    SELECT COALESCE(SUM(MAX(0, julianday(MIN(hasta, :cierre)) - julianday(MAX(desde, :inicio)))), 0) AS n
    FROM bloqueo WHERE depto_id = :depto AND estado = 'vigente'`);
  ...
    const nochesNoDisponibles = Math.round((nochesBloqueadas.get({ depto: d.id, inicio: p.fecha_inicio, cierre: p.fecha_cierre_reservas }) as { n: number }).n);
```

`nochesNoDisponibles` va al motor (`server/liquidacion/motor.ts`: `nochesDisponibles = total - d.nochesNoDisponibles`),
al PDF ("No disponible") y, al cerrar el mes, al snapshot `liquidacion.noches_no_disponibles`.
**No cambia ningún importe**: solo noches y ocupación.

Tabla del plan 050 (`schema.sql`): `calendario_precio(depto_id, noche, visto, disponible, min_noches, precio, tramos_json)`,
una fila por (depto, noche) cada vez que esa noche cambió; vale desde `visto` hasta la próxima fila de la misma noche.

## Regla (decidida; no reabrir)

Una noche `N` del período (`inicio <= N < cierre`) de un depto cuenta como **no disponible por calendario** si:

1. la última foto de esa noche tomada **hasta ese mismo día** (`visto <= N`, la de `visto` más alto) tiene
   `disponible = 0`;
2. **ninguna** reserva no cancelada del depto la cubre (`cancelada = 0 AND llegada <= N AND salida > N`;
   las `excluida = 1` **sí** cubren: la reserva existe aunque no se liquide);
3. **ningún** bloqueo vigente de la tabla `bloqueo` la cubre (para no contarla dos veces).

Noches sin ninguna foto (antes de que exista el plan 050, o días con la app apagada sin fotos previas) se
toman como disponibles, igual que hoy.

Las estadías del propietario: si en Stays se cargan como reserva (canal `P`), la regla 2 las deja afuera y
siguen contando como "Ocupado cliente". Si se cargan como bloqueo, pasan a "No disponible". Para las métricas da
lo mismo (las dos se restan de las noches a la venta); solo cambia en qué renglón del PDF aparecen.

## Paso 1 — Consulta en `servicio.ts`

Junto a `nochesBloqueadas`, preparar:

```ts
  // Noches que Stays marcó no disponibles sin reserva ni bloqueo que las cubra (plan 051): bloqueos de Stays.
  const nochesCerradasEnStays = db.prepare(`
    WITH RECURSIVE n(noche) AS (
      SELECT :inicio UNION ALL SELECT date(noche, '+1 day') FROM n WHERE date(noche, '+1 day') < :cierre
    )
    SELECT COUNT(*) AS n FROM n
    WHERE (SELECT c.disponible FROM calendario_precio c
           WHERE c.depto_id = :depto AND c.noche = n.noche AND c.visto <= n.noche
           ORDER BY c.visto DESC LIMIT 1) = 0
      AND NOT EXISTS (SELECT 1 FROM reserva r WHERE r.depto_id = :depto AND r.cancelada = 0
                      AND r.llegada <= n.noche AND r.salida > n.noche)
      AND NOT EXISTS (SELECT 1 FROM bloqueo b WHERE b.depto_id = :depto AND b.estado = 'vigente'
                      AND b.desde <= n.noche AND b.hasta > n.noche)`);
```

y sumarla:

```ts
    const fechas = { depto: d.id, inicio: p.fecha_inicio, cierre: p.fecha_cierre_reservas };
    const nochesNoDisponibles = Math.round((nochesBloqueadas.get(fechas) as { n: number }).n)
      + (nochesCerradasEnStays.get(fechas) as { n: number }).n;
```

No tocar `liquidacionGuardada` (meses cerrados: salen del snapshot) ni el motor.

Verificación: `npm run typecheck` sin errores; `npm test` → `fail 0` (sin filas de calendario en los tests
existentes, nada cambia).

## Paso 2 — Tests en `server/liquidacion/servicio.test.ts`

Patrón: el test "arma la liquidación del mes abierto desde la base" del mismo archivo (usa el helper `periodo`,
`abrirDb(':memory:')` e inserta propietario, depto, reservas y bloqueos con SQL). Un test nuevo,
"noches no disponibles desde el calendario de Stays", con un mes abierto de 30 noches (`2026-06-01` a `2026-07-01`,
cotización 1000) y un depto `AAA`:

- Reserva `R1` del 06-10 al 06-13 (3 noches) y calendario con `disponible = 0` del 06-10 al 06-12 → **no** suman
  (las cubre la reserva).
- Calendario `disponible = 0` las noches 06-20 a 06-24 inclusive (5 filas), sin reserva.
- Bloqueo vigente `desde = '2026-06-22'`, `hasta = '2026-06-26'` (noches 22, 23, 24 y 25: el bloqueo da 4).
  Las noches 22, 23 y 24 ya están en el bloqueo: del calendario suman solo la 20 y la 21 → **2**.
- La noche 06-28 tuvo `disponible = 0` con `visto = '2026-06-01'` y después `disponible = 1` con
  `visto = '2026-06-15'` → **no** suma (vale la última foto).
- La noche 06-29 tiene `disponible = 0` pero solo con `visto = '2026-06-30'` (una foto posterior a la noche, no
  debería existir pero probarlo) → **no** suma.
- Una reserva **cancelada** del 06-02 al 06-04 (noches 2 y 3) con calendario `disponible = 0` esas noches
  → **suman 2** (la cancelada no cubre).

Total esperado: bloqueo 4 + calendario 2 (20, 21) + 2 (02, 03) = **8**. Las filas de calendario usan
`visto = '2026-06-01'` salvo donde se indica otra cosa.

Asertar `liquidarPeriodo(db, '2026-06').deptos[0].nochesNoDisponibles === 8` y
`deptos[0].resultado.nochesDisponibles === 22`. Datos ficticios.

Verificación: `node --test server/liquidacion/servicio.test.ts` pasa; `npm test` → `fail 0`.

## Paso 3 — Documentación

- `DECISIONES.md`: en la sección `## Pendiente`, el renglón que empieza con "Bloqueos desde Stays" pasa a la
  sección de Stays como decisión, con la regla de arriba en dos líneas. Dejar en Pendiente solo la pregunta de
  cómo cargan las estadías del propietario, si sigue sin respuesta.
- No tocar el manual.

## Hecho cuando

- `npm run typecheck` sin errores y `npm test` → `fail 0`.
- `grep -n "nochesCerradasEnStays" server/liquidacion/servicio.ts` → 2 líneas (declaración y uso).
- El test nuevo da 8 noches no disponibles.

## Fuera de alcance

- Meses cerrados y su snapshot; recalcular meses viejos.
- Pantalla para cargar bloqueos a mano.
- Cambiar el motor, el PDF o `server/resumen.ts`.

## Parar y avisar

- Si el plan 050 guardó el calendario con otra forma (otra tabla, otras columnas).
- Si algún test existente cambia de resultado (no debería: no hay filas de calendario en ellos).
- Si la consulta tarda más de ~50 ms por depto en una base con un año de fotos (medir con `console.time`
  en una base de prueba armada a mano); en ese caso, avisar antes de agregar índices.

## Mantenimiento

- **Reserva todavía no traída:** si alguien reservó en Stays y todavía no se hizo "traer mes", esa noche se ve
  como bloqueada hasta el próximo "traer mes". Es esperable en el mes abierto; se corrige solo al traer el mes.
- Al cerrar el mes, `noches_no_disponibles` queda congelada con este cálculo.
- `PRIMARY KEY (depto_id, noche, visto)` de `calendario_precio` ya sirve de índice para la subconsulta.
