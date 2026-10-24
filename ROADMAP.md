# Roadmap — Hornera

Versión `1.0.0` = reemplaza al Excel en producción, después de correr 1-2 meses en paralelo.

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Decisiones (`DECISIONES.md`), modelo de datos (`schema.sql`), versionado | Testeado |
| 1 | Motor de liquidación con test contra abril 2026 (`server/liquidacion/`) | Testeado |
| 2 | Scaffold Electron + React/Vite + Express + SQLite (TS, Ant Design), backups → `0.1.0` | Testeado |
| 3 | Importador del Excel (maestros, saldos, movimientos, histórico) | Testeado |
| 4 | Sync con Stays: reservas, pagos y medios de pago ("traer mes") | Testeado |
| 5a | Liquidación del mes abierto desde la base (motor), cotización, ajustes de reserva y comparación con el Excel del mes | Testeado |
| 5b | Movimientos (reemplaza CORRIENTE) y cuentas: carga, medios de pago → cuenta, saldos | Testeado |
| 5c | Cierre y reapertura del mes (snapshot), transferencias (pantalla + Excel) y PDF por depto | Testeado |
| 5d | Modo servidor/terminal en la LAN, con emparejamiento | A testear |
| 6 | Resumen: KPIs, resultado Hornera, saldos de cuentas, histórico | Testeado |
| — | Instalador de Windows (`npm run dist`) y guía de prueba (`GUIA-PRUEBAS.md`) | Testeado |
| — | Variables operativas: las del mes (Liquidación) y las de cada depto (Deptos) | Testeado |
| — | Facturación ARCA de los honorarios al pagar ([plan 031](plans/031-facturacion-arca.md)); borrar emisores sin comprobantes (v0.26.0); lo facturado por fuera, importado de Mis Comprobantes ([plan 036](plans/036-mis-comprobantes-arca.md), v0.27.0) | Testeado |
| — | Manual de usuario en PDF con capturas (`manual/`, datos ficticios), dentro del instalador y abierto desde el menú | Testeado |
| — | Fuera de la v1: mails, mantenimiento, obligaciones, checklist | — |

Todo lo construido (fases 0 a 6, instalador, y alojamientos, fotos, propietarios, canceladas, horarios y desglose de Stays, tema visual "Ladrillo", buscadores y filtros en todas las pantallas, historial de pagos por depto y propietario, cotización del dólar desde la API, variables operativas editables, gastos varios importados del Excel de comprobantes, arreglos de la auditoría del 2026-10-21, versión `0.29.0`) está **testeado** a mano con datos reales (2026-10-21), salvo el modo servidor/terminal
en la LAN (fase 5d), que sigue a testear.

## Pendientes (pedidos 2026-10-16)

1. **Gastos varios** — **Testeado** ([plan 037](plans/037-importar-gastos-varios.md)): Herramientas → Importar Excel → "Gastos varios"
   importa el Excel de comprobantes como movimientos del mes abierto (concepto "Gastos varios"); reimportar no duplica ni lo editado a mano (plan 038).
   - v0.33.0 — **A testear**: los códigos que no son de Hornera (CAY, LAU, CAY/LAU, CASEST/CASAEST, CASA) van a la pantalla nueva
     Mes → Gastos personales (tabla `gasto_ajeno`, editable), con lo de cada uno y los compartidos partidos mitad y mitad; BBVA da aviso;
     reimportar anula los que una versión anterior había cargado a Hornera ([plan 045](plans/045-gastos-ajenos-ya-importados.md), [plan 047](plans/047-gastos-ajenos-guardados.md)).
2. **Cuenta de la liquidación** — **A testear**: en el detalle de cada depto (Liquidación) y en el Resumen del PDF, renglón por renglón,
   con lo que compone cada uno y dónde se corrige (Ajustar la reserva, Variables, Agregar/Editar el movimiento):
   - Ingresos operativos − Costos = Ingreso bruto
   - Ingreso bruto × Comisión (Lautaro y Amancay) = Valor liquidación inicial
   - Valor liquidación inicial − Costos excepcionales = Valor liquidación final
   - Costos excepcionales = los movimientos del mes del depto (gastos, adelantos, cobros directos); el saldo anterior va aparte.
   - Un mes cerrado se ve como se guardó al cerrar (o al importar el Excel), igual que el PDF ([plan 040](plans/040-liquidacion-cerrada-desde-snapshot.md), v0.30.1).
   - Si los redondeos del Excel no coinciden, un renglón "Redondeo" de $ 1 cierra la cuenta con el saldo ([plan 041](plans/041-cuenta-cierra-al-peso.md), v0.30.3). Manual y guía de prueba al día ([plan 039](plans/039-manual-cuenta-liquidacion.md)).
   - Arriba de la cuenta, la barra "Distribución del importe" reparte lo que entró en costos, Hornera, gastos del depto y propietario (con la deuda si el saldo es negativo); en la tabla, la columna Reparto con una mini barra reemplaza a Bruto y Honorarios ([plan 042](plans/042-barra-reparto-pulido.md), v0.30.4).
   - v0.32.0: "Costos excepcionales" pasa a llamarse "Gastos Varios" (pantalla, PDF y manual); tablas del detalle con subtotales,
     total de reservas, columnas vacías ocultas y bordes más marcados; la tabla se ordena por Saldo y por Reparto.
