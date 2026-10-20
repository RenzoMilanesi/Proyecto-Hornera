# Plan 031: Facturación electrónica con ARCA (honorarios a propietarios)

> **Executor instructions**: Seguí las etapas en orden; cada una termina con `npm test` y
> `npm run typecheck` en verde y se puede commitear sola. Si aparece una condición STOP, frená
> y reportá: no improvises. Al terminar, marcá el estado en `plans/README.md`.
>
> **Drift check (correr primero)**:
> `git diff --stat ce7e16c..HEAD -- schema.sql server/db.ts server/app.ts server/liquidacion/pagos.ts server/movimientos.ts electron/main.ts src/Propietarios.tsx src/Transferencias.tsx src/Imprimir.tsx`
> Si alguno cambió, compará con lo que dice "Estado actual"; si no coincide, STOP.

## Status
- **Priority**: P2 · **Effort**: L · **Risk**: MED (esquema nuevo, red externa, certificados) · **Depends on**: —
- **Category**: direction (feature)
- **Planned at**: commit `ce7e16c` (v0.16.1), 2026-10-16. Definido con `grill-me` el mismo día.

## Por qué
Lautaro y Amancay facturan a mano, en "Comprobantes en Línea" de ARCA, los honorarios que Hornera
le cobra a cada propietario. Este plan permite facturar desde la app en el momento de pagar la
liquidación de un depto, con el CAE, el QR y el PDF, sin entrar a la web de ARCA.

## Decisiones ya tomadas con el usuario (no reabrir)
| Tema | Decisión |
|---|---|
| Qué se factura | Los honorarios (comisión) de Hornera, al propietario |
| Emisores | Dos: **Lautaro** y **Amancay**, cada uno con su CUIT. Hoy los dos son monotributistas (**Factura C**), pero la condición se configura por emisor y el sistema soporta RI (A/B) |
| Quién emite | Se **elige en cada factura** (sin emisor por defecto atado al propietario o al depto) |
| Alcance | Una factura se ata a la **liquidación de un depto** (`liquidacion.id`). Un propietario con varios deptos recibe varias |
| Cuándo | **Al pagar**: "Marcar pagado" ofrece la factura (emisor e importe editables) y se puede emitir o saltear. Se puede facturar después desde la fila del pago |
| Pagos parciales | **Una factura por pago**. Importe propuesto = honorarios × (pago ÷ saldo de la liquidación), redondeado a centavos |
| Importe | Libre: se propone y se edita |
| Tope | Si lo facturado de la liquidación supera los honorarios: **avisa y deja** emitir |
| Sin pago | Liquidación con saldo ≤ 0 (no hay transferencia): **no se factura** |
| Moneda | **Siempre en pesos** (`PES`), también para deptos que liquidan en USD. Los honorarios ya están en ARS |
| Receptor | Sección **Datos fiscales** en la ficha del propietario: razón social, tipo y número de documento (CUIT/DNI), condición IVA, domicilio. Sin esos datos no se puede facturar |
| Padrón | Botón **"Consultar ARCA"** en esa sección: completa los datos desde `ws_sr_constancia_inscripcion` (solo producción) con el certificado de cualquier emisor configurado |
| Certificado | Generado **a mano con openssl** (manual de Roble, ver Referencias). En la app se cargan `.crt` y `.key` por emisor |
| PDF | **PDF suelto** de la factura **y** una página más en el PDF de la liquidación del depto |
| Anular un pago facturado | La app **ofrece la Nota de Crédito C** de esa factura. Si se saltea, la factura queda marcada "pago anulado, factura vigente" hasta resolverla |

## Decisiones técnicas (tomadas al planificar, no consultadas)
- **Transporte**: WSFEv1 directo, sin intermediarios. Se porta `electron/arca.js` de Roble
  (en producción) a `server/arca.ts` y lo necesario de `electron/fiscal.js` a `server/fiscal.ts`.
- **Clave privada**: cifrada con `safeStorage`, en un archivo por emisor en `userData`
  (`arca-<cuit>.key`), igual que `stays.cred` (`electron/main.ts`, `almacenCredenciales`). No va a
  la base ni a los backups. El `.crt` es público: puede ir en la base.
- **Quién emite**: solo la PC servidor habla con ARCA; las terminales llaman a la misma API.
- **Concepto 2 (servicios)**: `FchServDesde`/`FchServHasta` = primer y último día del mes liquidado;
  `FchVtoPago` = fecha de emisión; `CbteFch` = fecha del pago (ARCA admite ±10 días en servicios;
  si la fecha del pago queda fuera de rango o es anterior al último comprobante del punto de venta,
  usar hoy y avisar).
