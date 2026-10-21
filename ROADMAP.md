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
2. **Cuenta de la liquidación** — **A testear**: en el detalle de cada depto (Liquidación) y en el Resumen del PDF, renglón por renglón,
   con lo que compone cada uno y dónde se corrige (Ajustar la reserva, Variables, Agregar/Editar el movimiento):
   - Ingresos operativos − Costos = Ingreso bruto
   - Ingreso bruto × Comisión (Lautaro y Amancay) = Valor liquidación inicial
   - Valor liquidación inicial − Costos excepcionales = Valor liquidación final
   - Costos excepcionales = los movimientos del mes del depto (gastos, adelantos, cobros directos); el saldo anterior va aparte.
3. **Auditoría por usuario**: registrar los movimientos que hace cada usuario, sobre todo los de dinero.
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