7. **Saldado por fuera** — **A testear** (v0.32.0): las deudas de antes de la app que ya se resolvieron se marcan en Transferencias
   o en el Historial (una por una, o "Saldar por fuera hasta" un mes para la carga inicial). No quedan pendientes ni pasan al mes
   siguiente, sin registrar un pago (no mueven cuentas ni se facturan); se desmarcan y quedan en la auditoría.
8. **Deptos nuevos desde Stays** — **A testear** (v0.35.1; AMA ya creado en dev; definido con grill-me el 2026-10-22): si "Traer mes" encuentra un
   alojamiento activo en Stays que la app no tiene (p. ej. AMA), ofrece "Crear y traer": lo da de alta con el dueño de Stays
   (el propietario vinculado, el de sus otros deptos o uno nuevo con su nombre), dirección y fotos, 20% de comisión, y trae sus reservas.
   - Propietarios → "Datos": CBU/CVU (22 dígitos con verificador) o alias, mails, moneda y comisión de cobro en USD.
     Un Excel más nuevo los vuelve a pisar (gana el Excel) y la importación avisa a quién le cambió el CBU, los mails o la moneda.
   - Liquidación y PDF muestran los códigos reales de la reserva (Stays y plataforma) en vez del generado (v0.34.1).
9. **Ficha del depto y vencimientos** — **A testear** (v0.36.0; definido con grill-me y Lautaro el 2026-10-22; [plan 049](plans/049-ficha-del-depto.md)):
   Deptos → "Ficha" con servicios e impuestos (N° de cuenta, titular, quién paga, vencimiento), claves (ocultas, se copian),
   contactos y notas. Mes → "Vencimientos": lo que vence en el mes de lo que paga Hornera; pagado solo al cargar el gasto
   del depto con ese concepto. Las claves quedan en la auditoría sin el valor. Fuera por ahora: adjuntos, cifrado, aviso en Resumen.
10. **Métricas del glosario de Amancay** — **A testear** (v0.37.0; 2026-10-23): Resumen muestra ocupación, ADR, RevPAR
   (mediana de la cartera), neto por noche y honorario efectivo; las estadías del propietario no cuentan como noches vendidas
   ni a la venta, y el ADR va sin la tarifa por estadía. "Ingreso bruto" pasa a "Base de honorarios". Para medir elasticidad,
   primero juntar fotos diarias del calendario de Stays ([plan 050](plans/050-foto-calendario-stays.md)).
   v0.38.0: elasticidad indicativa por depto y de la cartera, contra el mismo mes del año anterior o el anterior, con avisos y confianza.
11. **Limpieza** — **A testear** (v0.39.0; 2026-10-23; [plan 057](plans/057-limpieza-horas-y-liquidaciones.md) y [059](plans/059-pago-limpieza-no-editable.md)):
   Mes → "Limpieza" importa las horas del Google Form (desde el 10/09/2026), liquida a la coordinadora por período de fechas
   libres con horas y plata de cada chica, y al marcar pagada crea el gasto de Hornera (concepto Limpieza). Plus por tipo de
   tarea editable (horas o pesos) y horas por chica, depto y mes como información. Falta: probar con el Excel real, cargar los
   períodos 10/09–22/09 y 23/09–07/10 con lo pagado (ajuste) y la lavandería ([plan 058](plans/058-lavanderia.md)).
12. **Restaurar y borrar la base** — **A testear** (v0.40.0; 2026-10-23; idea tomada de Roble): Herramientas → Copias de seguridad
   suma "Guardar una copia en…" (pendrive), "Restaurar desde una copia…" y "Borrar toda la base" (escribiendo BORRAR; conserva
   la configuración de la PC y las terminales). Las dos últimas hacen antes una copia `antes-de-reemplazar` que no rota y
   reinician la app; la base nueva se arma y migra al lado y se aplica al arrancar, nunca con la base abierta.