- **Fallas**: el pago se registra igual. Si ARCA rechaza o no hay red, el intento queda guardado
  como `rechazado` y la factura queda **pendiente**, reintentable desde Transferencias. Se guardan
  todos los intentos (request sin `<Auth>` y response), como en Roble.
- **Ambiente**: por emisor, `homologacion` o `produccion`. Se prueba entero en homologación primero.
- **Auditoría**: emitir, reintentar, NC y cambios de emisor pasan por `auditar` (`server/auditoria.ts`).
- **Dependencias nuevas**: `node-forge` (firma CMS del WSAA; Node no trae PKCS#7) y `qrcode` (QR de
  la RG 4892). Las dos son las que usa Roble.

## Estado actual (lo que hay que tocar)
- `schema.sql`: `propietario` tiene `cuit`, `documento` (texto libre), `categoria_fiscal`
  (`RM/RI/CF/EX/NI`). No hay emisores ni comprobantes.
- `server/liquidacion/motor.ts:138`: `honorarios` en centavos ARS, **negativo** (se resta). Se guarda
  en `liquidacion.honorarios` al cerrar el mes.
- `server/liquidacion/pagos.ts`: `listarTransferencias` (saldo, pagado, pendiente, pagos) y
  `pagarLiquidacion` (crea el movimiento `tipo = 'liquidacion'`). Solo meses cerrados.
- `server/movimientos.ts:123` `anularMovimiento`: anula también los pagos de liquidación.
- `electron/main.ts:74` `generadorPdf`: PDF por depto con `printToPDF` sobre la vista imprimible
  (`src/Imprimir.tsx`).

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan, `schema OK` |
| App | `npm run dev` (o `npx electron . --user-data-dir=<tmp>`) | abre |

## Etapas

### 1. Esquema (una migración) — HECHA (migración 9 → 10, v0.17.0)
Cambios respecto de lo de abajo, al implementarla: `comprobante` se ata a `periodo_id + depto_id`
(+ `propietario_id`), no a `liquidacion_id`, porque reabrir un mes borra y recrea sus liquidaciones;
y el ticket de acceso se cachea en `configuracion` (clave/valor), sin tabla `ta_arca`.

En `schema.sql` + `MIGRACIONES` (`server/db.ts`) + `schema.check.mjs`, juntos:
- `emisor`: `id`, `nombre` (Lautaro/Amancay), `razon_social`, `cuit`, `condicion_iva`
  (`monotributista|responsable_inscripto|exento`), `punto_venta`, `domicilio`, `ingresos_brutos`,
  `inicio_actividades`, `ambiente` (`homologacion|produccion`), `cert_pem`, `activo`.
- `propietario` + columnas de receptor: `fiscal_razon_social`, `fiscal_doc_tipo` (80 CUIT, 96 DNI),
  `fiscal_doc_nro`, `fiscal_condicion_iva`, `fiscal_domicilio`. No se tocan `cuit`/`documento`/
  `categoria_fiscal` existentes (los usa el importador); la sección nueva los propone como valor
  inicial.
- `comprobante`: una fila por **intento**. `liquidacion_id`, `movimiento_id` (el pago: siempre hay
  uno), `emisor_id`, `cbte_tipo`,
  `punto_venta`, `numero`, `cae`, `cae_vencimiento`, `fecha`, `serv_desde`, `serv_hasta`,
  `importe` (centavos), `receptor_json` (copia congelada), `estado` (`aprobado|rechazado`),
  `ambiente`, `motivo`, `observaciones`, `request_json`, `response_json`, `asociado_id` (NC → factura),
  `creado`. CHECK como Roble: aprobado ⇔ numero, cae y vencimiento no nulos.
- `ta_arca` (o claves en una tabla de config existente): token, sign y vencimiento del ticket por
  `ambiente + cuit + servicio` (el TA dura 12 h y pedir otro vigente da error).

Verificación: `npm test` (incluye `schema.check.mjs`).

