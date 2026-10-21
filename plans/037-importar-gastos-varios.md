# 037 — Importar los gastos varios (Excel "Comprobantes Hornera")

Pendiente 1 del ROADMAP. Definido con el usuario el 2026-10-21 sobre el Excel que usan hoy
(una hoja: Fecha, Hora, Remitente, Departamento, Descripción, Monto, Mensaje original, Otro).
Esos gastos no están en CORRIENTE: solo se llevan en ese Excel.

## Reglas
- Cada fila es un movimiento del **mes abierto** que corresponde a su fecha. Lo de meses anteriores
  ya se les descontó a los propietarios por fuera: se saltea (se cuenta en el reporte). Lo de un mes
  que no está abierto (posterior o inexistente) también se saltea, con aviso.
- Depto conocido → gasto del depto (se le descuenta al propietario). `INT`, vacío o código que la
  app no conoce → gasto de la empresa (sin depto). Los códigos desconocidos se listan juntos para
  preguntarles qué son (p. ej. CAY, CASEST/CASAEST, CAFE, CAY/LAU, BBVA).
- `CASA` (la casa donde viven) no se importa.
- "Adelanto" o "pre liquidación" en la descripción, con depto conocido → `pre_liquidacion`
  (concepto "Adelanto"). Lo demás → `gasto`, concepto "Gastos varios", detalle = descripción
  (más el medio de pago de "Otro", si lo hay). Honorarios y alquiler ya vienen con `INT`.
- Sin cuenta, como CORRIENTE: la columna "Otro" no se mapea a cuentas (las tarjetas son el pendiente 5).
- Monto 0 o vacío: se saltea con aviso.
- Reimportar no duplica: una fila entra solo si en el período hay menos movimientos (vigentes o
  anulados) con la misma fecha, depto, tipo, detalle e importe que veces que aparece en el Excel.
  Un gasto anulado a mano no vuelve.

## Dónde
- `server/importador/gastos.ts` + test. Ruta `POST /api/importar/gastos`.
- Herramientas → Importar Excel: segunda zona para soltar el Excel de gastos, con el reporte.
