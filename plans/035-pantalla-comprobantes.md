# Plan 035: Pantalla "Comprobantes": las facturas y notas de crédito emitidas, mes a mes

> **Executor instructions**: Seguí los pasos en orden; cada uno termina con su verificación. Si aparece una
> condición STOP, frená y reportá: no improvises. Al terminar, marcá A TESTEAR en `plans/README.md` y sumá el
> ítem al checklist de `ROADMAP.md` (sección "Facturación ARCA · Factura al pagar"). Respondé y comentá en
> español. Leé `CLAUDE.md` antes de empezar (datos ficticios, plata en centavos, fechas ISO, TypeScript sin
> build y sin enums, imports con `.ts`, modales con la skill `modales`, commit con la skill `commit-version`).
>
> **Drift check (correr primero)**:
> `git diff --stat 8f3f59a..HEAD -- server/facturacion.ts server/app.ts electron/main.ts src/App.tsx src/Transferencias.tsx schema.sql`
> Si alguno cambió, compará con "Estado actual"; si no coincide, STOP.

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: LOW (solo lectura + reusa acciones existentes; sin cambio de esquema)
- **Depends on**: plan 031 etapas 1 a 7 (hechas)
- **Category**: direction (feature)
- **Planned at**: commit `8f3f59a` (v0.23.0), 2026-10-19. Definido con `grill-me` con el usuario el mismo día.

## Por qué
Hoy una factura solo se ve dentro de su pago en Transferencias, y cuando se emite la NC de un pago anulado ese
pago desaparece de Transferencias: ni la factura anulada ni la NC se ven más en la app (están solo en la tabla
`comprobante` y en ARCA). Tampoco hay forma de ver "lo que facturó Lautaro en octubre" para controlar el tope
de monotributo, ni de volver a bajar el PDF de una NC.

## Decisiones tomadas con el usuario (no reabrir)
| Tema | Decisión |
|---|---|
| Ubicación | Pantalla nueva **"Comprobantes"** en el grupo **Mes** del menú (`src/App.tsx`), después de Historial |
| Período | Selector de mes por **fecha de emisión** (`comprobante.fecha`, el CbteFch): octubre muestra lo emitido en octubre aunque liquide septiembre |
| Contenido | Facturas y NC **aprobadas** + **rechazos pendientes** (ver definición abajo). Los rechazos ya superados no se listan |
| Homologación | Los comprobantes `ambiente = 'homologacion'` **se ven solo con la app sin instalar** (`npm run dev`, `npx electron .`); en el instalador de Windows **nunca** |
| Totales | Arriba: **neto del mes por emisor** (facturas aprobadas − NC aprobadas, en pesos) y cantidad de comprobantes. Los rechazados no suman |
| Acciones por fila | **PDF** (aprobados); **Reintentar** (rechazo pendiente de una factura: abre el modal `FormFactura`); **Emitir nota de crédito** (factura vigente de un pago anulado: abre `FormNotaCredito`); **Ver detalle** (todos: motivo, observaciones, request y response de ARCA) |
| Filtros | **Emisor** (select), **buscador** de texto (depto, propietario, número), **tipo/estado** (Facturas / Notas de crédito / Rechazados). Sin exportar a Excel |
| Factura ↔ NC | **Dos filas cruzadas**, cada una en el mes de su emisión: la factura con etiqueta "anulada por NC 00001-00000005"; la NC con "anula FC 00001-00000016" |

## Definiciones (decididas al planificar)
- **"App sin instalar"**: `!app.isPackaged` de Electron. `electron/main.ts` lo pasa a `crearApp` como opción
  nueva `desarrollo: boolean` (default `false`, así los tests y el instalador no muestran los de prueba salvo que
  el test lo pida). El filtro lo hace el **servidor**, no la UI.
- **Rechazo pendiente**: una fila `estado = 'rechazado'` tal que **no** existe otra fila `aprobado` con el mismo
  `movimiento_id`, `cbte_tipo` y `ambiente`, **y** (si es una factura, `asociado_id IS NULL`) su pago sigue
  vigente (`movimiento.estado = 'vigente'`). De cada pago se muestra **solo el último** rechazo pendiente por
  tipo (no los cinco reintentos). Para una NC rechazada (`asociado_id` no nulo): pendiente mientras su factura
  asociada no tenga una NC aprobada.

