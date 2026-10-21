# 039 — El manual y la guía de prueba explican la cuenta de la liquidación

Escrito contra el commit `93d29d0` + la cuenta de la liquidación sin commitear. Revisión `improve deep` de esa
tarea, 2026-10-21. Prioridad P2 · Esfuerzo S · Riesgo bajo · Confianza alta.

> Drift check: `git diff --stat 93d29d0..HEAD -- manual/manual.html GUIA-PRUEBAS.md src/Liquidacion.tsx src/Imprimir.tsx`.
> Si `src/Liquidacion.tsx` o `src/Imprimir.tsx` cambiaron después de la cuenta, compararlos con lo descrito abajo.

## Problema
La liquidación ahora muestra la cuenta renglón por renglón, en el detalle de cada depto (`src/Liquidacion.tsx`,
componente `Detalle`) y en el "Resumen" del PDF (`src/Imprimir.tsx`):

```
Ingresos operativos − Costos = Ingreso bruto
Ingreso bruto − Honorarios = Valor liquidación inicial
Valor liquidación inicial − Costos excepcionales = Valor liquidación final
(+ Saldo mes anterior → Saldo a liquidar; el que liquida en USD tiene "Pasado a dólares")
```

El manual sigue describiendo el detalle viejo y confunde los términos:
- `manual/manual.html:223-235`: la figura `img/liquidacion-detalle.png` y la lista "Saldo anterior, Costos
  operativos, Comisiones, **Gastos directos: los movimientos del depto en el mes**, Cambio de moneda". Está mal:
  en el motor, "gastos directos" son los costos operativos más las comisiones, no los movimientos.
- `manual/manual.html:278`: el PDF dice "resumen (bruto, gastos, …".
- `manual/manual.html:633-634` (glosario): "Bruto" y "Honorarios"; faltan "Ingreso bruto", "Costos
  excepcionales" y "Valor liquidación inicial/final".
- `GUIA-PRUEBAS.md`, sección "## 4. Liquidación del mes abierto (fase 5a)": no tiene un paso para la cuenta.

## Solución
1. `manual/manual.html:223-235`: cambiar la leyenda de la figura y la lista por los renglones de la cuenta, con
   qué compone cada uno y dónde se corrige (lo mismo que dice la tercera columna del `Detalle`):
   - Ingresos operativos: lo cobrado de las reservas del período (USD al cambio). Se corrige con **Ajustar** en la reserva.
   - Costos: costos operativos (tarifas: **Variables del mes**) y comisiones OTA/CM (**Ajustar** en la reserva).
   - Honorarios: la comisión del depto (Deptos → Variables).
   - Costos excepcionales: gastos del depto y adelantos al propietario del mes; **Agregar** / **Editar** abren el
     mismo formulario que Movimientos, con el depto ya elegido.
   - Saldo mes anterior y Saldo a liquidar. Botones solo con el mes abierto.
2. `manual/manual.html:278`: "resumen (la cuenta: ingresos operativos, costos, ingreso bruto, honorarios, valor
   de liquidación inicial, costos excepcionales y valor final)".
3. Glosario (`manual/manual.html:633`): agregar filas "Ingreso bruto", "Costos excepcionales", "Valor liquidación
   inicial" y "Valor liquidación final" con el mismo estilo `<tr><td>…</td><td>…</td></tr>`. No cambiar "Bruto"
   (lo sigue usando la pantalla Resumen).
4. `GUIA-PRUEBAS.md`, sección 4: un ítem "Desplegar un depto: la cuenta cierra (valor final + saldo anterior =
   saldo a liquidar, para los que liquidan en pesos); Ajustar una reserva, Agregar un costo excepcional y ver que la
   cuenta y el PDF cambian".
5. Capturas: con la base de demo, `node manual/seed.ts <carpeta>`, `npx electron . --user-data-dir=<carpeta>`,
   `npx electron manual/capturar.mjs manual/img`, `npx electron manual/pdf.mjs`.

## Fuera de alcance
El código de la app, `server/`, los tests. No tocar `Archivos Originales/`. Datos ficticios en todo el manual.

## STOP
- Si `node manual/seed.ts` falla (el 2026-10-21 falló en `manual/seed.ts:118`: "El saldo de este mes ya pasó a
  2026-09 (cerrado): reabrí 2026-09 para anular el pago"), hacer los pasos 1-4, saltear el 5 y avisar: hay que
  arreglar el seed antes de sacar las capturas.

## Hecho cuando
- `grep -n "Gastos directos:</b> los movimientos" manual/manual.html` no devuelve nada.
- `grep -c "Costos excepcionales" manual/manual.html` ≥ 2 y `grep -c "cuenta" GUIA-PRUEBAS.md` ≥ 1.
- `npm test` pasa (no debería cambiar).
