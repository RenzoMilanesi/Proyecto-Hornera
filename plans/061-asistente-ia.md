# 061 — Asistente con IA (Claude) para consultar la app: fase 1, solo lectura

Escrito contra `7baa8c5` (2026-10-23). P2 · L. Depende de: —.

## Por qué
Hoy, para responder "¿cuánto se le liquidó a X en abril?", "¿qué depto tuvo más ocupación?" o "¿cómo emito una
NC?" hay que saber en qué pantalla mirar y cruzar datos a mano. Un asistente dentro de la app contesta en lenguaje
natural con los datos de la base y el manual.

La "capa intermedia" **no es un filtro de texto** (se engaña con palabras): la IA nunca toca la base; solo llama a
**herramientas** que define el servidor, y en la fase 1 **ninguna escribe**. Por más que la engañen, no hay con qué
romper nada.

## Decisiones del usuario (grill-me, 2026-10-23)
1. **Alcance fase 1:** preguntas sobre datos, ayuda de uso (manual) y análisis/informes. **Solo lectura.**
2. **Acciones** (cargar gastos, facturar…): **fase 2**, se diseña después de probar la fase 1. Nada en este plan.
3. **Privacidad:** se mandan todos los datos del negocio, **incluidas las claves de los deptos** (wifi, alarma, caja
   de llaves: `depto_clave`). Queda dicho: esos códigos quedan en el historial y en los servidores de Anthropic.
4. **Nunca se mandan** (decisión técnica, ninguna consulta los necesita): `terminal` (hash del token), toda la tabla
   `configuracion` (ticket de ARCA y la propia elección de modelo), y lo que vive en `safeStorage` (credenciales de
   Stays, claves de ARCA, la API key).
5. **Proveedor:** solo **Claude**, una **API key del negocio** (cuenta en console.anthropic.com, aparte de Claude Pro:
   la suscripción del chat no sirve para la API). Sin OpenAI.
6. **Dónde corre:** en la **PC servidor** (ahí están la base y la key). Las terminales mandan la pregunta por la API
   de la LAN, como todo lo demás; la key nunca viaja.
7. **Costo:** tope mensual en la consola de Anthropic. La app no pone tope propio.
8. **Modelo y esfuerzo elegibles en configuración.** Arranca con **Sonnet 5.5**, esfuerzo `medium`. Si falla en
   análisis → Opus 5.5; si sobra → Haiku 5.5. Cada respuesta muestra **qué modelo contestó** (el que devuelve la
   API, no el configurado), tokens y costo estimado.
9. **Interfaz:** panel lateral (Drawer) global, abrible desde cualquier pantalla; sabe pantalla y mes actuales.
10. **Historial guardado por PC** (se puede retomar una conversación).
11. **Datos:** herramientas armadas para lo importante (reusan las funciones del programa) **+ un SQL de solo
    lectura** para preguntas que ninguna herramienta cubre.
12. **Ayuda de uso:** el manual entero como contexto fijo, con caché de prompt.
13. **Sin internet / sin key / tope alcanzado:** el panel dice "asistente no disponible" y por qué; el resto de la
    app no depende de la IA.
14. **Verificación:** al pie de cada respuesta, qué herramientas/consultas usó (desplegable con el SQL y los
    resultados), para poder chequear el número.
15. **Validación:** las mismas preguntas al asistente y a Claude Pro sobre la base de demo (`manual/seed.ts`),
    **con el mismo modelo** en los dos, y se comparan.

## Reglas del repo (de CLAUDE.md)
- TypeScript sin build: nada de enums, namespaces ni parámetros de propiedad; imports con extensión `.ts`.
- Plata en centavos, fechas ISO. Cambio de esquema: `schema.sql` + `MIGRACIONES` + `schema.check.mjs`, juntos.
- Modales/Drawer: skill `modales`. Datos ficticios en tests. `ponytail:` marca simplificaciones.
- Antes de escribir código contra la API de Claude: skill `claude-api` (no adivinar la forma del SDK).

## Pasos

