# 040 — La pantalla Liquidación de un mes cerrado muestra lo guardado al cerrar

Escrito contra el commit `27da5fb` (v0.30.0). Revisión `improve deep` de la cuenta de la liquidación, 2026-10-21.
Prioridad P1 · Esfuerzo M · Riesgo medio · Confianza alta. Hallazgo **anterior** a la cuenta; la cuenta lo deja más a la vista.

> Drift check: `git diff --stat 27da5fb..HEAD -- server/liquidacion/servicio.ts server/liquidacion/hoja.ts src/Liquidacion.tsx`.
> Si cambiaron, comparar con los fragmentos de abajo antes de seguir.

## Problema
`GET /api/liquidacion?mes=` (`server/app.ts:314`) siempre llama a `liquidarPeriodo` (`server/liquidacion/servicio.ts`),
que **recalcula** desde la base, también con el mes cerrado. En cambio el PDF (`hojaDepto`, `server/liquidacion/hoja.ts:72-88`)
lee lo guardado al cerrar (tablas `liquidacion` y `liquidacion_reserva`). Consecuencias:

- **Mes importado del Excel** (no tiene reservas en la base): la pantalla muestra ingresos 0 y saldos que no son
  los del Excel. Medido con `2026-04.xlsx` importado: de 24 deptos, 0 coinciden con lo guardado en bruto y 0 en
  saldo. La cuenta del detalle (v0.30.0) muestra esos números renglón por renglón.
- **Mes cerrado en la app**: la recalculación usa la comisión, las tarifas propias y la moneda **actuales** del
  depto y del dueño (`SELECT d.comision_pct, … pr.moneda_liquidacion` en `liquidarPeriodo`). Si cambian después
  de cerrar, la pantalla del mes cerrado cambia, aunque el PDF, Transferencias y el Historial no. El ROADMAP
  dice "un mes cerrado no cambia".

## Solución
Una función nueva arma `LiquidacionDepto[]` desde lo guardado, igual que `hojaDepto` en su rama `else`. **No cambiar
`liquidarPeriodo`**: la recalculación de un mes cerrado la usan a propósito "Comparar con el Excel" (`comparar.ts:18`,
que espera AND y RIO distintos en `comparar.test.ts:21`) y `servicio.test.ts:78`. El cierre (`cierre.ts:32`) y el
historial (`historial.ts:36`) la llaman con el mes abierto.

1. `server/liquidacion/servicio.ts`: `export function liquidacionGuardada(db, mes): LiquidacionPeriodo`, que devuelve `{ ...base, cambio: <cambio de las filas guardadas>, avisos: [], deptos }` con una fila por cada
   `liquidacion` del período (`JOIN depto`, y el dueño `COALESCE(l.propietario_id, d.propietario_id)` → `propietario.nombre`):
   - `moneda: l.moneda`, `comisionPct: l.comision_pct`, `nochesNoDisponibles: l.noches_no_disponibles`,
   - `saldoAnterior: { ars: l.saldo_anterior_ars, usd: l.saldo_anterior_usd }`,
     `movimientos: { ars: l.movimientos_ars, usd: l.movimientos_usd }`, `comisiones: { ars: l.comisiones_ars, usd: l.comisiones_usd }`,
   - `resultado`: `ingresos`, `costosOperativos`, `bruto`, `honorarios`, `conversion`, `saldo` (= `saldo_final_*`), noches
     y ocupación de las columnas; `gastosDirectos = truncPesos(-costos - comisiones.ars - comisiones.usd * cambio)` (igual
     que `hoja.ts:80`); `saldoParcial = bruto + gastosDirectos + honorarios`,
   - `resultado.reservas` y `reservas` desde `liquidacion_reserva JOIN reserva` (orden `r.llegada, r.codigo`, como `hoja.ts:82-87`);
     los ajustes (`ajuste_*`, `observacion`) de `reserva`; `comision` de `lr.comision_ars/usd`,
   - `cuenta: cuentaLiquidacion(bruto, gastosDirectos, honorarios, movimientos, cambio)`.
   Comprobar antes que `movimientos_ars/usd` del cierre **no** incluyan el saldo inicial ni los pagos (ver
   `server/liquidacion/cierre.ts`). Si los incluye, STOP.
2. `server/app.ts:314` (`GET /api/liquidacion`): si el período está cerrado, `liquidacionGuardada`; si no, `liquidarPeriodo`.
   `server/resumen.ts` ya lee lo guardado con el mes cerrado: no tocarlo.

## Fuera de alcance
`hoja.ts` (ya lee lo guardado), el motor, el cierre y la reapertura, la UI (`src/Liquidacion.tsx` ya no deja editar
con el mes cerrado).

## Tests (`server/liquidacion/cierre.test.ts`, mismo estilo que "la hoja del PDF da lo mismo con el mes abierto que cerrado")
- Cerrar un mes, después cambiar `depto.comision_pct` y `propietario.moneda_liquidacion`: `liquidacionGuardada` del mes
  cerrado devuelve los mismos `resultado.saldo`, `comisionPct`, `moneda` y `cuenta` que antes del cambio.
- Para cada depto del mes cerrado: `liquidacionGuardada(...).deptos[i].cuenta` es igual (`deepEqual`) a `hojaDepto(...).resumen`.

## STOP
- Si algún test existente que no sea de este plan cambia de resultado, frenar y avisar: es señal de que se tocó `liquidarPeriodo`.

## Hecho cuando
- `npm run typecheck` y `npm test` pasan, con los dos tests nuevos.
- Con `2026-04.xlsx` importado, `liquidacionGuardada(db, '2026-04')` da el `bruto` y el `saldo_final_*` guardados en los 24 deptos.
