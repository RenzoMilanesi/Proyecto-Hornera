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
- **Motor de liquidación:** `server/liquidacion/motor.ts`, función pura. Reproduce las 24 hojas de abril 2026 al centavo, salvo RIO y AND, que tienen costos editados a mano en el Excel. La regresión (`server/liquidacion/regresion.test.ts`) arma la entrada del motor con lo que guarda el importador, que es el camino de la fase 5.
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
- **Importador** (`server/importador/excel.ts`, pantalla "Importar Excel"), validado con abril 2026:
  - Maestros (propietarios, deptos, plataformas, cuentas, conceptos): alta o actualización; el Excel manda hasta que lo reemplace la app. Un propietario se identifica por el nombre del "Facturante". Solo un mes posterior al último mes cerrado actualiza maestros e histórico; uno anterior solo agrega lo que falte. La moneda de liquidación del propietario sale solo de las hojas de depto (un depto sin hoja no la define).
  - El mes del export entra **cerrado**, con sus movimientos de CORRIENTE y un snapshot de la liquidación de cada depto tomado de su hoja (no recalculado). El saldo de arrastre del mes siguiente sale de ese snapshot. Un mes ya cerrado no se vuelve a importar. Si el mes está abierto porque se trajo de Stays y no tiene movimientos cargados, el Excel se importa encima y lo cierra; si tiene movimientos, se rechaza.
  - Los movimientos entran **sin cuenta**: el Excel no registra de qué cuenta sale cada uno. Los saldos iniciales de las cuentas se cargan al empezar a usar la app.
  - Histórico: solo noches ocupadas por mes (hoja OCUPACION, 12/2021 a 10/2024; después no se actualizó). La hoja Resumen no tiene histórico real.
  - No se importa: deptos sin facturante (JAI, SAR), la columna "FONDO / ACUMULADO" de CORRIENTE (fondo de reserva de CNG), la hoja NO COMISIONABLES ni las reservas (vienen de Stays, fase 4).
  - Lectura del xlsx con SheetJS 0.20.3 desde su CDN (la de npm, 0.18.5, tiene vulnerabilidades conocidas). También sirve para exportar la lista de transferencias (fase 5).
- **Esquema 2:** la liquidación guarda saldo final y cambio de moneda en ARS y USD (5 propietarios liquidan en USD). Las bases del esquema 1 se migran solas al abrir (`server/db.ts`).

## Stays ("traer mes", `server/stays/`)
- Reemplaza los scripts 0 a 2 de `balances-hornera`, con sus mismas reglas: reservas por llegada, por salida (corrida un día) e incluidas; entra la que tiene noches en el período o llega en él (cancelaciones de 0 noches). Reserva sin canal = "Carga Agente".
- Primero se baja todo y después se escribe en una transacción: si la red falla no queda nada a medias. Cada intento queda en `sincronizacion` (también los fallidos).
- Se puede repetir: no pisa los ajustes manuales de la reserva ni la moneda, la comisión y la cuenta de los medios de pago editados en la app. Las reservas del período que Stays ya no devuelve se borran (con aviso), salvo las que ya están en una liquidación y las que tienen datos cargados a mano (pueden haber cambiado de fecha: se avisa). Si el export viene vacío no se borra nada. La regla de qué reserva pertenece a un período está en un solo lugar: `server/periodo.ts`.
- Si el período no existe se crea con los parámetros del último y sin cotización; no se trae un período cerrado.
- Moneda del medio de pago: USD si Stays lo dice o si es PayPal/Payoneer; si no, ARS. Descuentan comisión (neto = importe − `_f_tax`): Mercado Pago, PayPal y los "Link". Se avisa cuando falta cargar la comisión en Stays.
- Credenciales: las carga el usuario en la app y se guardan cifradas con `safeStorage` (DPAPI de Windows) en `stays.cred`, fuera de la base: no viajan en los backups. La clave nunca vuelve a la pantalla. `configuracion.stays.url` permite apuntar a otra URL, pero la clave solo se manda por https a `*.stays.net` o a un Stays de prueba en la misma PC, y sin seguir redirecciones.
- Probado contra un Stays simulado con datos ficticios en el formato real (xlsx del export, JSON de pagos y medios). **Falta probar contra el Stays real** cuando se cambie la contraseña.
- Pendiente para la fase 5: asociar cada medio de pago a una cuenta (pantalla), y calcular la liquidación del mes abierto con el motor a partir de reservas y pagos.

## Técnico
- **Desktop** como Roble: Electron + React/Vite + Express + SQLite. Proyecto nuevo, se copia de Roble solo lo que sirva.
- **SQLite con `node:sqlite`** (incluido en Node/Electron) en vez de `better-sqlite3`: sin módulo nativo ni `electron-rebuild`. Electron corre los `.ts` directo (type stripping); solo Vite compila la interfaz. `tsc` se usa únicamente para chequear tipos.
- **Una sola API HTTP** (Express) para la ventana local y, en la fase 5, para las terminales. En desarrollo Vite corre dentro del mismo Express.
- **Seguridad local:** la API solo atiende pedidos dirigidos a esta PC (contra DNS rebinding) y rechaza escrituras que el navegador marca como de otro sitio (`Sec-Fetch-Site`). La ventana no abre ventanas nuevas, no navega fuera de la app y no concede permisos. Los backups no van a carpetas de otras PCs de la red.
- **TypeScript** en todo.
- **UI:** Ant Design.
- **Red:** servidor/terminal como Roble (HTTP + WS + mDNS en LAN), con emparejamiento de terminales.
- **Login:** ninguno.
- **Convenciones de Roble:** importes en centavos INTEGER, fechas ISO, bajas lógicas, saldos por vistas `v_*`. La "capa repos" de Roble no se adoptó: el SQL vive junto a cada módulo (`server/app.ts`, `server/importador/`, `server/stays/`).
- **PDF:** `printToPDF` de Electron (patrón `HojaImpresion`).
- **Backups:** como Roble pero al cerrar, al apagar Windows y cada 6 h con la app abierta; se conservan 60 copias (unas 2 semanas en el peor caso), con `VACUUM INTO`, con carpeta de destino configurable (Drive/OneDrive) en `configuracion.backup.carpeta`.

## Pendiente
- Cambiar la contraseña de Stays: está en el historial git de `LMilanesi/balances-hornera`.
- Conseguir los demás meses del Google Sheet.
- Confirmar quién es Bibi.
- Fórmula co-host Airbnb: qué son el 0,85 y el 0,20 de `calcular_cobrado_hornera` (¿el 0,20 es la comisión del depto?).
- RIO y AND (abril 2026): en sus hojas hay −124.008 tipeado a mano en la columna de tarifa (Z14) y, en AND, la fórmula de costos invertida (`J32 = Z57`). Les cambia costos, honorarios y saldo. ¿Es un error? Si lo es, esas dos liquidaciones salieron mal.
- R64 convierte a USD con `cambio / 0,96`, y S38, MAI, ITU y COT con `cambio`. ¿El 4 % es la comisión de Payoneer? ¿Por qué solo R64?
- Comisión por plataforma: aplicar el % de `Plataformas` (Website 1,7 %) daría comisiones que el Excel no cobra (OVL tiene 0). ¿Qué plataformas generan comisión de verdad?
- Fee del channel manager: `Datos balance`!B7 dice 20 y `NO COMISIONABLES`!F dice USD 25. ¿Cuál vale?
