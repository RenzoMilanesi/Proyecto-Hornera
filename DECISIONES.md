# Decisiones — Proyecto Hornera

Grill-me del 2026-10-11 (reinicio desde cero). Fuentes: `Archivos Originales/`.

## Alcance v1
- **Objetivo:** automatizar la liquidación mensual a propietarios. Reemplaza los scripts `balances-hornera` y las hojas `Datos balance`, `RESERVAS`, `CORRIENTE`, `NO COMISIONABLES`, `Cont Interna` y las hojas por depto.
- **Usuarios:** solo los dueños (Lautaro y Amancay). Sin roles.
- **Salidas:** PDF por depto (mismo contenido y orden que la hoja actual), lista de transferencias (pantalla + Excel) y resumen interno.
- **Prioridad:** 1) liquidación (ingesta, movimientos, cuentas, cierre, PDF, transferencias). 2) Resumen: KPIs por depto, resultado de Hornera, saldos de cuentas, evolución histórica.
- **Fuera de la v1:** envío de mails, Mantenimiento, Obligaciones, Checklist, Hospy (se ignora).
- **Facturación ARCA** (entra al alcance, grill-me del 2026-10-16, plan 031): se facturan los honorarios de Hornera al propietario, una factura por **pago** de la liquidación de un depto (proporcional al pago, importe editable, avisa si supera los honorarios; saldo ≤ 0 no se factura). Dos emisores monotributistas (Lautaro y Amancay, Factura C; soporta RI), elegido en cada factura. Siempre en pesos. Datos fiscales del receptor en la ficha del propietario, con consulta al padrón. Certificados generados con openssl; la clave privada cifrada con safeStorage, fuera de la base. PDF suelto y dentro del PDF del depto. Anular un pago facturado ofrece la Nota de Crédito. WSFEv1 directo, portado de Roble.

## Datos y reglas
- **Stays:** API directa con un botón "traer mes" (reservas + pagos por reserva + medios de pago).
- **Movimientos:** formulario completo que reemplaza `CORRIENTE`. Cada movimiento lleva depto (o INT), fecha, concepto, ARS/USD y **cuenta**; el sistema calcula el saldo de cada cuenta.
- **Medios de pago de Stays → cuenta de la empresa:** tabla de mapeo (p. ej. "Mercado Pago Lau" → Mercadopago L).
- **Moneda:** igual que el Excel. Bruto = ARS + USD × cambio; honorarios y costos en ARS. Al cierre, el saldo se convierte a la **moneda de liquidación del propietario**: ARS (USD × cambio, la mayoría) o USD (ARS ÷ cambio, con un recargo opcional, p. ej. 4 % en R64). Se descubrió al reproducir abril: 5 deptos cierran en USD.
- **Motor de liquidación:** `server/liquidacion/motor.ts`, función pura. Reproduce las 24 hojas de abril 2026 al centavo, salvo RIO y AND, que tienen costos editados a mano en el Excel. La regresión (`server/liquidacion/regresion.test.ts`) arma la entrada del motor con lo que guarda el importador, que es el camino de la fase 5.
- **Tipo de cambio:** dólar cripto (venta) del último día del período, menos el % configurable (hoy 6 %). Se trae solo con "traer mes" (ArgentinaDatos para el día de cierre; DolarApi para la de hoy). Con el mes en curso queda la de hoy como **provisoria** y se reemplaza en el próximo "traer mes"; se puede cerrar con una provisoria, con advertencia. Una cotización cargada a mano manda: "traer mes" no la pisa (avisa) y "Pedir a la API" en Liquidación la reemplaza. Si la API falla, Stays se trae igual y se avisa.
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
- Necesita la cotización del dólar del período (de la API o manual). Un depto entra si está activo o tiene reservas, movimientos o saldo.
- Marcha en paralelo: "Comparar con el Excel del mes" lee las hojas por depto del Excel de ese mes (sin importarlo) y muestra las diferencias. Con abril armado en la base: 22 deptos iguales; RIO y AND difieren por sus costos editados a mano.
- Ajustes de reserva (corrección ARS/USD, comisión, observación, excluir) desde la pantalla Stays, con registro en `auditoria` (también los cambios de cotización). La corrección de lo cobrado se prorratea por noches como el ingreso; la comisión cuenta una sola vez, en el mes en que llega la reserva. Los ajustes de una reserva que es parte de un mes cerrado no se cambian (hay que reabrirlo).
- Si el mes anterior encontrado no es el inmediatamente anterior, se avisa (falta cargar un mes).

