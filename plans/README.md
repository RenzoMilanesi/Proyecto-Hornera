# Planes — Hornera

Generados por `improve deep` sobre el scaffold de la fase 2 (2026-10-12),
sobre el commit `7ca8b0e` + el scaffold de la fase 2 todavía sin commitear.

| # | Plan | Prioridad | Esfuerzo | Depende de | Estado |
|---|---|---|---|---|---|
| 001 | [Una sola instancia sin error al reabrir](001-instancia-unica.md) | P1 | S | — | A TESTEAR |
| 002 | [API solo para pedidos dirigidos a la PC (DNS rebinding)](002-host-permitido.md) | P1 | S | — | A TESTEAR |
| 003 | [Backup con carpeta de respaldo si falla la configurada](003-backup-fallback.md) | P1 | S | — | A TESTEAR |
| 004 | [Backup también al apagar Windows](004-backup-apagado.md) | P2 | S | 003 | A TESTEAR |
| 005 | [Errores de la API como JSON corto](005-errores-json.md) | P2 | S | 002 | A TESTEAR |
| 006 | [Importar un mes anterior no pisa maestros](006-importar-mes-anterior.md) | P1 | S | — | A TESTEAR |
| 007 | [Rollback si falla una migración](007-migracion-rollback.md) | P3 | S | — | A TESTEAR |
| 008 | [Avisos repetidos sin advertencia de React](008-avisos-key.md) | P3 | S | — | A TESTEAR |
| 009 | ["Traer mes" solo borra lo que Stays ya no tiene](009-sync-no-borra-lo-devuelto.md) | P1 | S | — | A TESTEAR |
| 010 | [Credenciales ilegibles no rompen la pantalla](010-credenciales-ilegibles.md) | P3 | S | — | A TESTEAR |
| 011 | ["Traer mes" no borra reservas con datos cargados a mano](011-sync-conserva-ajustes.md) | P1 | S | — | A TESTEAR |
| 012 | [Importar el Excel de un mes ya traído de Stays](012-importar-sobre-periodo-de-stays.md) | P1 | S | — | A TESTEAR |
| 013 | [Moneda del propietario solo desde hojas de depto](013-moneda-del-propietario.md) | P1 | S | — | A TESTEAR |
| 014 | [Una sola regla de "reserva del período"](014-regla-reserva-en-periodo.md) | P2 | S | 011 | A TESTEAR |
| 015 | [Regresión de abril con importador + motor](015-regresion-motor-con-importador.md) | P2 | M | 013 | A TESTEAR |
| 016 | [Errores chicos de robustez](016-robustez.md) | P2 | S | — | A TESTEAR |
| 017 | [Tests de "traer mes", API y migración](017-tests-sync-y-api.md) | P2 | S | 011, 014 | A TESTEAR |
| 018 | [Seguridad preventiva de la API local y la ventana](018-seguridad-preventiva.md) | P3 | S | — | A TESTEAR |
| 019 | [CLAUDE.md, docs al día y tests que limpian](019-documentacion-y-dx.md) | P3 | S | 015 | A TESTEAR |
| 020 | [La comisión de una reserva se cobra una sola vez](020-comision-una-vez.md) | P1 | S | — | A TESTEAR |
| 021 | [No se cambian ajustes de reservas de un mes cerrado](021-ajustes-mes-cerrado.md) | P2 | S | — | A TESTEAR |
| 022 | [Avisar cuando el saldo viene de un mes que no es el anterior](022-aviso-mes-salteado.md) | P3 | S | — | A TESTEAR |
| 023 | [La comparación con el Excel se borra al recalcular](023-comparacion-vieja.md) | P3 | S | — | A TESTEAR |
| 024 | [El saldo de una cuenta arranca en su "Saldo inicial"](024-saldo-cuenta-desde-saldo-inicial.md) | P1 | S | — | A TESTEAR |
| 025 | [No se paga un mes cuyo saldo ya pasó al siguiente cerrado](025-no-pagar-saldo-arrastrado.md) | P1 | S | — | A TESTEAR |
| 026 | [Cotización del dólar junto con "traer mes"](026-cotizacion-dolar-api.md) | P2 | M | — | A TESTEAR |
| 027 | [La terminal no queda trabada si el servidor responde con error](027-terminal-sin-salida-ante-error-http.md) | P2 | S | — | A TESTEAR |
| 028 | [Historial de pagos por depto y por propietario](028-historial-de-pagos.md) | P2 | M | — | A TESTEAR |
| 029 | [La cotización manual no se pisa en carrera; aviso de "Pedir a la API"](029-cotizacion-carrera-y-aviso.md) | P3 | S | 026 | A TESTEAR |
| 030 | [El descuento sobre el dólar cripto tiene que ser menor a 100 %](030-descuento-dolar-menor-a-100.md) | P2 | S | — | A TESTEAR |
| 031 | [Facturación electrónica con ARCA (honorarios a propietarios)](031-facturacion-arca.md) | P2 | L | — | A TESTEAR (8 etapas hechas) |
| 032 | [Una nota de crédito siempre dice qué factura anula](032-nota-credito-con-asociado.md) | P3 | S | 031 (etapa 1) | A TESTEAR |
| 033 | [Fechas de servicio en facturas y NC, y CAE perdido por timeout](033-arca-fechas-servicio-y-cae-perdido.md) | P2 | S | 031 (etapa 2) | A TESTEAR |
| 034 | [El ticket de acceso de ARCA no viaja en los backups](034-ticket-arca-fuera-de-backups.md) | P3 | S | 031 (etapa 3) | A TESTEAR |
| 035 | [Pantalla "Comprobantes": facturas y NC emitidas, mes a mes](035-pantalla-comprobantes.md) | P2 | M | 031 (etapas 1-7) | A TESTEAR |
| 036 | [Lo facturado en ARCA dentro de Hornera, para no facturar dos veces](036-mis-comprobantes-arca.md) | P2 | M | 031, 035 | A TESTEAR |
| 037 | [Importar los gastos varios (Excel "Comprobantes Hornera")](037-importar-gastos-varios.md) | P2 | S | — | A TESTEAR |
| 038 | [Reimportar los gastos varios no duplica lo editado a mano](038-gastos-reimportar-tras-editar.md) | P2 | S | 037 | A TESTEAR |
| 039 | [El manual y la guía de prueba explican la cuenta de la liquidación](039-manual-cuenta-liquidacion.md) | P2 | S | — | HECHO |
| 040 | [La pantalla Liquidación de un mes cerrado muestra lo guardado al cerrar](040-liquidacion-cerrada-desde-snapshot.md) | P1 | M | — | A TESTEAR |
| 041 | [La cuenta de la liquidación cierra al peso con el saldo](041-cuenta-cierra-al-peso.md) | P2 | S | 040 (mismo archivo) | A TESTEAR (opción A) |
| 042 | [Barra del reparto: manual al día, deptos en dólares e ingresos negativos](042-barra-reparto-pulido.md) | P2 | S | — | HECHO |
| 043 | [El manual y la guía de prueba explican la auditoría por usuario](043-manual-auditoria.md) | P2 | S | 042 (manual) | TODO |
| 044 | [Auditoría: nombre de PC que choca con una terminal, pagos en dólares viejos y texto del ROADMAP](044-auditoria-pulido.md) | P3 | S | — | TODO |
| 045 | [Anular los gastos ajenos (CAY, LAU, CASEST…) que ya se importaron como gasto de Hornera](045-gastos-ajenos-ya-importados.md) | P2 | S | — | HECHO |
| 046 | [Saldado por fuera: el PDF del mes y el "hasta" sin validar](046-saldado-fuera-pulido.md) | P2 | S | — | HECHO |
| 047 | [Guardar los gastos ajenos (CAY, LAU, CAY/LAU, CASEST, CASA) y verlos en "Gastos personales"](047-gastos-ajenos-guardados.md) | P2 | M | 045 | HECHO |
| 048 | [Elegir desde la app la carpeta de las copias de seguridad](048-carpeta-de-copias.md) | P2 | M | — | A TESTEAR |
| 049 | [Ficha del depto y Vencimientos: decisiones, manual y test de rutas](049-ficha-del-depto.md) | P2 | S | — | HECHO |
| 050 | [Foto diaria del calendario de Stays (precio y disponibilidad por noche)](050-foto-calendario-stays.md) | P3 | M | — | TODO |
| 051 | [Noches no disponibles a partir del calendario de Stays](051-bloqueos-desde-calendario.md) | P2 | M | 050 | TODO |
| 052 | [PDF del propietario: ocupación que se entiende con sus renglones](052-ocupacion-pdf-legible.md) | P3 | S | — | TODO |
| 053 | [Test: alojamiento y métricas de un mes cerrado con detalle](053-test-alojamiento-mes-cerrado.md) | P3 | S | — | TODO |
| 054 | [Elasticidad: calcular solo con meses cerrados](054-elasticidad-solo-meses-cerrados.md) | P2 | S | — | TODO |
| 055 | [DECISIONES: sacar la elasticidad de "Quedan afuera del sistema"](055-decisiones-elasticidad-contradiccion.md) | P3 | S | — | TODO |
| 056 | [Test: elasticidad contra el mismo mes del año anterior](056-test-elasticidad-anual.md) | P3 | S | 054 | TODO |
| 057 | [Limpieza: importar las horas del Form y liquidar con división por chica](057-limpieza-horas-y-liquidaciones.md) | P1 | L | — | A TESTEAR |
| 058 | [Lavandería: cada pago como gasto de la empresa](058-lavanderia.md) | P2 | S | 057 | TODO |
| 059 | [El pago de una liquidación de limpieza no se edita desde Movimientos](059-pago-limpieza-no-editable.md) | P2 | S | 057 | A TESTEAR |
| 060 | [El manual explica el menú nuevo y la pantalla Resumen Hornera](060-manual-menu-hornera.md) | P2 | S | — | HECHO (v0.41.1: manual revisado completo) |
| 061 | [Asistente con IA (Claude) para consultar la app: fase 1, solo lectura](061-asistente-ia.md) | P2 | L | — | EN CURSO (v0.42.7: pasos 0 a 4 y 7 hechos, más 062–065) |
| 062 | [Una conversación del asistente se puede retomar después de actualizar la app](062-ia-historial-tras-actualizar.md) | P1 | S | — | HECHO (v0.42.4) |
| 063 | [Una consulta SQL del asistente no puede congelar el servidor](063-ia-consulta-sql-worker.md) | P1 | M | — | HECHO (v0.42.5; falta probar en el .exe) |
| 064 | [Lo que devuelve una herramienta del asistente tiene tope de tamaño](064-ia-tope-tamano-resultados.md) | P2 | S | — | HECHO (v0.42.6) |
| 065 | [El costo se ve también cuando contesta el modelo de respaldo](065-ia-precios-modelos-respaldo.md) | P3 | S | — | HECHO (v0.42.7) |

