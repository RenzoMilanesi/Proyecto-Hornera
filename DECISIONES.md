# Decisiones — Proyecto Hornera

Grill-me del 2026-10-11 (reinicio desde cero). Fuentes: `Archivos Originales/`.

## Alcance v1
- **Objetivo:** automatizar la liquidación mensual a propietarios. Reemplaza los scripts `balances-hornera` y las hojas `Datos balance`, `RESERVAS`, `CORRIENTE`, `NO COMISIONABLES`, `Cont Interna` y las hojas por depto.
- **Usuarios:** solo los dueños (Lautaro y Amancay). Sin roles.
- **Salidas:** PDF por depto (mismo contenido y orden que la hoja actual), lista de transferencias (pantalla + Excel) y resumen interno.
- **Prioridad:** 1) liquidación (ingesta, movimientos, cuentas, cierre, PDF, transferencias). 2) Resumen: KPIs por depto, resultado de Hornera, saldos de cuentas, evolución histórica.
- **Fuera de la v1:** envío de mails, facturación ARCA, Mantenimiento, Obligaciones, Checklist, Hospy (se ignora).

## Datos y reglas
- **Stays:** API directa con un botón "traer mes" (reservas + pagos por reserva + medios de pago).
- **Movimientos:** formulario completo que reemplaza `CORRIENTE`. Cada movimiento lleva depto (o INT), fecha, concepto, ARS/USD y **cuenta**; el sistema calcula el saldo de cada cuenta.
- **Medios de pago de Stays → cuenta de la empresa:** tabla de mapeo (p. ej. "Mercado Pago Lau" → Mercadopago L).
- **Moneda:** igual que el Excel. Bruto = ARS + USD × cambio; honorarios y costos en ARS. Al cierre, el saldo se convierte a la **moneda de liquidación del propietario**: ARS (USD × cambio, la mayoría) o USD (ARS ÷ cambio, con un recargo opcional, p. ej. 4 % en R64). Se descubrió al reproducir abril: 5 deptos cierran en USD.
- **Motor de liquidación:** `server/liquidacion/motor.ts`, función pura. Reproduce las 24 hojas de abril 2026 al centavo, salvo RIO y AND, que tienen costos editados a mano en el Excel.
- **Tipo de cambio:** se trae automático (dólar cripto) menos el % configurable (hoy 6 %), con override manual.
- **Tarifa por reserva:** la fórmula del Excel, con parámetros globales por período y override opcional por depto. Se prorratea por las noches del período.
- **Comisiones OTAs/agentes/CM:** se calculan automáticamente por reserva con el % de cada plataforma más el fee de CM por depto; se pueden ajustar a mano.
- **Pago directo por plataforma (co-host Airbnb):** configuración por depto + canal, con la fórmula de `3-Union_Reservas_Cuentas.PY`.
- **Correcciones:** preferentemente en Stays y volver a sincronizar; también ajuste manual sobre la reserva (corrección ARS/USD, observación) que no se pisa al re-sincronizar.
- **Cierre:** el mes queda congelado (parámetros, reservas, resultados), se puede reabrir a mano y el saldo pasa al mes siguiente.
- **Auditoría:** antes/después de cada cambio financiero (movimientos, parámetros, cierres, reaperturas), con fecha y PC.
- **Transferencias:** al marcar "pagado" se genera el movimiento "Liquidación período" contra la cuenta elegida.

## Migración
- Se migra todo lo relevante con un modelo de datos propio, no hoja por hoja: propiedades/propietarios, saldos de arrastre, histórico de ocupación y movimientos.
- Solo está abril 2026; los demás meses llegan en unos días. El importador debe servir para cualquier mes exportado.
- **Validación:** correr en paralelo con el Excel durante 1-2 meses.

## Técnico
- **Desktop** como Roble: Electron + React/Vite + Express + SQLite (better-sqlite3). Proyecto nuevo, se copia de Roble solo lo que sirva.
- **TypeScript** en todo.
- **UI:** Ant Design.
- **Red:** servidor/terminal como Roble (HTTP + WS + mDNS en LAN), con emparejamiento de terminales.
- **Login:** ninguno.
- **Convenciones de Roble:** importes en centavos INTEGER, fechas ISO, bajas lógicas, saldos por vistas `v_*`, capa repos.
- **PDF:** `printToPDF` de Electron (patrón `HojaImpresion`).
- **Backups:** mecanismo de Roble (al cerrar, 15 copias) con carpeta de destino configurable (Drive/OneDrive).

## Pendiente
- Cambiar la contraseña de Stays: está en el historial git de `LMilanesi/balances-hornera`.
- Conseguir los demás meses del Google Sheet.
- Confirmar quién es Bibi.
- Fórmula co-host Airbnb: qué son el 0,85 y el 0,20 de `calcular_cobrado_hornera` (¿el 0,20 es la comisión del depto?).
- RIO y AND (abril 2026): en sus hojas hay −124.008 tipeado a mano en la columna de tarifa (Z14) y, en AND, la fórmula de costos invertida (`J32 = Z57`). Les cambia costos, honorarios y saldo. ¿Es un error? Si lo es, esas dos liquidaciones salieron mal.
- R64 convierte a USD con `cambio / 0,96`, y S38, MAI, ITU y COT con `cambio`. ¿El 4 % es la comisión de Payoneer? ¿Por qué solo R64?
- Comisión por plataforma: aplicar el % de `Plataformas` (Website 1,7 %) daría comisiones que el Excel no cobra (OVL tiene 0). ¿Qué plataformas generan comisión de verdad?
- Fee del channel manager: `Datos balance`!B7 dice 20 y `NO COMISIONABLES`!F dice USD 25. ¿Cuál vale?