### 2. Transporte y reglas fiscales (sin UI) — HECHA
Al implementarla: `fetch` se inyecta por llamada (`fetch?` en los argumentos de cada función).
`solicitarCAE` exige `servDesde`/`servHasta`/`vtoPago` salvo en Concepto 1 (sale con error `config`
sin pegarle a ARCA). `fechaComprobante` usa la ventana de 10 días de servicios (Roble: 5).
De `facturacion.js` de Roble se trajeron las reglas puras: `esErrorDeToken` (600/601 o mensaje del
WSAA: descartar el ticket cacheado) y `esReintentable` (red o ticket). Queda para la etapa 5, que
tiene la base: cachear el ticket por `ambiente + cuit + servicio` con 60 s de margen (Roble:
`TA_MARGEN_MS`), descartarlo ante `esErrorDeToken`, y pedir `consultarComprobante` del último
autorizado para el piso de la fecha. `qrcode` se instala en la etapa 7 (`qrArca` solo arma la URL).
- `server/arca.ts`: porte de `electron/arca.js` (TypeScript sin enums ni clases con parámetros de
  propiedad; `ErrorArca` como clase simple). Mantener: `tls.DEFAULT_CIPHERS = 'DEFAULT:!DH'`, el
  regex `(?=[ />])`, la doble decodificación del padrón, el orden de elementos de `FECAESolicitar`
  y `CondicionIVAReceptorId`. Agregar a `solicitarCAE` los campos de Concepto 2
  (`FchServDesde`, `FchServHasta`, `FchVtoPago`) y el parámetro `concepto`.
- `server/fiscal.ts`: `tipoComprobante`, `notaCreditoDe`, `desglosarIva` (C: sin array Iva),
  `validarCuit`, `qrArca`, mapeo de condición IVA a `CondicionIVAReceptorId`.
- Tests portados de Roble (`tests/arca.test.js`, los de `fiscal`) a `server/arca.test.ts` y
  `server/fiscal.test.ts`. Nada de red en tests: `fetch` inyectable, como `fetchDolar` en `crearApp`.

### 3. Emisores y certificados — HECHA
Al implementarla (`server/emisores.ts`, pantalla `src/Emisores.tsx` en Datos): también `POST /api/emisores`
(alta). El CUIT no se edita (otro CUIT = otro emisor). Cambiar de ambiente borra el certificado (el de
homologación no vale en producción). Cargar el certificado es `soloLocal` (la clave no viaja por la red)
y rechaza uno vencido. El ticket de acceso ya se cachea acá (`ticketAcceso`, `configuracion`
`arca.ta.<servicio>.<ambiente>.<cuit>`, 60 s de margen, un pedido por clave a la vez) y se descarta
ante `esErrorDeToken`: la etapa 5 lo reusa con `emisorConClave` + `ticketAcceso`. Probado contra el
WSAA real de homologación con un certificado autofirmado: llega y muestra el rechazo de ARCA.
- `electron/main.ts`: `almacenClaves()` análogo a `almacenCredenciales()` (`arca-<cuit>.key` con
  `safeStorage`), pasado a `crearApp` en `opciones`.
- API: `GET/PUT /api/emisores`, `POST /api/emisores/:id/certificado` (recibe `.crt` y `.key`; valida
  con node-forge que la clave corresponda al certificado y que el CUIT del certificado sea el del
  emisor; guarda el crt en la base y la key cifrada), `POST /api/emisores/:id/probar`
  (`FECompUltimoAutorizado`: confirma certificado, `wsfe` autorizado y punto de venta).
- UI: pantalla o modal "Emisores" (skill `modales`). Muestra vencimiento del certificado y avisa a
  30 días.

### 4. Datos fiscales del propietario — HECHA
Al implementarla (`server/propietarios.ts`, botón "Datos fiscales" en `src/Propietarios.tsx`): `GET/PUT
/api/propietarios/:id/fiscal`. Sin datos guardados, el GET propone los del Excel (CUIT válido → 80, si no el
primer número de 7-8 dígitos de `documento` → 96; `categoria_fiscal` → condición). Se puede guardar
incompleto (la etapa 5 exige todo al emitir), pero CUIT con dígito verificador, DNI de 7-8 dígitos y un
inscripto o monotributista solo con CUIT. El padrón recibe el CUIT del formulario y responde con la lógica
de Roble (no existe / servicio no habilitado / sin respuesta; el TA del padrón se descarta ante error de
token); no cachea la constancia como Roble (`cliente_padron`): se consulta a mano y pocas veces.
- Sección "Datos fiscales" en la ficha (`src/Propietarios.tsx`, skill `modales`) + validación de
  CUIT (dígito verificador).
