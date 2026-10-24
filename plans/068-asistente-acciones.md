# 068 — Asistente con IA, fase 2: acciones con confirmación y comprobantes adjuntos

Escrito contra `c6d496c` (2026-10-24), esquema 22. P2 · L. Depende de: 061 (fase 1, hecha).

## Por qué
La fase 1 contesta preguntas pero no hace nada: para cargar el gasto que el asistente acaba de explicar hay que ir a la
pantalla y tipearlo. La fase 2 deja que el asistente **proponga** cambios y que la persona los **confirme con un botón**.
La IA sigue sin escribir: sus herramientas nuevas solo arman una propuesta, y lo que guarda es el botón Confirmar, con las
mismas funciones (y validaciones) que usan las pantallas.

## Decisiones del usuario (grill-me, 2026-10-24)
1. **Acciones:** movimientos y gastos personales (cargar, corregir, anular); ficha del depto (notas, claves, servicios,
   contactos: agregar, corregir, borrar); traer el mes de Stays; cotización del dólar (pedirla a la API o cargarla a mano).
2. **Cerrar y reabrir el mes, no:** el asistente explica qué falta y dice que se hace en Liquidación; el botón se toca ahí.
3. **Auditoría:** la PC, como siempre, más la marca **"con IA"** ("PC de Lautaro · con IA"). Sin login.
4. **Confirmación:** tarjeta en el chat con el detalle y **Confirmar** / **Editar** (abre el formulario de siempre ya
   completo) / **Descartar**.
5. **Varias acciones:** una tarjeta por acción y **Confirmar todas**. Si una falla, las demás se guardan y se avisa cuál.
6. **Corregir y anular:** sí, y la tarjeta muestra el valor anterior y el nuevo.
7. **Terminales:** también confirman (pasa por la misma API; la auditoría lleva el nombre de la terminal).
8. **Falta un dato** (cuenta, concepto, depto): el asistente **pregunta antes de proponer**; nunca adivina.
9. **Adjuntos:** se puede arrastrar una foto o un PDF al panel; Claude lee fecha, importe y concepto y propone la tarjeta.
10. **El comprobante queda guardado con el movimiento**, y también se adjunta, ve y cambia desde el formulario de
    Movimientos sin el asistente.
- Para más adelante: pagar, facturar, cerrar el mes.

## Decisiones técnicas
- **Confirmar ejecuta en el servidor** la propuesta guardada (`POST /api/ia/propuestas/:id/confirmar`) con las funciones
  de dominio que usan las rutas (`crearMovimiento`, `editarMovimiento`, `anularMovimiento`, `crearGastoAjeno`…,
  `agregar`/`editar`/`borrar` de `server/ficha.ts`, `sincronizarMes`, `actualizarCotizacion`). Así la marca "con IA" la
  pone el servidor y la UI no puede alterar lo propuesto. **Editar** abre el formulario de la pantalla; al guardar, el
  formulario llama a la ruta de siempre con el header `X-Hornera-Ia: <id de la propuesta>` y la propuesta queda
  `editada`.
- **Una corrección vieja no pisa un cambio nuevo:** la propuesta guarda el "antes"; al confirmar se relee el registro y,
  si cambió, se rechaza con "Cambió desde la propuesta: pedila de nuevo".
- **El modelo se entera de lo que pasó** sin tocar el historial: el primer renglón de la pregunta siguiente suma
  `Propuestas: #12 confirmada, #13 descartada` (solo agrega al final; el caché y el thinking siguen valiendo, plan 062).
- **Comprobantes en la base** (tabla `adjunto`, BLOB): viajan solos en el backup y las terminales los ven por la API.
  Las fotos se achican en el navegador antes de subir (lado mayor 1600 px, JPEG 0,8 ≈ 200–300 KB); PDF hasta 5 MB.
- **El historial no guarda la imagen:** el mensaje lleva el id del adjunto y el servidor arma el bloque `image`/
  `document` desde la tabla en cada pedido. `mensajes_json` no crece y el prefijo sigue igual (caché).
- **Tope de 20 herramientas strict** (hoy 16): las propuestas van en **4** (`proponer_movimiento`,
  `proponer_gasto_personal`, `proponer_ficha`, `proponer_mes`), cada una con `accion` (alta/edicion/anulacion…). Quedan
  20: una herramienta más obliga a juntar dos.