## Cierre, transferencias y PDF (`server/liquidacion/cierre.ts`, `pagos.ts`, `hoja.ts`)
- **Cerrar el mes** guarda la liquidación de cada depto tal como se calculó (`liquidacion` + `liquidacion_reserva`, con los prorrateos redondeados a centavos) y congela el período. Hace falta la cotización y que el mes anterior esté cerrado.
- **Reabrir** borra ese snapshot y vuelve a calcular. No se puede si el mes siguiente está cerrado, si hay pagos de liquidación vigentes (se anulan antes) ni si el mes se importó del Excel (su liquidación es la del Excel). Cierre y reapertura quedan en la auditoría.
- **Transferencias** (pantalla): saldo de cada depto en su moneda, lo pagado y lo pendiente; "Marcar pagado" genera el movimiento "Liquidacion periodo" (tipo `liquidacion`, permitido con el mes cerrado) desde la cuenta elegida, con pagos parciales. Si el mes siguiente ya está cerrado, lo pendiente pasó a ese mes como saldo anterior y no se puede pagar desde el mes viejo (se pagaría dos veces). Exportación a Excel para el banco (CBU/CVU, "Nosotros" para el depto propio).
- **Dueño de cada liquidación**: al cerrar (o importar) se guarda quién era el propietario del depto (`liquidacion.propietario_id`); Transferencias y el historial usan ese, no el actual. Las liquidaciones anteriores al esquema 8 tomaron el dueño que tenía el depto al migrar. El PDF (`hoja.ts`) sigue mostrando el dueño actual.
- **Historial** (pantalla, y panel desde Deptos y Propietarios): una fila por mes y depto con saldo, pagado, pendiente y estado (pagado, parcial, pendiente, debe, pasó al mes siguiente, en curso). Solo meses de la app (no el histórico del Excel); el mes abierto aparece "en curso" con el saldo estimado. Pagos anulados ocultos salvo "Ver anulados" (no suman). Desde ahí también se marca pagado y se anula. Sin exportación por ahora.
- **Saldado por fuera** (2026-10-21): las deudas de antes de la app que en la realidad ya se resolvieron se marcan en la liquidación (`liquidacion.saldado_fuera`, fecha y nota) en vez de registrar un pago: no quedan pendientes ni se arrastran al mes siguiente, pero no hay movimiento, no se mueve ninguna cuenta ni se ofrece facturar. Se eligió sobre un "pago sin cuenta" para que no aparezca en Movimientos ni en lo pendiente de facturar. Solo mientras el mes siguiente esté abierto (después la deuda ya es parte de ese mes); un mes con marcas no se reabre hasta desmarcarlas. Carga inicial: "Saldar por fuera hasta" un mes marca todo lo pendiente de los meses cerrados hasta ese.
- **PDF por depto**: mismo contenido y orden que la hoja del Excel, generado con `printToPDF` de Electron desde una vista imprimible de la app. Se guarda en `Documentos\Hornera\Liquidaciones\<mes>\<DEPTO>.pdf` (o en `configuracion.pdf.carpeta`) y se abre. Con el mes abierto sirve de vista previa. El detalle de reservas no incluye documento ni razón social de los huéspedes.
- Los datos de la administradora del encabezado (nombre, CUIT, dirección, teléfono, mail) los toma el importador de la hoja de un depto y quedan en `configuracion` (`empresa.*`), no en el código.