## Estado actual (lo que hay que tocar)
- `schema.sql` → `comprobante` (una fila por intento): `periodo_id, depto_id, propietario_id, movimiento_id,
  emisor_id, cbte_tipo (1,3,6,8,11,13), punto_venta, numero, cae, cae_vencimiento, fecha, serv_desde, serv_hasta,
  importe (centavos ARS), receptor_json, estado ('aprobado'|'rechazado'), ambiente, motivo, observaciones,
  request_json (sin <Auth>), response_json, asociado_id (NC → factura), creado_en`. NC = `cbte_tipo IN (3,8,13)`.
  **No cambiar el esquema.**
- `server/facturacion.ts`: exporta `numeroCbte(pv, n)` → `"00001-00000016"`, `SQL_FACTURA_VIGENTE` (condición SQL
  con alias `c`: aprobada, sin NC aprobada), `facturaVigente`, `datosComprobante(db, id)` (solo aprobados; lo usa la
  vista imprimible), `emitir`, `notaCredito`. `NOMBRE_CBTE`/`LETRA_CBTE` están en `server/fiscal.ts`.
- `server/app.ts`: `crearApp(db, version, opciones: { credenciales?, urlStays?, pdf?, fetchDolar?, claves?, fetchArca? })`.
  Rutas existentes: `GET /api/comprobantes/:id` (datosComprobante), `GET /api/comprobantes/:id/pdf`,
  `POST /api/comprobantes/:id/nota-credito`, `POST /api/pagos/:id/factura`. Patrón de ruta sincrónica:
  `app.get('/api/x', (req, res) => intentar(res, () => fn(db, ...)))`. Las rutas nuevas van **antes** del
  `app.use('/api', ... 404)` del final. **Ojo con el orden**: `GET /api/comprobantes` (lista) y
  `GET /api/comprobantes/:id/detalle` no chocan con `/:id`, pero declarar la lista antes de `/:id` igual.
- `electron/main.ts:122`: `crearApp(db, app.getVersion(), { credenciales: almacenCredenciales(), claves: almacenClaves(), pdf: generadorPdf(ORIGEN_LOCAL) })`.
- `src/App.tsx`: `secciones` es un objeto `clave: { grupo, titulo, ayuda, vista }`; agregar
  `comprobantes: { grupo: 'Mes', titulo: 'Comprobantes', ayuda: 'Facturas y notas de crédito emitidas en ARCA, por mes de emisión.', vista: <Comprobantes /> }` después de `historial`.
- `src/Transferencias.tsx` exporta `FormFactura({ a?: { pagoId: number; t: Transferencia }, alCerrar })`,
  `FormNotaCredito({ nc?: { factura: FacturaNC; codigo: string }, alCerrar })`, `type FacturaNC`,
  `EstadoFactura`. `FormFactura` usa de `t` solo `t.codigo` (título) y `t.moneda` (formato del importe del pago).
  Hay también una función local `pdfFactura(id)` (fetch + blob + `<a download>`) dentro de `Transferencias()`.
- Exponente de pantalla con selector de mes, buscador y tabla: `src/Historial.tsx` y `src/Transferencias.tsx`
  (Card de filtros arriba, `Table size="small" pagination={false} sticky`). Drawer de solo lectura: skill `modales`
  ("Drawer: para ver… `size={900}`, `destroyOnHidden`").

## Pasos

### 1. Opción `desarrollo` en `crearApp`
- `server/app.ts`: sumar `desarrollo?: boolean` a `opciones` (default `false`) y desestructurarlo.
- `electron/main.ts:122`: pasar `desarrollo: !app.isPackaged`.
- Verificación: `npm run typecheck` → exit 0.