- `POST /api/propietarios/:id/padron`: consulta `ws_sr_constancia_inscripcion` con el primer emisor
  en producción; completa sin guardar (el usuario confirma). En homologación responde "solo en
  producción".

### 5. Emitir al pagar — HECHA
Al implementarla (`server/facturacion.ts`, `GET/POST /api/pagos/:id/factura`, modal `FormFactura` en
`src/Transferencias.tsx`): se ata al pago (`movimiento_id`), no a `liquidacion.id`. Lo facturado y "este pago
ya tiene factura" se cuentan **por ambiente**: una factura de homologación es de prueba (se muestra "prueba
n.º") y no impide la de producción. Cada intento queda en `comprobante`, también las fallas de red (login,
último autorizado o el pedido del CAE); un timeout al pedir el CAE guarda lo pedido sin ticket en
`request_json` con `response_json` NULL, que es lo que mira la regla 3 del plan 033 (respuesta 409 con
`revisar`; la UI ofrece "Ya lo revisé: emitir igual"). Lock global en memoria (`ponytail:`), no por emisor.
`notaCredito` pasa a la etapa 6 (con la regla 2 del plan 033). La factura se ofrece solo desde
Transferencias (no desde el Historial). Probado en la app contra el WSAA real de homologación con un
certificado autofirmado: el rechazo ("Certificado bloqueado") queda guardado y la fila muestra "Reintentar".
> Cumplir también el [plan 033](033-arca-fechas-servicio-y-cae-perdido.md): FchVtoPago = CbteFch, fechas de servicio en la NC, CAE perdido por timeout.
- `server/facturacion.ts`:
  - `propuesta(liquidacionId, importePago)`: honorarios (`-honorarios` de la liquidación), ya
    facturado (aprobados − NC), importe propuesto = `round(honorarios × pago ÷ saldo)`, aviso si
    ya facturado + propuesto > honorarios. Saldo ≤ 0 → no se ofrece.
  - `emitir({ liquidacionId, movimientoId, emisorId, importe })`: valida datos del receptor y del
    emisor; TA cacheado; `ultimoAutorizado + 1`; `solicitarCAE`; guarda el intento. Una sola
    emisión a la vez por emisor (`ponytail:` lock global en memoria; por emisor si hiciera falta).
  - `notaCredito(comprobanteId)`: NC C asociada (`CbtesAsoc`), mismo emisor e importe.
- `src/Transferencias.tsx`: después de "Marcar pagado", modal "Facturar este pago" con emisor
  (select), importe propuesto editable, aviso de tope y botones Emitir / Ahora no. En cada pago:
  estado de su factura (emitida n.º / pendiente / rechazada con motivo) y "Facturar" o "Reintentar".
- Test: pago parcial 50 % propone la mitad; segundo pago propone su parte; superar honorarios da aviso
  y no error; saldo ≤ 0 no ofrece; rechazo de ARCA deja intento `rechazado` y el pago intacto.

### 6. Anulación — HECHA
Al implementarla: `notaCredito` (`POST /api/comprobantes/:id/nota-credito`) comparte con la factura el núcleo
`autorizar` (lock, ticket, piso de fecha, regla 3 del plan 033, intentos guardados). La NC lleva `CbtesAsoc`,
la letra de la factura (`notaCreditoDe`), su receptor congelado, su importe y su período de servicio, con fecha
de hoy (regla 2 del plan 033); solo para la factura de un pago **anulado** (`ponytail:`: corregir el importe de
un pago vigente no se pidió) y en el ambiente de la factura. La marca: `listarTransferencias` incluye los pagos
anulados con factura vigente (`anulado: true`, no suman a lo pagado), así Transferencias e Historial los
muestran siempre con "Emitir nota de crédito" y el motivo de la última NC rechazada. Movimientos no ofrece
la NC: ahí solo se anula en el mes abierto, y los pagos de liquidación son de meses cerrados. Probado en la app
con una factura de homologación sembrada: anular ofrece la NC, el rechazo de ARCA deja la marca con el motivo.
> Cumplir también el [plan 033](033-arca-fechas-servicio-y-cae-perdido.md): FchVtoPago = CbteFch, fechas de servicio en la NC, CAE perdido por timeout.
- `anularMovimiento` no cambia de comportamiento. La API de anular devuelve, si el pago tenía factura
  aprobada sin NC, `{ facturaVigente: comprobanteId }` y la UI ofrece "Emitir nota de crédito".