## Resumen (fase 6, `server/resumen.ts`, pantalla "Resumen")
- Es la primera pantalla. Elige un mes (por defecto el último cerrado): mes cerrado sale del snapshot `liquidacion`; mes abierto, del motor (cambia hasta cerrarlo).
- **KPIs por depto (glosario de Amancay, 2026-10-23):** las estadías del propietario no son noches vendidas ni a la venta. Noches a la venta = del mes − bloqueos − propietario; vendidas = ocupadas − propietario. **Ocupación** = vendidas / a la venta. **ADR** = alojamiento / vendidas, donde alojamiento = lo que pagaron los huéspedes por las noches sin la tarifa por estadía (AirDNA la incluye; acá no, porque no es del propietario). **RevPAR** = alojamiento / a la venta (= ADR × ocupación), el número para comparar deptos; la cartera muestra la mediana por depto. **Neto por noche** = valor liquidación inicial / vendidas. **Honorario efectivo** = honorarios / bruto. Un mes importado del Excel no tiene detalle de reservas: su alojamiento es bruto − costos operativos (incluye al propietario). El alojamiento parte de lo cobrado **neto** (como la liquidación): en los cobros por Mercado Pago o PayPal ya viene sin la comisión del medio de pago, así que el ADR de esas reservas queda apenas por debajo de lo que pagó el huésped. Se acepta: la diferencia es chica y así coincide con la liquidación.
- **Elasticidad (indicativa, pedida igual sabiendo sus límites, 2026-10-23):** por depto, de arco entre el mes y el mismo mes del año anterior (si no hay, el mes anterior): (Δocupación / promedio) ÷ (ΔADR / promedio). Quedan afuera los deptos cuyo ADR cambió menos de 5 %. La cartera muestra la mediana. Confianza "muy baja" con el mes anterior o menos de 5 deptos; "baja" en el mejor caso: con datos observados el precio sube cuando hay más demanda, y eso no se separa. La pantalla siempre lo avisa. Con las fotos del calendario (plan 050) y pruebas de precio se podrá medir mejor.
- **Nombres:** "Base de honorarios" = ingresos operativos − costos (lo que el glosario llamaba "saldo parcial"; antes "Ingreso bruto"). "Valor liquidación inicial" = base − honorarios. "Margen" es (precio − costo) / precio; (precio − costo) / costo es recargo.
- Quedan afuera del sistema: costo operativo real por reserva y márgenes de Hornera (falta clasificar los gastos de la empresa), lead time (falta la fecha de creación de la reserva), cap rate (falta el valor de la propiedad) y elasticidad (no se puede medir con estos datos).
- **Resultado de Hornera** = honorarios + costos operativos cobrados a los propietarios (tarifa por reserva) + ingresos, gastos y ajustes de la empresa (movimientos sin depto, INT). Sin saldos iniciales ni transferencias. Los movimientos de la empresa en USD se muestran aparte, sin convertir.
- **Saldos de cuentas:** los de hoy (`v_saldo_cuenta`), no los del mes elegido.
- **Evolución mensual:** un renglón por mes cerrado (noches, ocupación, ADR, RevPAR, bruto, honorarios, resultado) y, antes de usar la app, solo las noches ocupadas del histórico (hoja OCUPACION). Los meses abiertos no entran. Barras simples en CSS: sin librería de gráficos.