13. **Menú HORNERA y Resumen Hornera** — **A testear** (v0.41.0; definido con grill-me el 2026-10-23): el menú agrupa lo de la
   empresa en HORNERA (Resumen Hornera, Movimientos, Cuentas, Vencimientos, Limpieza, Comprobantes, Emisores, Gastos personales)
   y DATOS queda con Deptos y el desplegable Propiedades (Liquidación, Transferencias, Historial, Propietarios). Resumen Hornera
   abre en el mes en curso: resultado con ingresos y gastos de la empresa por concepto, gastos personales aparte, lo que falta
   pagar (vencimientos, limpieza, propietarios del último cierre), Disponible = saldos − pendientes, facturado por emisor en el mes
   y en 12 meses, y evolución. El Resumen queda de deptos (la tarjeta del resultado pasa a Honorarios, con ⓘ que explica la cuenta).
   v0.41.1: manual revisado de punta a punta (capítulos nuevos: Resumen Hornera, Limpieza, Comprobantes, Auditoría; gastos varios,
   facturas hechas por fuera, nombre de la PC) con capturas nuevas; Auditoría legible para limpieza; pestañas de Limpieza: Horas primero.
14. **Asistente con IA** — **En curso** (v0.42.0; definido con grill-me el 2026-10-23; [plan 061](plans/061-asistente-ia.md)): panel
   lateral que contesta preguntas sobre los datos, el uso de la app y análisis con Claude, solo lectura (la IA llama herramientas
   del servidor, ninguna escribe). v0.42.0: tablas de conversaciones y respuestas (esquema 21). v0.42.1: Herramientas →
   Asistente (solo servidor): API key cifrada en la PC, modelo y esfuerzo. v0.42.2: las 21 herramientas de solo lectura
   (consulta_sql con conexión de solo lectura, tablas ocultas y tope de 200 filas / 5 s). v0.42.3: el bucle con Claude
   (herramientas, manual con caché, respaldo por rechazo, tope de 10 vueltas, modelo y costo de cada respuesta). v0.42.4–7: planes 062–065 (conversaciones viejas, SQL en proceso aparte,
   tope de tamaño, costo del respaldo). v0.43.0: rutas para preguntar (también desde terminales, una a la vez por
   conversación) y el historial de cada PC. v0.44.0: el panel "Asistente con IA" (menú lateral, en todas las PCs):
   conversaciones anteriores, tablas de la respuesta y, al pie, modelo, consultas, costo y "Cómo lo calculé". v0.44.3: el manual se lee por capítulo, a pedido (plan 066): la primera
   pregunta de cada conversación manda unos 7.000 tokens fijos en vez de 28.500. v0.45.0: Sonnet con esfuerzo bajo por
   defecto y "Pensar más" al pie de la última respuesta (la repite con esfuerzo alto en una conversación nueva). v0.46.0: Herramientas → Asistente muestra el gasto del mes (v0.46.1: también el panel). v0.46.2: las respuestas se ven como en la app de Claude
   (Markdown completo: títulos, tablas, listas anidadas).
3. **Auditoría por usuario** — **A testear** (v0.31.0; definida con grill-me el 2026-10-21; pulido en planes 043 y 044): registrar los movimientos que hace cada usuario, sobre todo los de dinero.
   - Usuario = la PC: solo Lautaro y Amancay, una PC cada uno (servidor y terminal). Sin login ni PIN.
   - Terminales → "Nombre de esta PC" en el servidor (se guarda en `configuracion`); reemplaza al nombre de Windows en la auditoría.
     Al guardarlo, los renglones viejos con el nombre de Windows pasan a decir el nombre nuevo. La terminal ya usa el nombre del emparejamiento.
   - Herramientas → Auditoría: tabla con fecha, quién, qué (movimiento, reserva, variables…), acción y qué cambió; filtros por mes, quién y tipo.
     "Qué cambió" muestra solo los campos que cambiaron ("Importe: $ 10.000 → $ 12.000"), con la plata en pesos; altas y anulaciones, un resumen.
   - "Traer mes" de Stays e importaciones (Excel mensual, gastos varios): un renglón por vez con el resumen (reservas nuevas/cambiadas, cobros), no uno por reserva.
   - v0.35.2: más legible (fecha corta, acción con color, cada dato con su rótulo, sin ceros ni vacíos en altas e importaciones),
     buscador, "Saldado por fuera" con su depto y mes, y emparejar o revocar una terminal queda registrado con su IP.
