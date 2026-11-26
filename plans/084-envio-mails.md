# Plan 084: Mandar por mail, en lote, la liquidación y la factura de cada propietario

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`. Commit + push al cerrar cada paso (skill `commit-version`).
>
> **Drift check (run first)**: `git log --oneline -3 -- server/app.ts electron/main.ts src/Transferencias.tsx server/liquidacion/pagos.ts`
> Written against v0.60.0 (`3719cbe`). If `GeneradorPdf`, `/api/liquidacion/pdf`, `/api/comprobantes/:id/pdf`,
> `listarTransferencias` or `FormLoteFacturas` no longer match "Current state", STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM (manda mails reales a los propietarios: no se deshace)
- **Depends on**: 082 (hecho; se copia su modal de lote)
- **Category**: feature
- **Planned at**: v0.60.0 (sobre `3719cbe`), 2026-11-26

## Why this matters

A fin de mes la oficina le manda a cada propietario su liquidación (el PDF de la hoja de cada depto) y su factura.
Hoy se generan los PDF con la app y se arma cada mail a mano en Gmail. Con el lote, se revisa una lista y se manda todo
con un botón; queda registrado a quién se le mandó.

## Decisiones

Del usuario (2026-11-26):

1. **Opción 2**: envío en lote desde la app, revisado por una persona antes de mandar. Nada sale solo.
2. **Cuenta**: Gmail de la oficina, con **contraseña de aplicación** (Gmail exige verificación en dos pasos para crearla).

Tomadas al planificar (se cambian fácil si el usuario prefiere otra cosa; ninguna toca el esquema salvo la tabla nueva):

3. **Un mail por propietario y mes**, a todos sus mails (`propietario.mails`). Adjuntos: el PDF de la hoja de **cada depto**
   suyo del mes y el PDF de cada **factura aprobada de producción** de los pagos de esos deptos en el mes (las de prueba no van).
4. **Sin factura todavía**: el propietario entra igual (la liquidación se puede mandar antes de pagar), con el aviso
   "sin factura" en la fila; queda marcado.
5. **Ya enviado este mes**: aparece desmarcado con "enviado el <fecha>"; se puede volver a mandar tildándolo.
6. **Quedan afuera**: los deptos de Hornera y los propietarios sin mail (motivo: "sin mail: cargalo en Propietarios → Datos para pagarle").
7. **Texto**: asunto y cuerpo editables en la ventana de la cuenta, con `{nombre}` y `{mes}` (mes en palabras: "octubre 2026").
   Por defecto: asunto `Liquidación {mes} - Hornera`; cuerpo `Hola {nombre}:\n\nTe enviamos la liquidación de {mes}` +
   `` y la factura`` si hay + `. Cualquier duda, respondé este mail.\n\nSaludos,\nHornera`.
8. **Dónde**: botón "Enviar por mail" en **Transferencias**, al lado de "Facturar pagos del mes".

## Current state

- `server/app.ts`:
  - `GeneradorPdf.generar(ruta)` → `Buffer` (Electron: ventana oculta + `printToPDF`, `electron/main.ts:151`).
  - `/api/liquidacion/pdf` (línea ~551) arma la hoja de un depto con `/?imprimir=1&mes=<mes>&depto=<codigo>`.
  - `/api/comprobantes/:id/pdf` (línea ~630) arma una factura con `/?imprimir=1&comprobante=<id>`.
  - Credenciales cifradas: `AlmacenCredenciales` (Stays) y `almacenClaveIa` en `electron/main.ts` (`safeStorage`, archivo en
    `userData`, fuera de la base y de los backups). Las rutas que guardan claves usan `soloLocal`.
  - `crearApp(db, version, opciones)` recibe dependencias inyectables (`fetchArca`, `clienteIa`): así se testea sin red.
- `server/liquidacion/pagos.ts` `listarTransferencias(db, mes)`: por depto, `propietarioId`, `propietario`, `esHornera` y
  `pagos[]` con su `factura` (`FacturaDePago`: `estado`, `ambiente`, `id`).
- `propietario.mails`: texto `"a@x.com; b@y.com"` (normalizado en `server/propietarios.ts:154`).
- `src/Transferencias.tsx` `FormLoteFacturas`: modal de lote (tabla con casillas, "Quedan afuera", envío secuencial con
  resultado por fila, no se cierra mientras trabaja: `closable`/`keyboard`/`onCancel` con `emitiendo`).
- Esquema en versión `VERSION_ESQUEMA` = `MIGRACIONES.length + 1` (`server/db.ts`).

## Dependencia nueva: `nodemailer`

Node no trae SMTP. Escribir SMTP + MIME a mano (TLS, AUTH, multipart, base64 con líneas de 76, nombres con tildes en
encabezados) son ~150 líneas fáciles de romper; `nodemailer` no tiene dependencias propias y es el estándar.
`npm install nodemailer` y `npm install -D @types/nodemailer`. Transporte: `{ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } }`.
Los mails mandados por SMTP de Gmail quedan en "Enviados" de la cuenta.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                | exit 0              |
| Tests     | `node --test server/mails.test.ts` | all pass            |
| Todo      | `npm test`                         | all pass            |

## Scope

**In scope**: `schema.sql`, `server/db.ts`, `schema.check.mjs` (tabla `envio_mail`), `server/mails.ts` (nuevo),
`server/mails.test.ts` (nuevo), `server/app.ts` (rutas + opción `mail`), `electron/main.ts` (almacén cifrado + transporte real),
`src/Transferencias.tsx` (botón + modal del lote + ventana de la cuenta), `package.json`, `GUIA-PRUEBAS.md`, `ROADMAP.md`,
`DECISIONES.md` (sacar "envío de mails" de "Fuera de la v1"), `manual/manual.html` (sección Transferencias), `plans/README.md`.

**Out of scope**: mandar solo (sin revisar), Gmail API / OAuth, otros proveedores (el host queda fijo en Gmail),
plantillas por propietario, mails a huéspedes, leer respuestas.

## Steps

### Step 1: Tabla `envio_mail`

```sql
CREATE TABLE envio_mail (
  id INTEGER PRIMARY KEY,
  propietario_id INTEGER NOT NULL REFERENCES propietario(id),
  mes TEXT NOT NULL,                    -- YYYY-MM
  fecha TEXT NOT NULL,                  -- ISO con hora, del servidor
  destinatarios TEXT NOT NULL,
  adjuntos TEXT NOT NULL,               -- nombres de archivo separados por "; "
  error TEXT                            -- NULL = enviado
);
CREATE INDEX ix_envio_mail_mes ON envio_mail(mes, propietario_id);
```

En `schema.sql`, como migración nueva en `MIGRACIONES` y en `schema.check.mjs`, juntos (regla del CLAUDE.md).
Guardar también los fallidos: sirve para ver qué pasó.

**Verify**: `npm test` → pasa (incluye `schema.check.mjs`).

### Step 2: Tests que fallan (`server/mails.test.ts`)

Mismo armado que `server/facturacion.test.ts` (base en memoria, `conApi`, datos ficticios `@ejemplo.com`). Inyectar en
`crearApp` una opción `mail: { cuenta: { leer, guardar }, enviar }` donde `enviar(cuenta, mensaje)` es falso y guarda los mensajes,
y un `pdf` falso que devuelve `Buffer.from(ruta)`.

(a) `GET /api/mails/a-enviar?mes=` con: propietario con 2 deptos y una factura de producción aprobada (entra con 3 adjuntos),
propietario con factura solo de homologación (entra, aviso "sin factura", 1 adjunto), propietario sin mail (en `excluidos`),
depto de Hornera (no aparece), propietario ya enviado ese mes (entra con `enviado` = fecha).
(b) `POST /api/mails/enviar { mes, propietario_id }`: el mensaje falso tiene `to` = los mails, asunto/cuerpo con `{nombre}` y `{mes}`
reemplazados, los adjuntos con nombre (`<codigo> <mes>.pdf`, `factura C-<pv>-<n>.pdf`); queda una fila en `envio_mail` sin error.
(c) `enviar` que tira error → 502 con el mensaje y fila en `envio_mail` con `error`. Error de autenticación de Gmail
(`EAUTH`) → mensaje "Gmail rechazó la cuenta: revisá la contraseña de aplicación".
(d) Inválidos: mes mal formado, propietario sin mail, propietario de Hornera, sin cuenta cargada ("Falta cargar la cuenta de Gmail") → 400.
(e) `PUT /api/mails/cuenta` valida que el usuario sea un mail y que la contraseña tenga 16 letras (Gmail la muestra con espacios: sacarlos).

**Verify**: `node --test server/mails.test.ts` → fallan (no existen las rutas).

### Step 3: Servidor

1. `server/mails.ts`:
   - `aEnviar(db, mes)` → `{ incluidos: { propietarioId, propietario, mails, deptos: string[], facturas: number[], aviso, enviado }[], excluidos: { propietarioId, propietario, motivo }[] }`,
     agrupando `listarTransferencias(db, mes)` por `propietarioId` (sin `esHornera`); `facturas` = ids de `factura` con
     `estado === 'aprobado' && ambiente === 'produccion'` de los pagos no anulados; `enviado` = última `fecha` sin error en `envio_mail`.
   - `armarMensaje(db, mes, propietarioId, texto)` → `{ to, subject, text }` (valida lo de (d)).
   - `registrar(db, ...)` inserta en `envio_mail`.
   - Texto por defecto y lectura de `configuracion` (`mail.asunto`, `mail.cuerpo`, `mail.remitente`).
2. `server/app.ts`:
   - Opción `mail?: { cuenta: AlmacenCuentaMail; enviar: (cuenta, mensaje) => Promise<void> }`.
   - `GET /api/mails/cuenta` → `{ usuario, asunto, cuerpo }` (nunca la contraseña). `PUT /api/mails/cuenta` con `soloLocal`.
   - `POST /api/mails/probar` (`soloLocal`): manda un mail a la propia cuenta, para comprobar la contraseña.
   - `GET /api/mails/a-enviar`, `POST /api/mails/enviar`: genera los PDF con `pdf.generar` (las mismas rutas que hoy), arma y manda.
     Un solo envío a la vez con el mismo `exclusivo` que facturación si es trivial de reutilizar; si no, el lote ya es secuencial.
3. `electron/main.ts`: `almacenCuentaMail()` como `almacenClaveIa` (archivo `gmail.key` cifrado con el usuario y la contraseña) y
   `enviar` con `nodemailer.createTransport(...).sendMail({ from: usuario, ...mensaje, attachments })`.

**Verify**: `node --test server/mails.test.ts` → todos pasan; `npm run typecheck` → exit 0.

### Step 4: Interfaz en Transferencias

Skill `modales`. Copiar la forma de `FormLoteFacturas`.

1. Botón **"Enviar por mail"** al lado de "Facturar pagos del mes".
2. Si no hay cuenta cargada, abre primero la ventana **Cuenta de Gmail**: mail, contraseña de aplicación (con link a la ayuda de
   Google `https://myaccount.google.com/apppasswords`), asunto y cuerpo (con `{nombre}` y `{mes}`), botón "Probar" y "Guardar".
   Desde una terminal: el aviso de que se carga en la PC servidor (como Stays).
