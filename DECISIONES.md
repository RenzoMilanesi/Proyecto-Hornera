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
- **Comisiones OTAs/agentes/CM:** en el Excel se tipean a mano por depto (hoja NO COMISIONABLES: Booking reducida, Alq. Argentina, otros agentes). En la app: fee del channel manager por depto (USD 25, columna F de NO COMISIONABLES, que es lo que se cobra; "Datos balance" B7 dice 20 y no se usa) más la comisión cargada a mano en cada reserva. El % automático por plataforma queda apagado hasta saber cuáles cobran.
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

## Liquidación del mes abierto (`server/liquidacion/servicio.ts`, pantalla "Liquidación")
- Se recalcula cada vez desde la base con el motor: reservas del período no excluidas, lo cobrado neto en Stays más los ajustes de la reserva, movimientos del período (sin los pagos de liquidación), noches bloqueadas y el saldo de arrastre.
- Saldo de arrastre = saldo final de la liquidación cerrada del mes anterior + los pagos de liquidación de ese mes. Si el período tiene "Saldo mes anterior" cargado (migración), se usa ese.
- Necesita la cotización del dólar del período (manual por ahora). Un depto entra si está activo o tiene reservas, movimientos o saldo.
- Marcha en paralelo: "Comparar con el Excel del mes" lee las hojas por depto del Excel de ese mes (sin importarlo) y muestra las diferencias. Con abril armado en la base: 22 deptos iguales; RIO y AND difieren por sus costos editados a mano.
- Ajustes de reserva (corrección ARS/USD, comisión, observación, excluir) desde la pantalla Stays, con registro en `auditoria` (también los cambios de cotización). La corrección de lo cobrado se prorratea por noches como el ingreso; la comisión cuenta una sola vez, en el mes en que llega la reserva. Los ajustes de una reserva que es parte de un mes cerrado no se cambian (hay que reabrirlo).
- Si el mes anterior encontrado no es el inmediatamente anterior, se avisa (falta cargar un mes).

## Cierre, transferencias y PDF (`server/liquidacion/cierre.ts`, `pagos.ts`, `hoja.ts`)
- **Cerrar el mes** guarda la liquidación de cada depto tal como se calculó (`liquidacion` + `liquidacion_reserva`, con los prorrateos redondeados a centavos) y congela el período. Hace falta la cotización y que el mes anterior esté cerrado.
- **Reabrir** borra ese snapshot y vuelve a calcular. No se puede si el mes siguiente está cerrado, si hay pagos de liquidación vigentes (se anulan antes) ni si el mes se importó del Excel (su liquidación es la del Excel). Cierre y reapertura quedan en la auditoría.
- **Transferencias** (pantalla): saldo de cada depto en su moneda, lo pagado y lo pendiente; "Marcar pagado" genera el movimiento "Liquidacion periodo" (tipo `liquidacion`, permitido con el mes cerrado) desde la cuenta elegida, con pagos parciales. Si el mes siguiente ya está cerrado, lo pendiente pasó a ese mes como saldo anterior y no se puede pagar desde el mes viejo (se pagaría dos veces). Exportación a Excel para el banco (CBU/CVU, "Nosotros" para el depto propio).
- **PDF por depto**: mismo contenido y orden que la hoja del Excel, generado con `printToPDF` de Electron desde una vista imprimible de la app. Se guarda en `Documentos\Hornera\Liquidaciones\<mes>\<DEPTO>.pdf` (o en `configuracion.pdf.carpeta`) y se abre. Con el mes abierto sirve de vista previa. El detalle de reservas no incluye documento ni razón social de los huéspedes.
- Los datos de la administradora del encabezado (nombre, CUIT, dirección, teléfono, mail) los toma el importador de la hoja de un depto y quedan en `configuracion` (`empresa.*`), no en el código.

## Resumen (fase 6, `server/resumen.ts`, pantalla "Resumen")
- Es la primera pantalla. Elige un mes (por defecto el último cerrado): mes cerrado sale del snapshot `liquidacion`; mes abierto, del motor (cambia hasta cerrarlo).
- **KPIs por depto:** ocupación (noches ocupadas / disponibles), reservas, bruto (ARS + USD × cambio), bruto por noche ocupada y honorarios.
- **Resultado de Hornera** = honorarios + costos operativos cobrados a los propietarios (tarifa por reserva) + ingresos, gastos y ajustes de la empresa (movimientos sin depto, INT). Sin saldos iniciales ni transferencias. Los movimientos de la empresa en USD se muestran aparte, sin convertir.
- **Saldos de cuentas:** los de hoy (`v_saldo_cuenta`), no los del mes elegido.
- **Evolución mensual:** un renglón por mes cerrado (noches, ocupación, bruto, honorarios, resultado) y, antes de usar la app, solo las noches ocupadas del histórico (hoja OCUPACION). Los meses abiertos no entran. Barras simples en CSS: sin librería de gráficos.