4. **Variables operativas** administrables — **Testeado**: Liquidación → "Variables del mes"
   (tarifas de limpieza, lavandería, tramos, channel manager, descuento del dólar) y Deptos → "Variables"
   (comisión y tarifas propias). Solo el mes abierto; queda en la auditoría.
5. **Tarjetas**: vincular los gastos de la tarjeta con el costo que representan en cada depto. Hoy
   usan un Excel; falta recibir esa información.
6. **Facturación ARCA** — **Testeado** (las 8 etapas hechas: esquema, transporte ARCA, emisores y certificados en Datos → Emisores, datos fiscales en Datos → Propietarios, factura al pagar en Transferencias, nota de crédito al anular el pago, PDF de la factura con QR, y la pantalla Mes → Comprobantes del plan 035) (`plans/031-facturacion-arca.md`): facturar los honorarios
   al pagar cada liquidación, con emisor Lautaro o Amancay. Antes de probar en producción, cada uno
   tiene que hacer el trámite del certificado y del punto de venta Web Services (manual de Roble).

## Checklist de prueba (próxima sesión)

Cómo probar cada punto, paso a paso: `GUIA-PRUEBAS.md`.

**Instalador**
- [x] Instalar con `Hornera Setup <versión>.exe` en la PC servidor; queda el acceso directo y abre la app.
- [x] Instalar una versión nueva encima: los datos (`%APPDATA%\Hornera`) siguen ahí.

**Fase 2 · App y backups**
- [x] La app instalada abre; abrirla dos veces trae la ventana existente.
- [x] Al cerrar queda un backup en `%APPDATA%\hornera\backups`; con la app abierta, uno cada 6 h.
- [ ] v0.34.0 — Herramientas → Copias de seguridad (solo en la PC servidor): elegir una carpeta de Drive/OneDrive (se prueba con una copia antes de guardarla), volver a la de siempre, "Hacer una copia ahora" y las últimas 5 copias ([plan 048](plans/048-carpeta-de-copias.md)). En una terminal no aparece.

**Fase 3 · Importar Excel**
- [x] Importar `2026-04.xlsx`: 24 liquidaciones, avisos de JAI, SAR y el fondo de CNG.
- [x] Propietarios y Deptos con los datos de Propiedades; los 5 que liquidan en USD.
- [x] Importar los meses anteriores cuando lleguen (no deben pisar a abril).

**Fase 4 · Stays** (necesita la contraseña nueva)
- [x] Cargar usuario y clave; "traer mes" de abril y mayo contra el Stays real.
- [x] Cotejar reservas y cobros con la hoja RESERVAS; revisar los avisos (comisión MP/PayPal, canales, deptos).
- [x] Revisar los avisos de alojamientos (activos en Stays y no en la app, y al revés), las direcciones completadas desde Stays, que las fotos se vean en Deptos, los avisos de propietarios (deptos con otro dueño en Stays), y que las canceladas, los horarios y el desglose de precio lleguen bien.

**Fase 5a · Liquidación**
- [x] Cargar la cotización; revisar saldos y detalle por depto.
- [x] "Traer mes" del mes en curso deja la cotización "provisoria"; uno cargado a mano queda "manual" y otro "traer mes" no lo pisa (avisa); "Pedir a la API" la reemplaza.
- [x] "Comparar con el Excel del mes" con el mes traído de Stays: las diferencias tienen que tener explicación.
- [x] Ajustes de reserva (corrección, comisión, excluir) desde Stays y su efecto en la liquidación.

**Fase 5b · Movimientos y cuentas**
- [x] Cargar gastos del mes como en CORRIENTE; editar y anular.
- [x] Asociar cada medio de pago de Stays a su cuenta; cargar el saldo inicial de cada cuenta y compararlo con el banco.
- [x] Transferencia entre cuentas y compra de dólares.

**Fase 5c · Cierre, transferencias y PDF**
- [x] Cerrar un mes, generar los PDF y compararlos con los que hoy se mandan desde el Excel.
- [x] Marcar pagado (total y en partes), anular un pago, exportar el Excel de transferencias.
- [x] Reabrir un mes (sin pagos) y volver a cerrarlo.

**Fase 5d · Terminales** (dos PC en la misma red)
- [ ] En la PC servidor, permitir Hornera en el firewall de Windows (redes privadas) cuando lo pregunte.
- [ ] Instalar en la segunda PC, elegir "Terminal" y conectar con el nombre del servidor (Terminales lo muestra).
- [ ] Emparejar con el código; cargar un movimiento desde la terminal y verlo en el servidor (y en la auditoría con el nombre de la terminal).
- [ ] Revocar la terminal: tiene que volver a pedir el código.
- [ ] Cerrar Hornera en el servidor: la terminal avisa que no puede conectar; al reabrirlo, "Conectar" vuelve a entrar.