3. Modal del lote: tabla con casilla, propietario, mails, adjuntos (deptos y facturas, en chico), aviso/"enviado el …" y **Resultado**;
   sección "Quedan afuera"; link "Cuenta y texto del mail"; botón **"Enviar N mails"**.
4. Envío: `for` secuencial con `await enviar('mails/enviar', 'POST', { mes, propietario_id })`. Por fila: ok → "enviado";
   error → el motivo y sigue; **error de cuenta (`EAUTH`) o sin conexión → corta** ("se enviaron X de N"). Mismo bloqueo de
   cierre que el lote de facturas mientras envía.

**Verify**: `npm run typecheck` → exit 0. A mano con `npx electron . --user-data-dir=<carpeta temporal>` (base ficticia, mails
`@ejemplo.com` cambiados por **una cuenta propia de prueba**): cargar la cuenta, "Probar" llega, mandar 2 → llegan con sus adjuntos
y figuran en "Enviados"; reabrir → aparecen "enviado el …" y desmarcados; contraseña mal → corta con el mensaje.

### Step 5: Docs

- `DECISIONES.md`: sacar "envío de mails" de "Fuera de la v1" y agregar "Mails en lote" (decisiones 1 a 8).
- `GUIA-PRUEBAS.md`: cómo crear la contraseña de aplicación y la prueba del paso 4.
- `ROADMAP.md` y el manual (sección Transferencias; capturas al final de la tanda, no en cada ajuste).