## Movimientos y cuentas (`server/movimientos.ts`, pantallas "Movimientos" y "Cuentas")
- Reemplazan a CORRIENTE. Cada movimiento: período, fecha, depto o empresa (INT), tipo, concepto (si no existe se da de alta), detalle, importe en ARS o USD con signo y cuenta opcional.
- Tipos: gasto, adelanto al propietario y cobro directo por plataforma van negativos; ingreso, positivo; saldo inicial y ajuste, con cualquier signo. Adelantos y cobros directos siempre son de un depto. Los pagos de liquidación los generará "marcar pagado" (fase 5c).
- Nunca se borran: se anulan. Se pueden editar mientras el período está abierto; los pagos de liquidación y las transferencias no se editan (se anulan y se cargan de nuevo). Todo queda en la auditoría.
- Transferencia entre cuentas propias: dos movimientos con el mismo `transferencia_grupo`; entre monedas distintas (compra/venta de USD) cada lado lleva su importe. Anular una pata anula las dos.
- Saldo de una cuenta (`v_saldo_cuenta`, esquema 3) = movimientos con esa cuenta + lo cobrado en Stays por los medios de pago asociados (completados, neto de comisión, menos débitos), desde la fecha de su "Saldo inicial" (lo anterior ya está incluido en ese saldo; sin saldo inicial suma todo). La moneda de una cuenta no se cambia; un medio de pago solo se asocia a una cuenta de su moneda.
- El saldo de arranque de cada cuenta se carga como movimiento "Saldo inicial" con la cuenta y sin depto.
- Gastos ajenos (plan 047, pantalla "Gastos personales"): lo del Excel de gastos varios con código CAY, LAU, CAY/LAU, CASEST (o CASAEST) y CASA va a la tabla `gasto_ajeno`, aparte de `movimiento`: nunca toca liquidaciones, cuentas ni el resultado. Se editan y se anulan con el mes abierto. Los compartidos (CAY/LAU) se parten mitad y mitad sobre el total del mes; el centavo impar, a Amancay. BBVA es un error de carga (aviso).