Planes 062–065: revisión `improve deep` de los pasos 0–4 del plan 061 (`fba59f6`, 2026-10-23), a hacer antes del paso 5. Descartado: `dbstat` (solo tamaños de páginas, no datos), `sqlite_dbpage` (no está compilado), `pragma_table_info` y `load_extension` (bloqueados por el authorizer, probado); claves de deptos guardadas en `conversacion_ia` (ya están en la misma base, en `depto_clave`); el esquema de `consulta_sql` se arma en cada pregunta (unas 60 consultas a `sqlite_master`, despreciable); tercera copia del patrón `safeStorage` en `electron/main.ts` (no vale abstraerlo).

Plan 061: definido con `grill-me` el 2026-10-23 (sobre `7baa8c5`). La fase 2 (acciones con confirmación) va en un plan aparte, después de probar la fase 1.

Plan 060: revisión `improve deep` del grupo HORNERA y Resumen Hornera (definido con `grill-me` el 2026-10-23, sobre `dcc7481`). Descartado: el Disponible no descuenta vencimientos (no tienen importe cargado; la pantalla lo aclara); lo pendiente a propietarios mira solo el último mes cerrado (lo anterior ya se arrastró a ese saldo); NC de factura de crédito electrónica 203/208/213 (marcado `ponytail:` en `SQL_FACTURADO`, Hornera no las usa); evolución recalcula cada mes cerrado (pocos meses, como en el Resumen).

