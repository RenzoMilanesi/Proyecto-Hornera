# 046 — Saldado por fuera: el PDF del mes y el "hasta" sin validar

Escrito contra el commit `7d2cb7d`. Revisión `improve deep` de la tarea "saldado por fuera" (v0.32.0), 2026-10-21.
Prioridad P2 · Esfuerzo S · Riesgo bajo · Confianza alta (1), media (2).

> Drift check: `git diff --stat 7d2cb7d..HEAD -- server/liquidacion/hoja.ts server/liquidacion/pagos.ts src/Imprimir.tsx`.

## Contexto
Una liquidación de un mes cerrado se puede marcar "saldada por fuera" (`liquidacion.saldado_fuera`, fecha;
`saldado_fuera_nota`). Entonces `listarTransferencias` (`server/liquidacion/pagos.ts`) da `pendiente: 0`, el
arrastre al mes siguiente (`servicio.ts`, consulta de `saldos`) es 0 y no hay movimiento de pago.

## Hallazgos
1. **El PDF del mes saldado sigue mostrando la deuda.** `hojaDepto` (`server/liquidacion/hoja.ts:93-95`) calcula el
   saldo final de la hoja restando solo los movimientos `tipo = 'liquidacion'`. Una liquidación saldada por fuera
   no tiene movimiento, así que el PDF de ese mes dice "Saldo septiembre $ 1.816.360" como si se debiera, cuando en
   Transferencias e Historial figura saldada. Si ese PDF se le manda al propietario, contradice lo acordado.
2. **`saldarFueraHasta` no valida `hasta`** (`pagos.ts`): con `''` no marca nada y devuelve 0 sin error; con un
   texto que no es `AAAA-MM` la comparación de strings `mes <= ?` puede abarcar meses de más. La pantalla siempre
   manda un mes válido, por eso la confianza es media.

## Pasos
1. `hoja.ts`: leer `saldado_fuera, saldado_fuera_nota` de la liquidación (rama del mes cerrado) y devolverlo en la hoja
   (p. ej. `saldadoFuera: { fecha, nota } | null`). El saldo final de la hoja queda en 0 si está marcado.
   `src/Imprimir.tsx`: bajo "Saldo <mes>", una línea "Saldado por fuera el <fecha> (<nota>)".
   Test en `server/liquidacion/cierre.test.ts`, junto al de "saldado por fuera": `hojaDepto(db, '2026-05', 'AAA')`
   tras marcar da `detalle.saldo` `{ ars: 0, usd: 0 }`.
2. `pagos.ts`, `saldarFueraHasta`: `if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido (AAAA-MM).');` y
   un caso en el mismo test.

## Verificación
`npm run typecheck` y `npm test` en verde. En la app de demo: marcar ESC 2026-09 y abrir su PDF: saldo 0 con la línea.

## Fuera de alcance
No tocar la cuenta de la liquidación (`cuentaLiquidacion`): la marca no cambia lo liquidado, solo lo pendiente.