## Stays ("traer mes", `server/stays/`)
- Reemplaza los scripts 0 a 2 de `balances-hornera`, con sus mismas reglas: reservas por llegada, por salida (corrida un día) e incluidas; entra la que tiene noches en el período o llega en él (cancelaciones de 0 noches). Reserva sin canal = "Carga Agente".
- Primero se baja todo y después se escribe en una transacción: si la red falla no queda nada a medias. Cada intento queda en `sincronizacion` (también los fallidos).
- Se puede repetir: no pisa los ajustes manuales de la reserva ni la moneda, la comisión y la cuenta de los medios de pago editados en la app. Las reservas del período que Stays ya no devuelve se borran (con aviso), salvo las que ya están en una liquidación y las que tienen datos cargados a mano (pueden haber cambiado de fecha: se avisa). Si el export viene vacío no se borra nada. La regla de qué reserva pertenece a un período está en un solo lugar: `server/periodo.ts`.
- Si el período no existe se crea con los parámetros del último y sin cotización; no se trae un período cerrado.
- Moneda del medio de pago: USD si Stays lo dice o si es PayPal/Payoneer; si no, ARS. Descuentan comisión (neto = importe − `_f_tax`): Mercado Pago, PayPal y los "Link". Se avisa cuando falta cargar la comisión en Stays.
- Pagos sin medio de pago en Stays (aparecieron al traer mayo y junio 2026 del Stays real; antes rompían "traer mes"): se traen con un medio "(sin medio)" en la moneda de la reserva (`sin-medio-ARS` / `sin-medio-USD`), con aviso; se le asocia una cuenta como a cualquier medio. Un pago sin `_id` no se puede guardar: se saltea con aviso. Si otro dato llega con una forma inesperada, el error nombra la reserva y no se escribe nada.
- Montos sospechosos (la moneda del pago sale del medio, Stays no la informa): se avisa cuando un pago tiene el mismo importe que el total de la reserva pero el medio es de la otra moneda, y cuando un pago en dólares supera USD 10.000. Caso real: OO01J (CAF, septiembre 2026), USD 670 por PayPal cargados en Stays como 1.000.000 → bruto de CAF de $ 1.364 millones.
- Alojamientos (`/content/listings`, de a 20): se avisa el alojamiento activo en Stays que no es un depto de la app y el depto `activo` en la app que en Stays no está activo o no existe (los pausados o finalizados no se comparan). La dirección (calle, número y piso/depto de `address.additional`) se completa desde Stays solo si en la app está vacía. Las fotos (`depto.fotos`, JSON de URLs, la principal primero) son de Stays: se reemplazan en cada "traer mes", solo https porque la pantalla Deptos las muestra; la app guarda las URLs, no las imágenes, así que verlas necesita internet. Si Stays no deja leerlos, el mes se trae igual con aviso. Sin probar todavía contra el Stays real.
- Propietarios (`/finance/owners`, rango del período): Stays solo informa nombre y deptos, así que de ahí no se carga ningún dato. Se usa para controlar quién es el dueño de cada depto. No se comparan nombres, porque se escriben distinto de cada lado: la primera vez que todos los deptos de un propietario de Stays son de un mismo propietario de la app, quedan vinculados por `propietario.stays_owner_id`. Desde ahí se avisa cuando un depto aparece en Stays con otro dueño, o cuando un propietario de Stays tiene deptos de varios propietarios de la app. Solo se avisan diferencias: un depto sin dueño en Stays no genera aviso, porque la lista podría venir filtrada por el rango. El vínculo no se edita en pantalla. Los saldos y movimientos de `/finance/owners/{id}` no se usan, porque la liquidación se hace en la app.
- Canceladas (grill-me del 2026-10-14): "traer mes" las pide aparte (el export con `type=canceled`, con las mismas tres consultas y la misma regla de período) y las guarda con `reserva.cancelada = 1`, sin pagos. Se ven en la lista de reservas del mes en gris y con etiqueta, pero no liquidan ni suman en los KPIs. Si una reserva que ya estaba en la app se cancela en Stays, no se borra: pasa a cancelada y pierde sus pagos. Si tenía ajustes, quedan guardados (sirven si se reactiva) y se avisa. Si ya es parte de una liquidación cerrada no se toca. Las canceladas con depto o canal desconocido no generan aviso.
- Horario de check-in/check-out y desglose de precio: se guardan del detalle de cada reserva (`GET /booking/reservations/{id}`, un pedido por reserva, 4 en paralelo) y son solo informativos. La liquidación sigue con las columnas del XLSX. El desglose (`price` de Stays, tal cual) se abre al expandir la reserva. Si el detalle falla, la reserva se trae igual, conserva el horario y el desglose anteriores, y queda un solo aviso con las reservas afectadas.
- Revisión de la API de Stays, ventana por ventana (2026-10-14). Se evaluó y por ahora se descartó:
  - Cuentas: los medios de pago traen `bankDetails`, textos para el huésped, `allowPayments`, `_mcstartBalance` y `_iduser`, pero no el saldo ni los movimientos. No suma nada a las cuentas de la app. No hay endpoint de usuarios, así que no se puede nombrar los medios de efectivo.
  - Liquidación y Movimientos: los saldos y movimientos de `/finance/owners/{id}` no se usan, porque se liquida en la app y los gastos no se cargan en Stays.
  - Resumen: el calendario (`/calendar/listing/{id}`, un pedido por depto) trae disponibilidad diaria, precio por noche y estadía mínima. Serviría para la ocupación a futuro (que también sale de las reservas de los meses siguientes) y para la tarifa vigente.
  - Transferencias, Importar y Terminales: no tienen nada en la API.
  - También quedan afuera los servicios extra de las reservas (solo sirven si venden extras por Stays; no está confirmado), los datos de los huéspedes y los webhooks (necesitan una URL pública).