### 0. Verificaciones previas (antes de escribir nada)
- **`setAuthorizer` en Electron:** `node:sqlite` lo tiene en Node 24.16 (verificado); confirmar que el Node de
  Electron 44 también: `npx electron -e "console.log(typeof require('node:sqlite').DatabaseSync.prototype.setAuthorizer)"`
  (o un `console.log` temporal en `main.ts`). Si no está, ver el plan B en el paso 3.
- Dependencia nueva: `@anthropic-ai/sdk` (única; justifica: tipos, reintentos, errores tipados). No sumar `zod`:
  las herramientas van con JSON Schema a mano.
- **Hecho (2026-10-23):** Electron 44.7 trae Node 24.21 con `setAuthorizer` y `constants`; probado que niega
  `SELECT` sobre una tabla excluida, `DELETE` y `PRAGMA` (el plan B del paso 3 no hace falta).
  `@anthropic-ai/sdk@^1.2.0` en `dependencies`, importa bien; no suma avisos al `npm audit`.

### 1. Esquema (migración siguiente a la última de `MIGRACIONES`)
```sql
-- Conversaciones con el asistente (plan 061), una lista por PC. mensajes_json es el historial tal cual se
-- manda a la API (bloques completos, incluidos los de thinking): solo se agrega al final, nunca se edita.
CREATE TABLE conversacion_ia (
    id             INTEGER PRIMARY KEY,
    pc             TEXT    NOT NULL,                 -- como auditoria.pc: la PC es el usuario
    titulo         TEXT    NOT NULL,                 -- primeras palabras de la primera pregunta
    mensajes_json  TEXT    NOT NULL CHECK (json_valid(mensajes_json)),
    creada_en      TEXT    NOT NULL,
    actualizada_en TEXT    NOT NULL
) STRICT;
CREATE INDEX ix_conversacion_ia_pc ON conversacion_ia(pc, actualizada_en);

-- Una fila por respuesta: qué modelo contestó y cuánto costó, para mostrarlo y comparar modelos.
CREATE TABLE respuesta_ia (
    id               INTEGER PRIMARY KEY,
    conversacion_id  INTEGER NOT NULL REFERENCES conversacion_ia(id) ON DELETE CASCADE,
    modelo           TEXT    NOT NULL,               -- response.model (el que contestó de verdad)
    esfuerzo         TEXT    NOT NULL,
    tokens_entrada   INTEGER NOT NULL,               -- suma de las vueltas del bucle de herramientas
    tokens_cache     INTEGER NOT NULL,               -- cache_read_input_tokens
    tokens_salida    INTEGER NOT NULL,
    herramientas_json TEXT   NOT NULL CHECK (json_valid(herramientas_json)), -- [{nombre, entrada, filas}]
    creada_en        TEXT    NOT NULL
) STRICT;
```
- `schema.check.mjs`: `mensajes_json` inválido falla; borrar la conversación borra sus respuestas.
- Borrar conversación: ruta `DELETE` (es dato propio del asistente, no del negocio; no hace falta auditoría).
- **Hecho (2026-10-23):** migración 20 → 21 (esquema 21), con un índice más `ix_respuesta_ia_conversacion` para el
  borrado en cascada. `schema.check.mjs` y el test de migración desde el esquema 1, al día.

### 2. Configuración y key
- **API key** en `safeStorage`, archivo `anthropic.key` en `userData`, copiando `almacenCredenciales()` de
  `electron/main.ts` (no viaja en los backups). Se pasa a `crearApp` como `opciones.claveIa` (`leer()`/`guardar()`).
- Rutas `GET/PUT /api/ia/clave` con **`soloLocal`** (como `/api/stays/credenciales`): solo desde la PC servidor. El
  GET devuelve si hay key cargada y sus últimos 4 caracteres, nunca la key.
