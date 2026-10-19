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
| 031 | [Facturación electrónica con ARCA (honorarios a propietarios)](031-facturacion-arca.md) | P2 | L | — | EN CURSO (etapas 1 y 2 de 8) |
| 032 | [Una nota de crédito siempre dice qué factura anula](032-nota-credito-con-asociado.md) | P3 | S | 031 (etapa 1) | A TESTEAR |
| 033 | [Fechas de servicio en facturas y NC, y CAE perdido por timeout](033-arca-fechas-servicio-y-cae-perdido.md) | P2 | S | 031 (etapa 2) | PENDIENTE (con etapas 5-6 del 031) |

Los planes 001 a 030 están implementados y con tests; quedan **a testear** a mano en la próxima sesión (ver checklist en `ROADMAP.md`).

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
