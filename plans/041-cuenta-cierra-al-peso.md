# 041 — La cuenta de la liquidación cierra al peso con el saldo

Escrito contra el commit `27da5fb` (v0.30.0). Revisión `improve deep` de la cuenta de la liquidación, 2026-10-21.
Prioridad P2 · Esfuerzo S · Riesgo bajo · Confianza alta. **Decisión de producto antes de implementar** (ver Solución).

## Problema
`cuentaLiquidacion` (`server/liquidacion/motor.ts`) parte de `bruto` [F18] (redondeado) y `gastosDirectos` [F19]
(truncado), como el Excel. El saldo [J55] se calcula en `liquidar` desde los valores **sin redondear**. Por eso
"Valor liquidación final + Saldo mes anterior" puede diferir en $ 1 del "Saldo a liquidar". Medido con abril 2026
importado: **6 de los 19 deptos que liquidan en pesos difieren en ±$ 1**. En la pantalla los dos renglones quedan
uno debajo del otro (`src/Liquidacion.tsx`, `Detalle`), y en el PDF el Resumen y el saldo del detalle no coinciden.

## Solución (elegir con los dueños; recomendada la A)
- **A. Renglón "Redondeo"** solo cuando es distinto de 0: en `Detalle`, antes de "Saldo a liquidar" y para
  `d.moneda === 'ARS'`, mostrar `saldo.ars − (cuenta.valorFinal + saldoAnterior.ars + saldoAnterior.usd × cambio)`.
  No cambia ningún número que ya coincide con el Excel. Hacer lo mismo en el detalle del PDF (`src/Imprimir.tsx`).
- B. Calcular la cuenta sin redondear y redondear solo el valor final: cambia los renglones del Resumen del PDF,
  que hoy coinciden con las celdas F18/F19 del Excel. No recomendada mientras se corre en paralelo con el Excel.

## Tests
- `server/liquidacion/motor.test.ts`: con `liquidar` de un caso armado a mano donde bruto redondea para arriba y los
  costos truncan, verificar que el redondeo que muestra la pantalla es `saldo.ars - valorFinal` y vale ±100 centavos.
- `server/liquidacion/servicio.test.ts`: para el mes abierto, `liquidarPeriodo(...).deptos[i].cuenta` es igual a
  `hojaDepto(...).resumen` (hoy son dos caminos distintos: el servicio filtra los movimientos por SQL y la hoja por
  `tipo`). Es el test que asegura que la pantalla y el PDF muestran lo mismo.

## Fuera de alcance
El motor `liquidar` y los valores [F18]/[F19]/[J55]: siguen siendo los del Excel.

## Hecho cuando
- `npm run typecheck` y `npm test` pasan, con los tests nuevos.
- Con un depto en pesos con diferencia, el detalle muestra "Redondeo $ 1" (o "−$ 1") y la suma cierra.