- Transferencias/Historial marcan "pago anulado, factura vigente" mientras no haya NC.
- `reabrirPeriodo` ya exige que no haya pagos: no hace falta otra regla.
- Test: anular pago facturado deja la marca; emitir la NC la saca.

### 7. PDF — HECHA
Al implementarla: `datosComprobante` (`server/facturacion.ts`, `GET /api/comprobantes/:id`) arma todo lo del papel y
el QR como SVG en el servidor (`qrcode` → `QRCode.create`, sincrónico); la vista es `Comprobante` en
`src/Imprimir.tsx` (`/?imprimir=1&comprobante=ID`). `GET /api/comprobantes/:id/pdf` baja el PDF (botón "PDF" en
cada factura de Transferencias). La hoja del depto suma una página por factura vigente (`Hoja.facturas`); las de
homologación salen marcadas "sin validez fiscal" y solo mientras ningún emisor activo esté en producción
(`ponytail:`), para que las de prueba no lleguen al papel del propietario. Letra A muestra neto e IVA; B y C, el
total. Probado en la app con facturas de homologación sembradas: PDF suelto y hoja con dos páginas de factura.
- Vista imprimible de la factura (en `src/Imprimir.tsx` o una vista hermana): datos del emisor y
  receptor, "FACTURA C", punto de venta-número, fecha, período del servicio, detalle "Honorarios de
  administración — <depto> — <mes>", total, CAE, vencimiento y QR (`qrArca` → `qrcode`).
- `GET /api/comprobantes/:id/pdf` con el `generadorPdf` existente.
- El PDF de la liquidación del depto agrega una página por factura aprobada sin NC.

### 8. Documentación — HECHA
Al implementarla: `GUIA-PRUEBAS.md` sección 9 (trámite en ARCA resumido del manual de Roble, prueba en homologación,
pre-vuelo y primera factura en producción) y bloques de facturación en el checklist del ROADMAP. No se tildó nada:
la verificación en homologación fue en desarrollo; falta la de Lautaro y Amancay con sus certificados.
- `GUIA-PRUEBAS.md`: prueba en homologación (certificado de testing con WSASS) y pre-vuelo en
  producción (manual de Roble §5).
- Checklist del ROADMAP: tildar a medida que se prueba.

## Done criteria
> **Verificado en homologación (2026-10-19)** con el certificado de homologación de Roble (mismo CUIT y punto de
> venta que usa Roble en homologación; los números de prueba se comparten): "Probar" ok; pago → Factura C
> aprobada con CAE (Concepto 2, `FchVtoPago` = `CbteFch`, fecha del pago dentro de la ventana); anular el pago →
> NC C aprobada con `CbtesAsoc` y el período de la factura; PDF de los dos con QR. Pendiente: escanear el QR con
> el celular y el pre-vuelo en producción (etapa 8). Observado: un emisor sin domicilio imprime la factura sin
> "Domicilio comercial", que la RG 1415 pide: cargarlo al dar de alta a Lautaro y Amancay.
- En homologación: pagar una liquidación ofrece la factura, se emite con CAE, se ve el PDF con QR
  y aparece en el PDF del depto; un pago parcial propone su proporción; anular el pago ofrece la NC.
- `npm test` y `npm run typecheck` en verde; ningún test toca la red.
- `grep -rn "BEGIN PRIVATE KEY" schema.sql server/` sin resultados (la clave no va a la base).

## STOP conditions
- ARCA rechaza Concepto 2 sin un campo no previsto acá: STOP con el código de error.
- `safeStorage.isEncryptionAvailable()` es false en la PC servidor: STOP (no guardar la clave en claro).

## Fuera de alcance
- Envío por mail (sigue fuera de la v1).
- Facturar sin pago, facturas libres sin liquidación, otras monedas.
- Generar el CSR desde la app.

## Referencias
- Roble: `Programa Roble/roble/electron/arca.js`, `electron/fiscal.js`,
  `electron/db/repos/facturacion.js` (cola, TA cacheado, fecha vs. último comprobante),
  `docs/investigacion-arca-facturacion.md`, `docs/manual-certificado-arca.md` (trámite del
  certificado, `wsfe`, padrón, renovación cada 2 años).

## Maintenance
ARCA cambia algún campo obligatorio ~1 vez por año (p. ej. `CondicionIVAReceptorId`, RG 5616):
revisar contra Roble, que está en producción y lo absorbe primero.