## Reglas del repo (de CLAUDE.md)
- TypeScript sin build (sin enums, namespaces ni parámetros de propiedad; imports con `.ts`). Plata en centavos, fechas ISO.
- Cambio de esquema: `schema.sql` + migración en `server/db.ts` (`MIGRACIONES`) + `schema.check.mjs`, juntos.
- Modales con la skill `modales`. Commit por paso con la skill `commit-version` (memoria: commit + push al cerrar cada paso).
- Datos ficticios en tests y comentarios. Las pruebas con la base real van a `plans/068-pedidos.local.md` (ignorado).

## Pasos

### 0. Verificaciones previas
- `anyOf`/`enum` dentro de `input_schema` con `strict: true`: confirmar en la skill `claude-api` (o en un pedido de
  prueba) que se aceptan. Si no, una herramienta por acción no entra en el tope: STOP y replantear el agrupamiento.
- Bloques `image` (base64, jpeg/png/webp) y `document` (PDF base64) en `client.beta.messages.create` con el modelo
  configurado y los betas actuales (`thinking-binding-controls…`, `server-side-fallback…`). Anotar límites de tamaño.
- **Hecho (2026-10-24), con la skill `claude-api` y los tipos del SDK, sin gastar en la API:** strict acepta `enum`,
  `anyOf`, `const` y tipos `['string','null']` (no `minimum`/`maxLength`: esos se validan en el servidor). El SDK trae
  `BetaBase64ImageSource` (jpeg/png/gif/webp) y `BetaBase64PDFSource`. Límites: 5 MB por imagen, PDF hasta 32 MB y 100
  páginas; nuestros topes (fotos achicadas, PDF ≤ 5 MB) quedan muy abajo. La prueba con la API real va en el paso 7.

### 1. Esquema (migración 22 → 23)
- `auditoria.con_ia INTEGER NOT NULL DEFAULT 0 CHECK (con_ia IN (0,1))`.
- `adjunto(id, nombre TEXT, tipo TEXT CHECK (tipo IN ('image/jpeg','image/png','image/webp','application/pdf')),
  datos BLOB NOT NULL, bytes INTEGER, movimiento_id INTEGER REFERENCES movimiento, creado_en TEXT)`, índice por
  `movimiento_id`. Un adjunto sin movimiento es uno subido al panel que todavía no se confirmó.
- `propuesta_ia(id, conversacion_id REFERENCES conversacion_ia ON DELETE CASCADE, tipo, accion, datos_json, antes_json,
  estado CHECK (estado IN ('pendiente','confirmada','editada','descartada','fallida')), resultado TEXT, creada_en,
  resuelta_en)`.
- `schema.check.mjs` y el test de migración (base del esquema 1 migrada = base nueva).
- Las tablas nuevas **no** se exponen a `consulta_sql` (agregarlas a la lista de excluidas de `server/ia/`).
- **Hecho (v0.48.0):** migración 22 → 23; `adjunto` y `propuesta_ia` en `OCULTAS` (`server/ia/sqlProceso.ts`). El test de
  la migración 21 → 22 arma su base vieja sin lo de la 23.

### 2. "Con IA" en la auditoría
- `server/auditoria.ts`: `export const conIa = new AsyncLocalStorage<boolean>()`; `auditar` guarda
  `con_ia = conIa.getStore() ? 1 : 0`. `listarAuditoria` devuelve `con_ia`; `src/Auditoria.tsx` muestra "· con IA".
- `server/app.ts`: middleware que, si viene `X-Hornera-Ia`, corre el pedido dentro de `conIa.run(true, …)` y, al terminar
  bien, marca esa propuesta `editada`. Revisar que el chequeo de Sec-Fetch-Site/Host siga aceptando el header.
- Test: un movimiento creado con el header queda `con_ia = 1`; sin header, 0.
- **Hecho (v0.48.1):** `conIa` en `server/auditoria.ts`, middleware en `server/app.ts` (también marca la propuesta
  `editada`) y la etiqueta "con IA" en la columna Quién de Herramientas → Auditoría.

### 3. Comprobantes en Movimientos (sin IA)
- Rutas: `POST /api/adjuntos` (`express.raw`, límite 6 MB, valida tipo por los primeros bytes, no por el nombre),
  `GET /api/adjuntos/:id` (con su `Content-Type`), y `adjunto_id` opcional en `POST/PUT /api/movimientos` (lo vincula;
  `null` lo desvincula). Auditar el cambio de comprobante en el movimiento.
- `src/Movimientos.tsx`: en el modal, "Adjuntar comprobante" (foto o PDF; la foto se achica con un `<canvas>`), "Ver"
  (abre en otra ventana) y "Quitar"; en la tabla, un ícono en los que tienen comprobante.