### 2. `listarComprobantes` en `server/facturacion.ts`
Firma: `listarComprobantes(db, mes: string, desarrollo: boolean)`. Valida `mes` con `/^\d{4}-\d{2}$/` (si no,
`throw new Error('Mes inválido (AAAA-MM).')`). Devuelve `{ filas, totales }`:
- `filas`: una por comprobante con `fecha` entre `${mes}-01` y el último día del mes (comparación de texto ISO,
  `fecha >= ? AND fecha < ?` con el primer día del mes siguiente), que sea aprobado o rechazo pendiente (ver
  "Definiciones"), y `ambiente = 'produccion'` salvo que `desarrollo`. Campos: `id, fecha, tipo` (`NOMBRE_CBTE`),
  `es_nc` (bool), `numero` (`numeroCbte` o null si rechazado), `cae, estado, ambiente, motivo, importe, codigo`
  (depto), `propietario` (`receptor_json.razon_social`, el congelado), `emisor_id, emisor` (nombre),
  `movimiento_id, pago_anulado` (bool, `movimiento.estado = 'anulado'`), `moneda` (del propietario de la
  liquidación: `propietario.moneda_liquidacion`), `anulada_por` (en una factura: número de su NC aprobada, o null),
  `anula` (en una NC: número de su factura), `nc_pendiente` (bool: factura aprobada, vigente, de un pago anulado →
  ofrecer "Emitir nota de crédito"). **Sin** `request_json`/`response_json`/`receptor_json` en la lista.
  Orden: `fecha, id`.
- `totales`: por emisor, `{ emisor_id, emisor, neto, cantidad }` sobre las filas aprobadas (factura suma, NC resta).
- Verificación: `npm run typecheck` → exit 0.

### 3. `detalleComprobante` y rutas
- `detalleComprobante(db, id)`: la fila completa (incluye motivo, observaciones, request_json, response_json,
  receptor parseado); `throw new Error('No existe el comprobante.')` si no está. Ningún token viaja: el request ya
  se guarda sin `<Auth>` (verificalo en el test).
- `server/app.ts`, junto a las rutas de comprobantes:
  `app.get('/api/comprobantes', (req, res) => intentar(res, () => listarComprobantes(db, String(req.query.mes ?? ''), desarrollo)))`
  y `app.get('/api/comprobantes/:id/detalle', (req, res) => intentar(res, () => detalleComprobante(db, Number(req.params.id))))`.
- Verificación: `npm run typecheck` → exit 0.

### 4. Tests en `server/facturacion.test.ts`
Reusar los helpers que ya están en ese archivo (`arcaFalso`, `base`, `conApi`, `pagar`). `conApi` crea la app con
`{ claves, fetchArca }`: agregale un parámetro opcional para pasar `desarrollo` (no rompas los tests existentes).
El emisor de esos tests está en **homologación**, así que los tests de la lista llaman con `desarrollo: true`, y
uno sin `desarrollo` verifica que la lista sale vacía. Casos:
1. Factura aprobada → aparece en el mes de su `fecha` y no en el mes anterior; `totales` del emisor = su importe.
2. Rechazo (fake con `estado.cae = 'rechazo'`) → aparece como rechazo pendiente; después de un reintento aprobado
   (`estado.cae = 'ok'`) ya no aparece y queda solo la factura.
3. Pagar → facturar → anular → la factura tiene `nc_pendiente: true`; emitir la NC → la factura muestra
   `anulada_por` con el número de la NC, la NC `anula` con el de la factura, `nc_pendiente: false`, y el neto
   del emisor es 0.
4. Sin `desarrollo`, la misma base da `filas: []` (los de homologación no se ven en el instalador).
5. `GET /api/comprobantes?mes=mal` → 400 "Mes inválido"; `detalle` no contiene `TK` ni `SG` (token y firma del fake).
- Verificación: `npm test` → todos pasan y `schema OK`.

### 5. Pantalla `src/Comprobantes.tsx`
- Card de filtros arriba (como `Historial.tsx`): `<Input type="month">` o `Select` de meses (default: el mes de
  hoy, `new Date().toLocaleDateString('sv').slice(0, 7)`), `Select` de emisor (de los `emisor` presentes en
  `filas`, con "Todos"), `Select` tipo/estado (Todos / Facturas / Notas de crédito / Rechazados), `Input.Search`
  que filtra por `codigo`, `propietario` o `numero` (en el cliente, como las demás pantallas).