## Movimientos y cuentas (`server/movimientos.ts`, pantallas "Movimientos" y "Cuentas")
- Reemplazan a CORRIENTE. Cada movimiento: período, fecha, depto o empresa (INT), tipo, concepto (si no existe se da de alta), detalle, importe en ARS o USD con signo y cuenta opcional.
- Tipos: gasto, adelanto al propietario y cobro directo por plataforma van negativos; ingreso, positivo; saldo inicial y ajuste, con cualquier signo. Adelantos y cobros directos siempre son de un depto. Los pagos de liquidación los generará "marcar pagado" (fase 5c).
- Nunca se borran: se anulan. Se pueden editar mientras el período está abierto; los pagos de liquidación y las transferencias no se editan (se anulan y se cargan de nuevo). Todo queda en la auditoría.
- Transferencia entre cuentas propias: dos movimientos con el mismo `transferencia_grupo`; entre monedas distintas (compra/venta de USD) cada lado lleva su importe. Anular una pata anula las dos.
- Saldo de una cuenta (`v_saldo_cuenta`, esquema 3) = movimientos con esa cuenta + lo cobrado en Stays por los medios de pago asociados (completados, neto de comisión, menos débitos), desde la fecha de su "Saldo inicial" (lo anterior ya está incluido en ese saldo; sin saldo inicial suma todo). La moneda de una cuenta no se cambia; un medio de pago solo se asocia a una cuenta de su moneda.
- El saldo de arranque de cada cuenta se carga como movimiento "Saldo inicial" con la cuenta y sin depto.

## Stays ("traer mes", `server/stays/`)
- Reemplaza los scripts 0 a 2 de `balances-hornera`, con sus mismas reglas: reservas por llegada, por salida (corrida un día) e incluidas; entra la que tiene noches en el período o llega en él (cancelaciones de 0 noches). Reserva sin canal = "Carga Agente".
- Primero se baja todo y después se escribe en una transacción: si la red falla no queda nada a medias. Cada intento queda en `sincronizacion` (también los fallidos).
- Se puede repetir: no pisa los ajustes manuales de la reserva ni la moneda, la comisión y la cuenta de los medios de pago editados en la app. Las reservas del período que Stays ya no devuelve se borran (con aviso), salvo las que ya están en una liquidación y las que tienen datos cargados a mano (pueden haber cambiado de fecha: se avisa). Si el export viene vacío no se borra nada. La regla de qué reserva pertenece a un período está en un solo lugar: `server/periodo.ts`.
- Si el período no existe se crea con los parámetros del último y sin cotización; no se trae un período cerrado.
- Moneda del medio de pago: USD si Stays lo dice o si es PayPal/Payoneer; si no, ARS. Descuentan comisión (neto = importe − `_f_tax`): Mercado Pago, PayPal y los "Link". Se avisa cuando falta cargar la comisión en Stays.
- Pagos sin medio de pago en Stays (aparecieron al traer mayo y junio 2026 del Stays real; antes rompían "traer mes"): se traen con un medio "(sin medio)" en la moneda de la reserva (`sin-medio-ARS` / `sin-medio-USD`), con aviso; se le asocia una cuenta como a cualquier medio. Un pago sin `_id` no se puede guardar: se saltea con aviso. Si otro dato llega con una forma inesperada, el error nombra la reserva y no se escribe nada.
- Credenciales: las carga el usuario en la app y se guardan cifradas con `safeStorage` (DPAPI de Windows) en `stays.cred`, fuera de la base: no viajan en los backups. La clave nunca vuelve a la pantalla. `configuracion.stays.url` permite apuntar a otra URL, pero la clave solo se manda por https a `*.stays.net` o a un Stays de prueba en la misma PC, y sin seguir redirecciones.
- Probado contra un Stays simulado con datos ficticios en el formato real (xlsx del export, JSON de pagos y medios). **Falta probar contra el Stays real** cuando se cambie la contraseña.
- Pendiente para la fase 5: asociar cada medio de pago a una cuenta (pantalla), y calcular la liquidación del mes abierto con el motor a partir de reservas y pagos.