Planes 051–053: revisión `improve deep` de las métricas del glosario (`fcbdf9e`) y del plan 050, 2026-10-23. Corregido en el plan 050: la escritura iba en una transacción abierta mientras se esperaba a Stays (ahora baja todo y después escribe). Anotado en DECISIONES (sin plan): el ADR parte de lo cobrado neto de la comisión de MP/PayPal. Descartado: Evolución recalcula los saldos de cuentas por cada mes (pocos meses, no se nota); bloqueos y estadías del propietario contados dos veces (los bloqueos no se cargan); restar el propietario en meses del Excel (B26 también los incluye, lo confirma la regresión).

Planes 054–056: revisión `improve deep` de la elasticidad (`4a42a69`), 2026-10-23. Descartado: el mes abierto se calcula dos veces por consulta (con 054 desaparece); pedir un mes inexistente no rompe (`resumenDelMes` falla antes con un error claro); `mesAnterior` cruza bien el cambio de año.

Los planes 001 a 030 están implementados y con tests; quedan **a testear** a mano en la próxima sesión (ver checklist en `ROADMAP.md`).

Auditoría `improve deep` de todo el sistema, 2026-10-21 (sobre `1290f60`): el usuario pidió implementar los hallazgos en la misma sesión, sin planes aparte (A TESTEAR):
ARCA no factura dos veces (un reintento que falla antes del CAE no tapa el intento sin respuesta, otro emisor también pide revisar, corte al leer la respuesta);
modales de alta sin doble envío (`useUnaVez`); coma decimal en cotización y porcentajes; no se anula un pago cuyo saldo ya pasó a un mes cerrado;
la moneda queda en el snapshot de la liquidación (migración 12 → 13); cotización provisoria guardada aparte (13 → 14) y sin escribir en un mes que se cerró
mientras se esperaba a la API; "traer mes" no escribe si el mes se cerró durante la descarga; Historial ofrece la factura al pagar; errores de carga visibles
y aviso sin meses; gastos varios con identidad sin depto ni monto (14 → 15) y avisos con el renglón real; recargar el mismo certificado conserva el ticket de ARCA;
`npm run dist` corre typecheck y tests; CLAUDE.md y DECISIONES al día.
Descartado por el usuario: `npm run dev` sirve archivos del repo a la LAN sin emparejar (solo en desarrollo).
Para decidir con los dueños: saldo arrastrado cuando el depto cambia de dueño (hoy pasa al nuevo); "traer mes" que cambia pagos o fechas de una reserva ya liquidada en un mes cerrado (se puede perder la parte del mes anterior; confirmar si el Excel hacía lo mismo).
Para más adelante (riesgos chicos): horas UTC en importación y sync; workers de Stays que siguen tras un error y 5xx sin reintento; token de terminal en claro y por 10 años; "Saldo inicial" con depto que reemplaza el arrastre sin aviso; Historial con dos meses abiertos; `v_saldo_cuenta` descuenta comisión de todo medio; filas de CORRIENTE con importe en texto se pierden sin aviso; fechas B3/B4 del Excel sin validar; paginación de owners/payment-providers de Stays sin verificar; error boundary; Electron 44.9.x.
Plan 038: revisión `improve deep` del plan 037 (gastos varios), 2026-10-21. Descartado: una transacción por fila (reimportar completa sin duplicar); el corte de gastos del período no se aplica (nadie lo usa hoy); importar sin vista previa (cada gasto se anula desde Movimientos).
Plan 035: feature pedida por el usuario, definida con `grill-me` el 2026-10-19 (hoy una NC emitida no se ve en ningún lado de la app). Implementado el 2026-10-20 (v0.25.0). Revisión `improve deep` del diff: sin plan nuevo; sumado en la misma tarea el test de la NC rechazada pendiente. Descartado: neto del mes que mezcla prueba y producción (solo con la app sin instalar); un rechazo con otro tipo de comprobante que el aprobado (cambio de condición IVA) sigue listado, como dice la definición del plan.
Plan 031 etapa 7: revisión `improve deep` del diff (PDF de la factura), 2026-10-19: sin plan nuevo. Descartado: la alerta de `npm audit` de `node-forge` (GHSA-86w9-cpqp-85rv, verificación de firmas PKCS#1; Hornera solo firma el CMS y compara el módulo de la clave); decodificar el QR en los tests (lo arma `qrcode`, el test valida el SVG y `qrArca` ya tiene el suyo).
Plan 031 etapa 6: revisión `improve deep` del diff (anulación y NC), 2026-10-19: sin plan nuevo; corregido en la misma etapa: la NC se podía pedir para la factura de un pago vigente (la fila quedaba "emitida"). Descartado: ofrecer la NC desde Movimientos (ahí solo se anula en el mes abierto).
Plan 031 etapa 5: revisión `improve deep` del diff (factura al pagar), 2026-10-19: sin plan nuevo; corregido en la misma etapa: la regla 3 del plan 033 volvía a pedir revisión después de un intento ya revisado (ahora mira solo el último intento) y un rechazo en producción quedaba tapado por una factura de prueba en la fila del pago. Descartado: emitir desde una terminal (la clave queda en el servidor, como "Probar"); auditar los rechazos (ya quedan en `comprobante`); respuestas viejas de la propuesta al cambiar de emisor en el modal (solo cambia "ya facturado").
Plan 031 etapa 4: revisión `improve deep` del diff (datos fiscales y padrón), 2026-10-19: sin plan nuevo; el padrón prefería un emisor de producción sin certificado (corregido en la misma etapa). Descartado: cachear la constancia como Roble (consulta manual y rara), DNI para exentos (ARCA lo acepta en Factura C).
Plan 034: revisión `improve deep` de la etapa 3 del plan 031 (emisores), 2026-10-19. Descartado: "Probar" y editar un emisor desde una terminal (no exponen la clave; cargar el certificado sí es solo en el servidor); descifrar la clave en cada GET /api/emisores (DPAPI local, dos emisores).
Plan 033: revisión `improve deep` de la etapa 2 del plan 031 (transporte ARCA), 2026-10-19. Descartado: `tls.DEFAULT_CIPHERS` global (decisión de Roble, documentada: solo saca DH, no baja el SECLEVEL); `desglosarIva` con una sola alícuota (Hornera factura una línea, honorarios).
Plan 032: revisión `improve deep` de la etapa 1 del plan 031 (esquema), 2026-10-16. Descartado: FKs de `comprobante` sin ON DELETE (nada borra períodos, deptos, propietarios ni movimientos; no hay REPLACE); formato de `fiscal_doc_nro` (lo valida la etapa 4 en la API).
Plan 031: feature pedida por el usuario, definida con `grill-me` el 2026-10-16 (decisiones en el plan). Base: la integración ARCA de Roble.

Planes 006-008: revisión `improve deep` del importador (fase 3), 2026-10-12.
Planes 009-010: revisión de la sincronización con Stays (fase 4), 2026-10-12.
Plan 029: revisión `improve deep` del plan 026, 2026-10-16. Descartado: el importador deja `usd_cotizacion_fecha` vieja al pisar un período (inofensivo: queda fuente `manual` y el período cerrado).
Plan 030: revisión `improve deep` de las variables operativas, 2026-10-16. Descartado: "Recalcular" con un campo vacío deja NaN (el servidor lo rechaza con 400, no se guarda nada); editar la comisión de un depto no toca meses cerrados (la hoja usa el snapshot).
Plan 028: feature pedida por el usuario, definida con `grill-me` el 2026-10-14 (decisiones en el plan).
Plan 027: revisión de la fase 5d (servidor/terminal), 2026-10-13.
Plan 025: revisión de cierre, transferencias y PDF (fase 5c), 2026-10-12.
Plan 024: revisión de movimientos y cuentas (fase 5b), 2026-10-12.
Planes 020-023: revisión de la liquidación del mes abierto (fase 5a), 2026-10-12.
Planes 011-019: auditoría `improve deep` de las fases 1-4, 2026-10-12. Orden: 011 → 019.

Orden recomendado: 001 → 002 → 003 → 004 → 005. 004 reutiliza la función
`respaldar` de 003; 005 agrega middlewares al final de `crearApp`, después del
de 002.

## Considerados y descartados
- Fase 6 (revisión 2026-10-13, sin hallazgos para planificar): el resultado de Hornera no suma filas HOR/CAN de CORRIENTE porque el importador las descarta con aviso; en abril 2026 no hay ninguna. Revisar si aparecen en otros meses. La definición del resultado queda como pregunta a los dueños (DECISIONES, "Pendiente").
- Fase 5d: datos que no se actualizan solos entre PCs (sin WebSocket) y PDF que quedan en el servidor si los pide una terminal: decididos y documentados en DECISIONES ("Red").
- Fase 5d: el nombre de la terminal en la auditoría lo elige la terminal (se puede repetir o imitar): la auditoría no es un control de seguridad, no hay login.
- Saldo de cuenta solo con pagos "completed" (la liquidación cuenta todo lo no "pending"): a propósito, la cuenta muestra la plata que ya entró.
- Conceptos con errores de tipeo se dan de alta solos: cómodo para cargar; si se ensucian, una pantalla para depurarlos.
- Cambiar la moneda de un medio de pago con pagos cargados: es para corregir; no toca meses cerrados.
- Aviso de tamaño del bundle de Vite: app de escritorio local, no viaja por red.
- CORS: el navegador ya bloquea leer respuestas de otro origen; el único vector
  de lectura es DNS rebinding (plan 002).
- Avisar fechas de CORRIENTE fuera del período (p. ej. pagos de D25 y PRO
  tipeados 10/11/2025): descartado por el usuario, se importan tal cual.
- Efectivo en Stays cuenta como ARS: Stays no informa la moneda del pago, los
  scripts hacían lo mismo y la moneda del medio se edita en la app (la sync no la pisa).
- Traer un mes anterior a los importados crea un período abierto: se avisa; caso raro.
- Tests del importador con un Excel sintético: hoy usan el export real (no está
  en git) y se saltean sin él. Retomar cuando llegue otro mes con variaciones.
- "Traer mes" modifica reservas de meses cerrados por importación: el snapshot de la
  liquidación guarda sus totales; no se ve afectado.
- Fechas de fin de mes que se corren al crear un período: los parámetros se editarán en la fase 5.
- Excel malicioso que cuelga la app: son archivos propios.
- Import/sync bloquean la ventana: abril tarda ~260 ms; medir si crece.
- Cerrar la app durante un "traer mes": falla antes de escribir, no deja nada a medias.

## Pendiente de verificar (sin plan)
- Que Electron empaquetado (asar) corra los `.ts` con type stripping. Verificar
  al armar el instalador; si no, compilar `electron/` y `server/` con `tsc`.

## Decisiones pendientes del usuario (auditoría 2026-10-12)
- Reescribir el historial de git para sacar un nombre y un DNI reales (commits 5df0021 a 589b9b1).
- Backups en texto plano en Drive y `reserva.raw_json` con datos de huéspedes que la app no usa.
- Montos reales de abril fijados en `server/importador/excel.test.ts`.
- Skills de terceros versionados en `.claude/skills/` (difieren de las copias del usuario).

## Para más adelante
- Estados de pago reales de Stays (hoy cuenta todo lo que no es "pending").
- Redondeo a centavos al guardar la liquidación del motor (fase 5).
- Fuses de Electron e integridad del asar al armar el instalador.
