# 042 — Barra del reparto: manual al día, deptos en dólares e ingresos negativos

Escrito contra el commit `c2902cd` + la barra del reparto sin commitear (`BarraReparto` en `src/Liquidacion.tsx`,
`repartoCuenta` en `server/liquidacion/motor.ts`). Revisión `improve deep` de esa tarea, 2026-10-21.
Prioridad P2 · Esfuerzo S · Riesgo bajo · Confianza alta (1 y 2), media (3).

> Drift check: `git diff --stat c2902cd..HEAD -- src/Liquidacion.tsx server/liquidacion/motor.ts manual/manual.html`.
> Si `BarraReparto` o `repartoCuenta` ya no existen, STOP y avisar.

## Contexto
La pantalla Liquidación muestra "¿A dónde fue cada peso?": una barra que reparte lo que entró del depto
(`repartoCuenta(d.cuenta)`) en Costos, Hornera, Gastos del depto, Propietario y, si el valor final es negativo,
Deuda. Grande arriba de la cuenta en el detalle, y mini (8 px, con tooltip) en la columna **Reparto** de la
tabla, que reemplazó a las columnas Bruto y Honorarios. Los totales de bruto y honorarios siguen arriba de la tabla.

## Hallazgos
1. **Manual desactualizado.** `manual/manual.html:223` dice que la fila tiene "bruto, honorarios"; no menciona
   la columna Reparto ni la barra del detalle. La figura `img/liquidacion-detalle.png` es vieja.
2. **Deptos que liquidan en dólares.** La barra está en pesos (la cuenta es en pesos) pero el saldo de la fila
   es en USD. En la demo, DUR muestra "Propietario $ 707.150" en la barra y "US$ 1.977" de saldo: parece una
   diferencia. Tampoco entra el saldo del mes anterior (es a propósito: no salió de lo cobrado este mes).
3. **Ingresos operativos negativos** (un mes solo con ajustes negativos): `entro` puede quedar ≤ 0 con
   `deuda` > 0; los anchos `r[t.k] / ancho` y la línea punteada `r.entro / ancho` salen negativos o > 100%.
   `BarraReparto` solo corta cuando `entro + deuda <= 0`.

## Pasos
1. `manual/manual.html:223`: cambiar "bruto, honorarios" por "una barra con el reparto (pasando el mouse se ven
   los montos)". Antes de "Arriba está la cuenta de la liquidación" (línea 229) agregar un párrafo: la barra
   "¿A dónde fue cada peso?" reparte lo que entró en costos, Hornera, gastos del depto y propietario; si los gastos
   superan lo que le tocaba, un tramo rayado en rojo muestra la deuda. Es en pesos y no incluye el saldo anterior.
   Regenerar capturas según `CLAUDE.md` (sección Manual de usuario) y el PDF.
2. `src/Liquidacion.tsx`, `BarraReparto`, texto al pie: si el depto liquida en USD, agregar
   " · en pesos; el saldo pasa a dólares en la cuenta". Pasar `moneda` como prop (`d.moneda`).
3. `src/Liquidacion.tsx`, `BarraReparto`: cambiar `if (ancho <= 0) return null;` por
   `if (r.entro <= 0) return null;` (`ponytail:` sin barra cuando no entró plata; la cuenta abajo lo explica).

## Verificación
- `npm run typecheck` y `npm test`: 0 errores, todos pasan.
- `node manual/seed.ts <tmp>`, `npx electron . --user-data-dir=<tmp>`, Liquidación: DUR desplegado muestra la
  aclaración de pesos; ALM no.

## Fuera de alcance
El PDF (`src/Imprimir.tsx`) no lleva barra. No tocar `repartoCuenta` ni su test.