- Export en JSON (`POST /reservations-export`), evaluado y descartado por ahora: según la documentación, `fee`/`ownerFee` traen importes sin nombre y no figuran canal, código OTA, estado ni documento del huésped, que la sync sí usa del XLSX. Revisar con una respuesta real antes de reconsiderarlo.
- Credenciales: las carga el usuario en la app y se guardan cifradas con `safeStorage` (DPAPI de Windows) en `stays.cred`, fuera de la base: no viajan en los backups. La clave nunca vuelve a la pantalla. `configuracion.stays.url` permite apuntar a otra URL, pero la clave solo se manda por https a `*.stays.net` o a un Stays de prueba en la misma PC, y sin seguir redirecciones.
- Probado contra un Stays simulado con datos ficticios en el formato real (xlsx del export, JSON de pagos y medios). **Falta probar contra el Stays real** cuando se cambie la contraseña.
- Cada medio de pago se asocia a su cuenta en la pantalla Cuentas; la liquidación del mes abierto la calcula el motor desde reservas y pagos (fase 5).

## Ficha del depto y vencimientos (`server/ficha.ts`, Deptos → Ficha y pantalla "Vencimientos")
- **Ficha del depto (2026-10-22, con Lautaro):** servicios e impuestos con su vencimiento (día + cada cuántos meses +
  un mes en que vence), claves, contactos y notas. Un vencimiento se da por pagado solo, con un gasto vigente del depto
  y el mismo concepto en el mes: no hay tilde manual. Solo avisan los que paga Hornera.
- **Claves de los deptos en texto en la base:** viajan en los backups (y a Drive si la carpeta de copias está ahí); a
  cambio, si la PC se rompe se recuperan. Todas las PCs las ven y editan. La auditoría no guarda el valor. Sin adjuntos
  por ahora (engordarían las 60 copias).

## Limpieza (`server/limpieza.ts`, `server/importador/limpieza.ts`, pantalla "Limpieza"; plan 057)
- **Objetivo (2026-10-23):** centralizar los gastos de Hornera. Las horas las siguen cargando las chicas en el Google
  Form (hoja "Horas Cargadas" del Excel "HORAS LIMPIEZA"); la app lo importa. Las liquidaciones se hacen en la app.
- **Se le paga todo a la coordinadora**, que reparte; la app muestra horas y plata de cada chica. Total del período =
  suma de lo de cada chica (redondeado por chica) + un ajuste opcional con nota, que no se reparte.
- **Control interno:** el pago es un gasto de la empresa (concepto Limpieza) en el mes de la fecha de pago; no toca las
  liquidaciones de los deptos. Anular ese movimiento deja la liquidación pendiente otra vez.
- **Desde el 10/09/2026**, sin historial (el período anterior ya estaba cargado a mano). Los períodos son de fechas
  libres y no se pisan. Los dos primeros (10/09–22/09 y 23/09–07/10) se cargan con lo que se pagó de verdad: la
  diferencia por horas INT duplicadas va como ajuste.
- **Plus por tipo de tarea**, editable: horas (se pagan al precio del período) o pesos fijos por tarea. Al inicio:
  Check-In +1 h, Cambio Blanqueria +1 h, Check-Out +0,5 h. Cada liquidación copia las reglas al crearse.
- **Importación:** tipo vacío = Limpieza; `COTI` = `COT`, `MAIPU` = `MAPU`; `INT` = la empresa. Filas idénticas
  son duplicados (se cuentan una vez, con aviso). El Form no tiene id por fila: cada importación reemplaza las tareas que
  no están en un período pagado; lo pagado queda como se pagó y, si el Excel cambió, avisa.
- Las horas por chica, depto y mes son solo información.