- En `configuracion`: `ia_modelo` (por defecto `claude-sonnet-5-5`) e `ia_esfuerzo` (por defecto `medium`).
  Lista cerrada en el código: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`; esfuerzos `low`,
  `medium`, `high`. Rechazar cualquier otro valor.
- Pantalla: una sección "Asistente" donde ya se configura Stays (key, modelo, esfuerzo, link a la consola para el
  tope de gasto).
- **Hecho (2026-10-23):** la pantalla quedó como sección propia Herramientas → Asistente, solo en la PC servidor
  (como Terminales y Copias), no dentro de Stays. Claves `ia.modelo` / `ia.esfuerzo` (con punto, como `stays.url`).
  El `GET /api/ia/configuracion` sí responde a las terminales (el panel muestra el modelo); el `PUT`, `soloLocal`.
  La lista cerrada y la lectura de la configuración viven en `server/ia/asistente.ts` (el bucle del paso 4 va ahí).

### 3. Herramientas (`server/ia/herramientas.ts`, nuevo)
Cada herramienta = `{ name, description, input_schema, strict: true, correr(db, entrada) }` y **reusa la función
que ya está detrás de la ruta GET** (sin duplicar lógica de negocio). Devuelven **plata en pesos con 2 decimales**
(dividir centavos en un solo lugar, `aPesos()`), para que la IA no tenga que convertir.

| Herramienta | Reusa | Para |
|---|---|---|
| `listar_deptos` / `listar_propietarios` | rutas `/api/deptos`, `/api/propietarios` | resolver "el 3B", "Pérez" a ids |
| `periodos` | `/api/periodos` | qué meses existen y cuáles están cerrados |
| `liquidacion` (mes) | `liquidacionGuardada` / `liquidarPeriodo` (misma regla cerrado/abierto que `/api/liquidacion`) | liquidaciones por depto |
| `hoja_depto` (mes, depto) | `hojaDepto` | detalle de un depto en un mes |
| `reservas` (mes, depto?) | consulta de `/api/reservas` (regla de `server/periodo.ts`) | reservas del período |
| `resumen_mes` (mes) / `evolucion` / `resumen_hornera` (mes) | `server/resumen.ts` | KPIs, ocupación, resultado de Hornera |
| `movimientos` (mes) / `gastos_ajenos` (mes) / `transferencias` (mes) | sus `listar…` | plata que entró y salió |
| `historial_pagos` (depto o propietario) | `historial` | pagos a lo largo del tiempo |
| `ficha_depto` (depto) | `ficha` (incluye `depto_clave`, decisión 3) | servicios, claves, contactos |
| `vencimientos` (mes) | `vencimientos` | qué vence |
| `limpieza_horas` (desde, hasta) / `limpieza_liquidaciones` | `server/limpieza.ts` | horas y pagos de limpieza |
| `comprobantes` (mes) / `mis_comprobantes` (mes) | `listarComprobantes`, `listarMisComprobantes` | lo facturado |
| `consulta_sql` (sql) | — | lo que ninguna otra cubre |

**`consulta_sql`** — la única herramienta "libre", con tres cercos:
1. Conexión **aparte** `new DatabaseSync(ruta, { readOnly: true })`, abierta una vez: aunque el texto diga
   `DELETE`, SQLite no escribe.
2. `setAuthorizer` en esa conexión: niega `SQLITE_READ` sobre `terminal` y `configuracion`, y toda acción que no
   sea `SELECT`/`READ`/`FUNCTION` (bloquea `ATTACH`, `PRAGMA`, etc.). Plan B si Electron no trae `setAuthorizer`:
   rechazar el SQL que nombre esas tablas o no empiece con `SELECT`/`WITH`
   (`ponytail:` chequeo por texto, se esquiva con alias raros; cambiar a `setAuthorizer` cuando esté).
3. Tope de **200 filas** y **5 s** (`statement.iterate()` cortando por filas; el tiempo con `Date.now()` entre
   filas). Si se corta, decirlo en el resultado ("primeras 200 filas").
- La descripción de la herramienta lleva el `schema.sql` resumido (tablas y columnas, **sin** las dos excluidas) y
  avisa: plata en **centavos**, fechas ISO, y que para "reservas de un mes" use la herramienta `reservas` (la regla
  del período no es trivial en SQL).
- Errores de SQL → `tool_result` con `is_error: true` y el mensaje de SQLite, para que la IA corrija.
- **Hecho (2026-10-23), con cuatro cambios:**
  - **Plata en centavos, no en pesos.** Convertir por nombre de campo resultó frágil (`total` son noches en
    `hoja.noches` y plata en limpieza; `plus.valor` son minutos o pesos según el modo; `cotizacion` no es centavos).
    Cada descripción avisa "enteros en CENTAVOS, dividí por 100". Revisar en la validación (paso 9): si la IA divide
    mal, cada función declara sus campos de plata.
  - `consulta_sql` abre la conexión de solo lectura **en cada consulta** y la cierra (no una vez: dejaba el archivo
    tomado en Windows). El esquema de la descripción se arma de `sqlite_master` sin las tablas ocultas.
  - El SQL de las rutas GET de deptos, propietarios, períodos, cuentas, reservas y liquidación pasó a
    `server/consultas.ts`; la ruta y la herramienta llaman a la misma función.
  - Se sumó `cuentas` (saldos); `gastos_ajenos` se llama `gastos_personales` (como en el menú); `hoja_depto` sin el QR
    de las facturas (35 KB de SVG); `reservas` sin `desglose_json`. Los deptos se piden por código, no por id.

### 4. El bucle (`server/ia/asistente.ts`, nuevo)
Leer antes `claude-api` → `typescript/claude-api/README.md` y `tool-use.md`. Bucle manual (no hace falta el Tool
Runner):
- `system`: (a) reglas cortas — responder en español rioplatense, **todo número sale de una herramienta, nunca
  inventar ni estimar**, si no hay herramienta para algo decirlo, montos con `$` y separador de miles, no mencionar
  ids internos; (b) el **manual** como texto (de `manual/manual.html` sin etiquetas, leído una vez al arrancar), con
  `cache_control` (es lo más grande y no cambia). Orden fijo: herramientas → system → mensajes, nada variable antes
  del caché (ni la fecha: va en el mensaje del usuario).
- Cada pregunta: mensaje `user` con `[Pantalla: Liquidación · Mes: 2026-09 · Hoy: 2026-10-23]` + la pregunta.
- `messages.create` con `model`/`output_config.effort` de `configuracion`, `thinking: { type: 'adaptive' }`,
  `max_tokens: 16000`, `tool_choice` `auto` (los modelos 5.5 rechazan `any`/`tool`).
- Fallback por negativa: para Sonnet/Opus 5.5, `fallbacks: 'default'` con su beta (ver la skill; Haiku no lo
  soporta). Si igual vuelve `stop_reason: 'refusal'`, mostrar "el asistente no puede responder eso".
- Mientras `stop_reason === 'tool_use'`: correr **todas** las herramientas pedidas, devolver todos los
  `tool_result` en **un** mensaje `user`, repetir. Tope **10 vueltas** (si se pasa, responder con lo que haya y
  avisar). Agregar siempre `response.content` completo al historial (append-only: no reescribir mensajes viejos, o
  se invalidan los bloques de thinking y el caché).
- Al terminar: guardar `mensajes_json`, una fila en `respuesta_ia` (modelo de `response.model`, tokens sumados de
  todas las vueltas, herramientas usadas) y devolver `{ texto, modelo, tokens, costo, herramientas }`.
- Costo estimado: tabla de precios por modelo en el código (`ponytail:` precios a mano de 2026-10; el número real
  está en la consola). Cache leída al precio de caché.
- Errores tipados del SDK → mensaje claro: key inválida (`AuthenticationError`), tope/saldo (`RateLimitError` /
  400 de facturación), sin conexión (`APIConnectionError`). Nada se guarda si falla.
- **Hecho (2026-10-23):** `preguntar()` en `server/ia/asistente.ts`, con el cliente inyectable (`ClienteIa`) para los
  tests. Va por `client.beta.messages` (el respaldo por rechazo es beta). Diferencias: un rechazo no se guarda (la
  respuesta puede venir vacía y el historial quedaría inválido); `max_tokens` cortado avisa; la escritura de caché se
  cuenta como entrada en el costo. `herramientas_json` guarda `{id, nombre, entrada, filas, error}`: el resultado
  completo está en `mensajes_json` (mismo `id` que el `tool_use`) para el desplegable "Cómo lo calculé".

### 5. Rutas (`server/app.ts`)
- `POST /api/ia/preguntar` `{ conversacion_id?, pregunta, pantalla, mes }` → respuesta. Funciona desde terminales
  (no `soloLocal`); la `pc` sale de cómo ya se identifica la PC para la auditoría.
- `GET /api/ia/conversaciones` (de esta PC), `GET /api/ia/conversaciones/:id`, `DELETE /api/ia/conversaciones/:id`
  (solo las de la misma PC).
- `GET /api/ia/estado` → `{ disponible, motivo? }` (sin key / sin conexión), para el panel.
- Una pregunta a la vez por conversación (si llega otra mientras corre, 409).
- **Hecho (2026-10-23, v0.43.0):** la PC es `pcActual` (terminal) o `nombrePc` (servidor); al renombrar la PC servidor
  su historial la sigue. `GET /api/ia/conversaciones/:id` arma `turnos` (pregunta, texto, modelo, tokens, costo,
  herramientas) emparejando cada pregunta con su fila de `respuesta_ia`. `estado` solo mira la key (`ponytail:`).

### 6. Interfaz (`src/Asistente.tsx`, nuevo; skill `modales`)
- Botón fijo en el layout de `App.tsx` que abre un **Drawer** a la derecha; pasa pantalla y mes actuales.
- Arriba: "Nueva conversación" + desplegable con el historial de esta PC.
- Burbujas de chat (texto con markdown simple; las tablas de la IA como tabla). Al pie de cada respuesta, en gris:
  `Sonnet 5.5 · 3 consultas · US$ 0,02`, con un desplegable "Cómo lo calculé" (herramientas, entradas, SQL).
- "Pensando…" mientras espera (sin streaming en la fase 1: `ponytail:` respuesta completa de una vez; streaming si
  las esperas molestan).
- Sin key: el panel explica cómo cargarla (y que solo se hace desde la PC servidor).

### 7. Empaquetado
- **Hecho en el paso 4.** Sumar `manual/manual.html` a `build.files` en `package.json` (hoy no viaja en el instalador). Sin el archivo, el
  asistente arranca igual, sin la parte de ayuda de uso (aviso en consola).

### 8. Tests (`server/ia/*.test.ts`, sin llamar a la API real)
- `consulta_sql`: `DELETE`/`UPDATE`/`ATTACH`/`PRAGMA` fallan; `SELECT * FROM terminal` y `FROM configuracion`
  fallan; un `SELECT` válido devuelve filas; el tope de 200 filas corta y lo dice.
- Cada herramienta devuelve pesos (no centavos) y respeta la regla cerrado/abierto de la liquidación.
- Bucle con un cliente falso (inyectar el `messages.create`): dos `tool_use` en una vuelta → un solo mensaje con
  dos `tool_result`; el tope de 10 vueltas corta; se guarda `response.model` y no el modelo configurado.
- Rutas: `PUT /api/ia/clave` desde una terminal → 403; conversaciones de otra PC no se ven ni se borran.

### 9. Validación con el usuario (decisión 15)
- Base de demo: `node manual/seed.ts <carpeta>`.
- Archivo `plans/061-preguntas.md` con 15–20 preguntas reales de la oficina (las juntan el usuario y su hermano),
  la respuesta esperada (sacada de la app) y, por modelo probado, lo que contestó el asistente y Claude Pro.
- Criterio: cero números inventados; si una pregunta falla por falta de herramienta, se agrega la herramienta.

### 10. Docs
- `DECISIONES.md`: las decisiones de arriba (sobre todo 3, 4 y "la IA no escribe").
- Manual: sección corta "Asistente" (cómo cargar la key, qué puede y qué no, que los datos salen a Anthropic).
  Capturas al final de la tanda.

## Fuera de este plan
- **Fase 2 — acciones** (proponer un cambio y confirmarlo con un botón): plan aparte cuando la fase 1 esté probada.
- OpenAI u otros proveedores. Streaming. Tope de gasto propio en la app. Anonimizar datos.