## Técnico
- **Desktop** como Roble: Electron + React/Vite + Express + SQLite. Proyecto nuevo, se copia de Roble solo lo que sirva.
- **SQLite con `node:sqlite`** (incluido en Node/Electron) en vez de `better-sqlite3`: sin módulo nativo ni `electron-rebuild`. Electron corre los `.ts` directo (type stripping); solo Vite compila la interfaz. `tsc` se usa únicamente para chequear tipos.
- **Una sola API HTTP** (Express) para la ventana local y para las terminales. En desarrollo Vite corre dentro del mismo Express.
- **Seguridad local:** la API solo atiende pedidos dirigidos a esta PC (contra DNS rebinding) y rechaza escrituras que el navegador marca como de otro sitio (`Sec-Fetch-Site`). La ventana no abre ventanas nuevas, no navega fuera de la app y no concede permisos. Los backups no van a carpetas de otras PCs de la red.
- **TypeScript** en todo.
- **UI:** Ant Design.
- **Red (fase 5d, `server/terminales.ts`):** la PC servidor escucha en la LAN (puerto 4310). Una terminal no tiene base: su ventana abre la app del servidor (interfaz y API son las del servidor, así que la versión de la terminal no importa).
  - **Rol:** se pregunta la primera vez (servidor o terminal) y queda en `rol.json`; una instalación que ya tiene base es servidor sin preguntar. La terminal guarda la dirección del servidor; si no responde, muestra `electron/terminal.html` para escribir otra o pasar a servidor.
  - **Emparejamiento:** en el servidor, Terminales → "Generar código" (6 dígitos, 10 min, una vez; a los 5 errores se invalida). La terminal lo escribe y recibe un token en una cookie HttpOnly; la base guarda solo su hash (tabla `terminal`, esquema 4). Desde otra PC, sin token la API responde 401. Se revoca desde Terminales.
  - **Solo en el servidor:** administrar terminales y cargar la clave de Stays (no viaja por la LAN en HTTP sin cifrar). Los PDF se generan en el servidor y no se abren si los pidió una terminal (se avisa la carpeta).
  - La auditoría registra el nombre de la terminal que hizo el cambio.
  - **Sin mDNS ni WebSocket (a diferencia de Roble):** la terminal llama al servidor por el nombre del equipo, que Windows resuelve en la LAN y no cambia con DHCP; cada pantalla recarga sus datos al abrirse. mDNS si el nombre no resuelve en la red de la oficina; WS si hace falta ver en vivo lo que carga la otra PC.
- **Login:** ninguno.
- **Convenciones de Roble:** importes en centavos INTEGER, fechas ISO, bajas lógicas, saldos por vistas `v_*`. La "capa repos" de Roble no se adoptó: el SQL vive junto a cada módulo (`server/app.ts`, `server/importador/`, `server/stays/`).
- **Instalador** (`npm run dist`): electron-builder con NSIS, como Roble. Lista explícita de archivos en `package.json` ("build.files"): solo `electron/`, `server/` sin tests, `dist/`, `schema.sql` y las dependencias de producción (express, xlsx); React y Ant Design van compilados en `dist/`. Nunca entra `Archivos Originales/`. Sin firma de código (Windows avisa "protegió su PC") ni ícono propio. Los datos quedan en `%APPDATA%\Hornera`, fuera de la carpeta de instalación: reinstalar o actualizar no los toca.
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
- Fee del channel manager: se aplica USD 25 (lo que cobra el Excel en K33). Confirmar que B7 = 20 no se usa.
- AND no figura en NO COMISIONABLES: en abril el Excel no le cobró el fee del channel manager y la app sí. ¿Corresponde?
- Resultado de Hornera (pantalla Resumen): ¿es honorarios + costos operativos cobrados + gastos e ingresos de la empresa (INT)? ¿Los costos operativos son ingreso de Hornera (y la limpieza se paga como gasto INT)?
- Mes sin reservas: con la fórmula del Excel, la base de honorarios queda negativa (solo el fee) y los honorarios dan positivos (se le devuelve plata al propietario). La app lo reproduce. ¿Es lo correcto o los honorarios deberían ser 0?