- Borrar adjuntos sin movimiento con más de 30 días al abrir la app (los subidos al panel y nunca confirmados).
- Tests: subir, vincular, desvincular; un tipo no permitido se rechaza; el backup incluye el adjunto.

### 4. Herramientas de propuesta (`server/ia/herramientas.ts`)
- Las 4 herramientas validan sin escribir: el depto, la cuenta y el concepto existen; el mes está abierto; para
  edición/anulación leen el registro y guardan el "antes". Insertan la fila en `propuesta_ia` (estado `pendiente`) y
  devuelven `{ propuesta: id, resumen }`. Un error (mes cerrado, depto inexistente) vuelve como `is_error` con el motivo.
- `proponer_mes`: `traer_stays` (mes) y `cotizacion` (mes, `api` o un valor manual). Sin cerrar ni reabrir.
- `preguntar()` (`server/ia/asistente.ts`) devuelve también `propuestas: [...]` con lo necesario para dibujar cada
  tarjeta, y las de una conversación guardada vuelven con `conversacionIa`.
- Reglas nuevas en `REGLAS`: proponer con las herramientas `proponer_*` y **nunca decir que se guardó** (lo guarda la
  persona); si falta cuenta, concepto o depto, preguntar antes; cerrar/reabrir el mes se hace en Liquidación; de un
  adjunto, decir qué no se lee bien en vez de suponer.
- Tests (cliente falso, como en `asistente.test.ts`): una propuesta no escribe nada fuera de `propuesta_ia`; mes cerrado
  y depto inexistente vuelven como error; quedan como mucho 20 herramientas strict.

### 5. Confirmar, descartar y "Confirmar todas" (servidor)
- `POST /api/ia/propuestas/:id/confirmar`: solo `pendiente` y de una conversación de esta PC; relee el "antes" (si cambió,
  `fallida` con el motivo); ejecuta dentro de `conIa.run(true, …)`; si la acción adjunta un comprobante, lo vincula.
  `POST …/descartar`. "Confirmar todas" las confirma de a una, en orden; cada una con su resultado.
- La pregunta siguiente de esa conversación suma al primer renglón el estado de las propuestas resueltas desde la anterior.
- Tests: confirmar crea el movimiento con `con_ia = 1`; dos veces no lo duplica; otra PC no confirma; un registro cambiado
  desde la propuesta se rechaza; en "todas", una que falla no frena a las otras.

### 6. Interfaz (`src/Asistente.tsx`; skill `modales`)
- Tarjeta por propuesta: título por tipo ("Nuevo gasto", "Corregir gasto", "Borrar contacto", "Traer octubre de Stays"),
  la ficha con los campos (en las correcciones, el anterior tachado y el nuevo), estado, y los botones. "Confirmar todas"
  cuando hay más de una pendiente.
- **Editar** abre el modal de la pantalla con los datos de la propuesta. Hace falta exportar los modales de
  `Movimientos.tsx`, `GastosAjenos.tsx` y `Ficha.tsx` con un prop de valores iniciales y otro para el header
  `X-Hornera-Ia`. Si alguno está demasiado pegado a su pantalla, STOP y anotar el refactor antes de seguir.
- Adjuntar en el panel: arrastrar o elegir archivo; se sube a `/api/adjuntos` (foto achicada) y viaja como id con la
  pregunta. Miniatura en la burbuja de la pregunta.
- Después de confirmar, refrescar la pantalla abierta si es la afectada (el mismo evento que usan las pantallas al guardar).

### 7. Validación (como el paso 9 del plan 061)
- `plans/068-pedidos.local.md` (ignorado): 15–20 pedidos sobre la base de prueba con la tarjeta esperada. Incluir
  trampas: mes cerrado, depto que no existe, falta la cuenta (tiene que preguntar), corregir un gasto que se editó a mano
  después de proponer, "cerrá septiembre" (tiene que mandar a Liquidación), un ticket ilegible, un PDF de una factura de luz.
- Criterio: ninguna tarjeta con un dato inventado, y nada se guarda sin Confirmar.

### 8. Docs
- `DECISIONES.md`: sección del asistente, fase 2 (decisiones de arriba). Manual: capítulo 22 (acciones, tarjetas,
  adjuntos) y capítulo 10 (comprobante en el movimiento); capturas al final de la tanda. `ROADMAP.md`, ítem 14.

## Fuera de este plan
Pagar liquidaciones o limpieza, facturar, cerrar o reabrir el mes desde el asistente. Comprobantes en gastos personales.
Login por persona.