## Asistente con IA (`server/ia/`, panel "Asistente con IA"; plan 061, 2026-10-23)
- **Fase 1, solo lectura:** contesta sobre datos, uso de la app (el manual por capítulos, a pedido: en las instrucciones va solo el índice; plan 066) y análisis. Ninguna herramienta escribe; las acciones (cargar, facturar) son una fase 2 aparte, con confirmación.
- **Solo Claude**, con una API key del negocio (console.anthropic.com, no Claude Pro), cifrada con safeStorage en la PC servidor y fuera de los backups. El tope de gasto se pone en la consola de Anthropic; la app no tiene tope propio. Modelo y esfuerzo se eligen en Herramientas → Asistente (arranca Sonnet 5.5, medio).
- **Corre en la PC servidor:** las terminales preguntan por la API. La key y el modelo solo se tocan en el servidor. El historial es por PC (como la auditoría: sin login).
- **Privacidad:** salen a Anthropic todos los datos del negocio que la IA consulte, **incluidas las claves de los deptos** (decisión del usuario). Nunca salen las tablas `terminal` y `configuracion` (tokens, ticket de ARCA): `consulta_sql` las bloquea con el authorizer de SQLite.
- **Números verificables:** 20 herramientas que reusan las funciones del programa + `consulta_sql` (conexión de solo lectura, solo SELECT, 200 filas, 5 s, en un proceso aparte que se mata si se pasa). Al pie de cada respuesta, modelo, consultas, costo y qué consultó.

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
- **Login:** ninguno. El usuario de la auditoría es la PC: Lautaro y Amancay usan una PC cada uno, el servidor con el nombre que se le pone en Terminales y la terminal con el de su emparejamiento (2026-10-21).
- **Convenciones de Roble:** importes en centavos INTEGER, fechas ISO, bajas lógicas, saldos por vistas `v_*`. La "capa repos" de Roble no se adoptó: el SQL vive junto a cada módulo (`server/app.ts`, `server/importador/`, `server/stays/`).
- **Instalador** (`npm run dist`): electron-builder con NSIS, como Roble. Lista explícita de archivos en `package.json` ("build.files"): solo `electron/`, `server/` sin tests, `dist/`, `schema.sql` y las dependencias de producción (express, xlsx, node-forge, qrcode); React y Ant Design van compilados en `dist/`. Nunca entra `Archivos Originales/`. Sin firma de código (Windows avisa "protegió su PC") ni ícono propio. Los datos quedan en `%APPDATA%\Hornera`, fuera de la carpeta de instalación: reinstalar o actualizar no los toca.
- **PDF:** `printToPDF` de Electron (patrón `HojaImpresion`).
- **Backups:** como Roble pero al cerrar, al apagar Windows y cada 6 h con la app abierta; se conservan 60 copias (unas 2 semanas en el peor caso), con `VACUUM INTO`, con carpeta de destino configurable (Drive/OneDrive) en `configuracion.backup.carpeta`.

## Pendiente
Preguntas para los dueños, para más adelante:
- Comisión por plataforma: aplicar el % de `Plataformas` (Website 1,7 %) daría comisiones que el Excel no cobra (OVL tiene 0). ¿Qué plataformas generan comisión de verdad?
- Mes sin reservas: con la fórmula del Excel, la base de honorarios queda negativa (solo el fee) y los honorarios dan positivos (se le devuelve plata al propietario). La app lo reproduce. ¿Es lo correcto o los honorarios deberían ser 0?
- Bloqueos desde Stays (para que "traer mes" los cargue solo y la ocupación no salga inflada): cuando el propietario usa su propio depto, ¿en Stays se carga como bloqueo, como mantenimiento o como reserva? ¿Y los bloqueos por arreglos? La liquidación separa las noches del propietario de las no disponibles.

Respondidas (2026-10-20):
- AND paga el fee del channel manager aunque en abril el Excel no se lo cobró: la app está bien.
- Fórmula co-host Airbnb (`calcular_cobrado_hornera`): el 0,20 es la comisión del depto; al implementarla, usar la del depto y no un 0,20 fijo. El 0,85 no se confirmó.
- Bibi facturaba a mano en ARCA; con la facturación desde la app (plan 031) deja de hacerlo.