**Verify**: `npm test` → todos pasan.

## Done criteria

- [ ] `npm run typecheck` y `npm test` exit 0 con `server/mails.test.ts`
- [ ] La contraseña no está en la base, en los backups ni en ninguna respuesta de la API (`grep -rn "gmail.key" server/` vacío; el test de `GET /api/mails/cuenta` no la trae)
- [ ] Probado a mano con una cuenta de prueba: llegan los adjuntos, quedan registrados, reabrir no los vuelve a marcar
- [ ] `git status` solo muestra archivos en scope

## STOP conditions

- Gmail rechaza la contraseña de aplicación aun bien cargada (la cuenta puede ser de Workspace con SMTP bloqueado por el admin): reportar.
- Hace falta mandar los mails desde una terminal con su propia cuenta (hoy todo sale de la PC servidor).
- Los PDF tardan tanto que el lote se vuelve inusable (>10 s por propietario): reportar antes de paralelizar.

## Maintenance notes

- Límite de Gmail: ~500 destinatarios por día (Workspace: 2000). Sobra para decenas de propietarios.
- Si Google deja de aceptar contraseñas de aplicación, el reemplazo es OAuth (Gmail API): solo cambia `enviar` en `electron/main.ts`.
- `envio_mail` no se borra: es el registro de qué se mandó. Si crece, no importa (una fila por propietario por mes).
