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

### 1. Esquema (una migración)
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

### 2. Transporte y reglas fiscales (sin UI)
- `server/arca.ts`: porte de `electron/arca.js` (TypeScript sin enums ni clases con parámetros de
  propiedad; `ErrorArca` como clase simple). Mantener: `tls.DEFAULT_CIPHERS = 'DEFAULT:!DH'`, el
  regex `(?=[ />])`, la doble decodificación del padrón, el orden de elementos de `FECAESolicitar`
  y `CondicionIVAReceptorId`. Agregar a `solicitarCAE` los campos de Concepto 2
  (`FchServDesde`, `FchServHasta`, `FchVtoPago`) y el parámetro `concepto`.
- `server/fiscal.ts`: `tipoComprobante`, `notaCreditoDe`, `desglosarIva` (C: sin array Iva),
  `validarCuit`, `qrArca`, mapeo de condición IVA a `CondicionIVAReceptorId`.
- Tests portados de Roble (`tests/arca.test.js`, los de `fiscal`) a `server/arca.test.ts` y
  `server/fiscal.test.ts`. Nada de red en tests: `fetch` inyectable, como `fetchDolar` en `crearApp`.

### 3. Emisores y certificados
- `electron/main.ts`: `almacenClaves()` análogo a `almacenCredenciales()` (`arca-<cuit>.key` con
  `safeStorage`), pasado a `crearApp` en `opciones`.
- API: `GET/PUT /api/emisores`, `POST /api/emisores/:id/certificado` (recibe `.crt` y `.key`; valida
  con node-forge que la clave corresponda al certificado y que el CUIT del certificado sea el del
  emisor; guarda el crt en la base y la key cifrada), `POST /api/emisores/:id/probar`
  (`FECompUltimoAutorizado`: confirma certificado, `wsfe` autorizado y punto de venta).
- UI: pantalla o modal "Emisores" (skill `modales`). Muestra vencimiento del certificado y avisa a
  30 días.

### 4. Datos fiscales del propietario
- Sección "Datos fiscales" en la ficha (`src/Propietarios.tsx`, skill `modales`) + validación de
  CUIT (dígito verificador).
- `POST /api/propietarios/:id/padron`: consulta `ws_sr_constancia_inscripcion` con el primer emisor
  en producción; completa sin guardar (el usuario confirma). En homologación responde "solo en
  producción".

### 5. Emitir al pagar
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

### 6. Anulación
- `anularMovimiento` no cambia de comportamiento. La API de anular devuelve, si el pago tenía factura
  aprobada sin NC, `{ facturaVigente: comprobanteId }` y la UI ofrece "Emitir nota de crédito".
- Transferencias/Historial marcan "pago anulado, factura vigente" mientras no haya NC.
- `reabrirPeriodo` ya exige que no haya pagos: no hace falta otra regla.
- Test: anular pago facturado deja la marca; emitir la NC la saca.

### 7. PDF
- Vista imprimible de la factura (en `src/Imprimir.tsx` o una vista hermana): datos del emisor y
  receptor, "FACTURA C", punto de venta-número, fecha, período del servicio, detalle "Honorarios de
  administración — <depto> — <mes>", total, CAE, vencimiento y QR (`qrArca` → `qrcode`).
- `GET /api/comprobantes/:id/pdf` con el `generadorPdf` existente.
- El PDF de la liquidación del depto agrega una página por factura aprobada sin NC.

### 8. Documentación
- `GUIA-PRUEBAS.md`: prueba en homologación (certificado de testing con WSASS) y pre-vuelo en
  producción (manual de Roble §5).
- Checklist del ROADMAP: tildar a medida que se prueba.

## Done criteria
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