**Variables operativas**
- [x] Cambiar el costo hora en el mes abierto, "Recalcular" y comparar la tarifa base con la del Excel.
- [x] Cambiar la comisión o la tarifa de un depto y ver el efecto en su liquidación; un mes cerrado no cambia.
- [x] "Traer mes" de un mes nuevo arranca con las variables del anterior.

**Fase 6 · Resumen**
- [x] Con abril importado: ocupación, bruto y honorarios por depto iguales a las hojas del Excel.
- [x] Revisar con los dueños la definición de "Resultado de Hornera" (DECISIONES, "Pendiente").
- [x] Evolución: los meses del histórico (12/2021 a 10/2024) con sus noches; los meses cerrados con todo.

Facturación ARCA, paso a paso: `GUIA-PRUEBAS.md`, sección 9. En desarrollo ya se verificó en homologación
(2026-10-19, con el certificado de prueba de Roble): Factura C y NC C aprobadas, PDF con QR. Falta que la
prueben Lautaro y Amancay con sus propios certificados.

**Facturación ARCA · Emisores** (necesita el certificado de homologación de WSASS, manual de Roble)
- [x] Datos → Emisores: cargar a Lautaro y a Amancay con su CUIT, punto de venta Web Services y ambiente homologación.
- [x] "Certificado" (en la PC servidor): subir el .crt y el .key; uno de otro CUIT o una clave que no es la suya, rechazados.
- [x] "Probar": ARCA responde el último comprobante autorizado (0 si nunca se facturó por Web Services).

**Facturación ARCA · Datos fiscales del propietario**
- [x] Datos → Propietarios → "Datos fiscales": la primera vez propone CUIT/DNI y condición del Excel; un CUIT mal tipeado no se guarda.
- [x] "Consultar padrón de ARCA" (con un emisor en producción y el servicio ws_sr_constancia_inscripcion habilitado): completa razón social, condición y domicilio sin guardar. Con emisores solo en homologación avisa "solo en producción".

**Facturación ARCA · Factura al pagar** (homologación primero)
- [x] Transferencias → "Marcar pagado": se abre "Facturar este pago" con la parte de los honorarios que corresponde al pago; elegir emisor y Emitir. El pago muestra "emitida n.º" (o "prueba n.º" en homologación).
- [x] Pago en partes: cada pago propone su proporción; pasar los honorarios del mes avisa pero deja emitir.
- [x] Sin internet o con ARCA rechazando: el pago queda registrado y la factura "rechazada" con el motivo; "Reintentar" desde la fila.
- [x] Propietario sin datos fiscales completos: no deja emitir y dice qué falta.
- [x] "PDF" en la factura de un pago: datos del emisor y del receptor, período, CAE y QR (escanearlo con el celular abre la verificación de ARCA). El PDF de la liquidación del depto suma una página por factura vigente.
- [x] Anular un pago facturado ofrece "Emitir nota de crédito"; si se saltea, el pago queda "pago anulado, factura vigente" en Transferencias e Historial hasta emitirla.
- [x] Mes → Comprobantes: las facturas y NC del mes de emisión, el neto por emisor, la factura "anulada por NC" y la NC "anula FC", los rechazos pendientes con "Reintentar", "Emitir nota de crédito", PDF y "Ver detalle". En el instalador no aparecen los de homologación.
- [x] Comprobantes → **En ARCA** → Importar de ARCA el CSV de Mis Comprobantes → Emitidos de cada emisor ([plan 036](plans/036-mis-comprobantes-arca.md)): se ven lo emitido desde Hornera, lo hecho por fuera a propietarios y a otros; reimportar no duplica; un archivo de otro CUIT se rechaza.
- [x] Con una factura hecha en Comprobantes en Línea a un propietario: "Facturar este pago" la muestra; "Es esta" deja el pago "por fuera n.º …" sin ofrecer facturar; "No es ninguna de estas" deja emitir. "Desvincular" desde En ARCA lo revierte.

**Facturación ARCA · Producción** (después de homologación)
- [x] Certificado y punto de venta Web Services de producción cargados; "Probar" responde un número.
- [x] Primera factura real chica: PDF revisado, QR escaneado y la factura visible en "Mis Comprobantes" de ARCA.
- [x] Vencimiento de cada certificado anotado (2 años).

**Preguntas para los dueños** (`DECISIONES.md`, "Pendiente"): qué plataformas cobran comisión,
honorarios en meses sin reservas, cómo cargan en Stays las estadías del propietario y los bloqueos.