- Debajo de los filtros, una línea por emisor con `totales`: "**Emisor Uno**: $ neto · N comprobantes".
- Tabla: Fecha · Comprobante (`tipo` + `numero`, o `Tag color="red"` "rechazada" + motivo con `ellipsis` y tooltip) ·
  Depto · Propietario · Emisor · Importe (derecha, `pesos` de `src/api.ts`) · CAE · etiquetas (`Tag` "anulada por
  NC …", "anula FC …", "pago anulado", y en desarrollo `Tag` "prueba" si `ambiente = 'homologacion'`) · acciones.
- Acciones: **PDF** (estado aprobado; mover `pdfFactura` de `Transferencias.tsx` a `src/api.ts` como
  `descargarPdfComprobante(id)` que devuelve el mensaje de error o `undefined`, y usarlo en las dos pantallas);
  **Reintentar** (rechazo pendiente de factura, pago vigente) → `FormFactura`; **Emitir nota de crédito**
  (`nc_pendiente`) → `FormNotaCredito` con `{ factura: { id, punto_venta, numero, importe, ambiente, emisor }, codigo }`;
  **Ver detalle** → Drawer (skill `modales`, `size={900}`) con `Descriptions` de los campos y dos bloques `<pre>`
  (request y response, con `whiteSpace: 'pre-wrap'`). Después de cerrar un modal con `cambio`, recargar.
- `FormFactura` hoy pide `t: Transferencia`: cambiar su prop a `a?: { pagoId: number; codigo: string; moneda: 'ARS' | 'USD' }`
  y ajustar los dos lugares de `Transferencias.tsx` que lo abren (`setFacturando({ pagoId, codigo: t.codigo, moneda: t.moneda })`).
  No cambies nada más de `FormFactura`.
- `src/App.tsx`: importar y agregar la sección (ver "Estado actual").
- Verificación: `npm run typecheck` → exit 0; `npm test` → todo verde.

### 6. Probar en la app
- Carpeta temporal con datos ficticios (`npx electron . --user-data-dir=<tmp>`), como en `GUIA-PRUEBAS.md`. Sin
  certificado real alcanza con sembrar filas en `comprobante` por SQL (una factura aprobada, una NC asociada, un
  rechazo) en `ambiente = 'homologacion'`: con `npx electron .` se ven (desarrollo); el filtro, el neto, las dos
  etiquetas cruzadas, el Drawer de detalle y el PDF.
- No generes el PDF de la liquidación del depto durante la prueba: se guarda en `Documentos\Hornera\Liquidaciones`
  real (no depende de `--user-data-dir`).

## Fuera de alcance
- Exportar a Excel, acumulado de 12 meses o alertas del tope de monotributo.
- Cambios de esquema, de `emitir`/`notaCredito`/`autorizar`, de las reglas de los planes 031/033.
- Editar o borrar comprobantes (son inmutables: se corrigen con NC).
- Mostrar los de homologación en el instalador (decidido: nunca).

## STOP conditions
- Si para la lista hace falta una columna que `comprobante` no tiene: STOP (el usuario pidió no tocar el esquema).
- Si `datosComprobante` o las rutas de comprobantes cambiaron de forma respecto de "Estado actual".

## Done criteria
- `npm run typecheck` y `npm test` en verde, con los 5 casos del paso 4.
- En la app sin instalar: "Comprobantes" en el menú Mes muestra factura, NC (con etiquetas cruzadas) y rechazo
  pendiente del mes de emisión, el neto por emisor, PDF, Reintentar, Emitir NC y Ver detalle.
- `grep -n "desarrollo: !app.isPackaged" electron/main.ts` encuentra la línea.

## Maintenance
Si alguna vez se emite fuera de la app (Comprobantes en Línea), esos comprobantes no van a estar en la tabla: la
pantalla muestra lo emitido desde Hornera, no el libro completo de ARCA.
