# 048 — Elegir desde la app la carpeta de las copias de seguridad

Escrito contra `9f35811` (2026-10-22). P2 · M · riesgo BAJO. Depende de: ninguno.

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 048 de `plans/README.md`.
>
> **Chequeo de cambios (primero):** `git diff --stat 9f35811..HEAD -- server/backup.ts server/app.ts electron/main.ts src/App.tsx server/app.test.ts manual/manual.html`.
> Si alguno cambió, compará los extractos de "Cómo está hoy" con el código real; si no coinciden, parar y avisar.

## Por qué

La PC servidor hace una copia de la base al cerrar la app y cada 6 h. Por defecto la guarda en
`%APPDATA%\hornera\backups`, **en el mismo disco que la base**: si esa PC se rompe o la roban se
pierden la base y las copias juntas. El código ya permite otra carpeta (por ejemplo una de Google Drive
u OneDrive, que se sincroniza sola) con la fila `configuracion.backup.carpeta`, pero **no hay pantalla
para cargarla**: hoy solo se puede tocando la base. Este plan agrega esa pantalla, en la PC servidor.

Decisiones tomadas (no reabrir):
1. **Solo en la PC servidor.** Las copias las hace el servidor; desde una terminal no tiene sentido y
   una ruta escrita en otra PC no existe en el servidor. Rutas con `soloLocal`, igual que Terminales.
2. **La ruta se escribe (o pega) en un campo de texto.** La app no tiene *preload* ni IPC de Electron
   (`grep -rn "preload\|ipcMain" electron src` no da nada); agregar el selector de carpetas de Windows
   queda fuera de este plan.
3. **Antes de guardar se prueba haciendo una copia real ahí.** Si la copia falla, no se guarda la carpeta
   y se muestra el error. Así nunca queda configurada una carpeta que no anda.
4. **Vaciar el campo vuelve a la carpeta por defecto** (borra la fila de `configuracion`).
5. **Las copias que ya existen no se mueven** al cambiar de carpeta: quedan donde estaban. La pantalla lo dice.
6. Botón **"Hacer una copia ahora"** y la lista de las **últimas 5 copias** de la carpeta en uso
   (fecha y tamaño), para que se vea que anda.
7. Sin migración: la clave `backup.carpeta` ya existe en la tabla `configuracion` (clave/valor).

## Reglas del repo (de CLAUDE.md)

- TypeScript sin build: nada de enums, namespaces ni parámetros de propiedad en constructores; imports con extensión `.ts`.
- Estilo mínimo: sin abstracciones especulativas; un comentario `ponytail:` marca una simplificación a propósito.
- Datos reales nunca al repo: en tests y comentarios, rutas y datos ficticios.
- Responder y comentar en español, en el tono de los comentarios existentes (cortos, explican el porqué).
- Commits: skill `commit-version` (este cambio es **minor**: pantalla y endpoints nuevos).

## Cómo está hoy

- `server/backup.ts` — hace las copias. Extracto (líneas 37-52):

  ```ts
  // Copia en la carpeta configurable (Drive/OneDrive, `configuracion.backup.carpeta`).
  // Si esa falla (Drive desmontado), la copia queda en la por defecto y se avisa con
  // un error que dice dónde quedó: mejor una copia local que ninguna.
  export function respaldar(db: DatabaseSync, porDefecto: string): string {
    const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'backup.carpeta'`).get() as { valor: string } | undefined;
    const carpeta = fila?.valor || porDefecto;
    try {
      // Una carpeta de otra PC de la red (ruta UNC, \\servidor\carpeta) haría que Windows se conecte a ella.
      if (carpeta.startsWith('\\\\') || carpeta.startsWith('//')) throw new Error('no se usan carpetas de otras PCs de la red');
      return hacerBackup(db, carpeta);
    } catch (e) { ... }
  }
  ```

  `hacerBackup(db, carpeta, ahora?)` (línea 9) crea la carpeta si falta, escribe `hornera-<fecha>.db` con
  `VACUUM INTO`, le saca el ticket de ARCA y deja solo las últimas `MAX_BACKUPS` (60) copias `hornera-*.db`.
- `electron/main.ts:147-149` — la carpeta por defecto la conoce solo Electron:

  ```ts
  const backup = (avisar: boolean) => {
    try {
      respaldar(db, join(app.getPath('userData'), 'backups'));
  ```

  y `electron/main.ts:134` crea la API: `crearApp(db, app.getVersion(), { credenciales: almacenCredenciales(), claves: almacenClaves(), pdf: generadorPdf(ORIGEN_LOCAL), desarrollo: !app.isPackaged })`.
- `server/app.ts:99` — firma de `crearApp`:
  `export function crearApp(db: DatabaseSync, version: string, opciones: { credenciales?: AlmacenCredenciales; urlStays?: string; pdf?: GeneradorPdf; fetchDolar?: Fetch; claves?: AlmacenClaves; fetchArca?: Fetch; desarrollo?: boolean } = {})`.
  En la línea 115 registra `rutasTerminales(app, db);`.
- `server/terminales.ts` — **ejemplo a imitar** para rutas solo del servidor: `soloLocal` (línea 49) y
  `rutasTerminales(app, db)` (línea 54), con `app.put('/api/terminales/nombre', soloLocal, (req, res) => { try { res.json(...) } catch (e) { res.status(400).json({ error: ... }) } })`.
- `src/Terminales.tsx` — **ejemplo a imitar** para la pantalla: `Card size="small"` con título, un
  `Typography.Paragraph type="secondary"` que explica, `Space.Compact` con `Input` + `Button type="primary"`
  "Guardar", errores en un `Alert` arriba, y el patrón `accion(fn)` que recarga con `setVersion`.
  `get`/`enviar` vienen de `src/api.ts`.
- `src/App.tsx:21-37` — el menú es el objeto `secciones`; la línea 56 oculta Terminales en las terminales:
  `const visibles = Object.entries(secciones).filter(([key]) => local || key !== 'terminales');`
- `server/app.test.ts:258-276` — test existente de `respaldar` (carpeta que falla, ruta UNC, sin configurar).
  Usa `abrirDb(':memory:')` y `temporal(t)` (carpeta temporal del test). **Modelo para los tests nuevos.**
  Para probar rutas HTTP, buscar en `server/app.test.ts` cómo se llama a la API (por ejemplo los tests
  de `/api/terminales` o `/api/emisores`) e imitarlo.
- `manual/manual.html` — línea 128 (tabla de carpetas: "Copias de seguridad … `%APPDATA%\Hornera\backups`")
  y sección "17. Copias de seguridad y recuperación" (líneas ~634-648).

## Comandos

| Para qué | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sale sin errores |
| Tests | `npm test` | todos pasan (hoy 152) y `schema OK` |
| Probar a mano | `npx electron . --user-data-dir=<carpeta temporal>` | abre la app con una base vacía |

## Alcance

**Se tocan solo:**
- `server/backup.ts` — funciones y rutas nuevas.
- `server/app.ts` — opción `carpetaBackups` en `crearApp` y registrar las rutas.
- `electron/main.ts` — pasar la carpeta por defecto a `crearApp` y usarla en `backup`.
- `src/Copias.tsx` (nuevo) — la pantalla.
- `src/App.tsx` — entrada de menú.
- `server/app.test.ts` — tests.
- `manual/manual.html`, `ROADMAP.md`, `package.json` (versión), `plans/README.md`.

**No tocar:**
- `hacerBackup` y la lógica de `respaldar` (qué se copia, el ticket de ARCA, las 60 copias, el fallback):
  ya tienen tests y funcionan. Solo se agregan cosas al lado.
- `schema.sql` / `server/db.ts`: no hay cambio de esquema.
- Las capturas del manual (`manual/img/`) y el PDF del manual: se regeneran aparte, al final de una tanda.
- `pdf.carpeta` (carpeta de los PDF de liquidación): parecido pero es otro tema; no mezclarlo.

## Pasos

### Paso 1: lógica en `server/backup.ts`

Agregar, debajo de `respaldar`:

1. `carpetaBackups(db, porDefecto)` → `{ carpeta: string; porDefecto: string; configurada: boolean }`:
   lee `backup.carpeta`; `carpeta` es la configurada o la por defecto. Usarla también dentro de
   `respaldar` para no repetir la consulta (mismo resultado que hoy).
2. `ultimasCopias(carpeta, n = 5)` → `{ archivo: string; fecha: string; bytes: number }[]`: los
   `hornera-*.db` de la carpeta (mismo filtro `/^hornera-.*\.db$/` que `hacerBackup`), ordenados del más
   nuevo al más viejo por nombre, los primeros `n`, con `statSync` para tamaño y `mtime` (ISO) como fecha.
   Si la carpeta no existe o no se puede leer, devolver `[]` (no tirar).
3. `elegirCarpeta(db, carpeta: unknown)`:
   - Si no es string o, recortada, queda vacía → `DELETE FROM configuracion WHERE clave = 'backup.carpeta'`
     y devolver `{ carpeta: null }` (vuelve a la por defecto).
   - Si empieza con `\\` o `//` → `throw new Error('No se usan carpetas de otras PCs de la red: elegí una carpeta de esta PC (por ejemplo la de Google Drive u OneDrive).')`.
   - Si no es absoluta (`isAbsolute` de `node:path`) → `throw new Error('Escribí la ruta completa de la carpeta, por ejemplo C:\\Users\\…\\Google Drive\\Hornera.')`.
   - Probar con una copia real: `const destino = hacerBackup(db, ruta)`. Si tira, envolver:
     `throw new Error(\`No se pudo hacer una copia en ${ruta}: ${mensaje}\`)` y **no** guardar nada.
   - Si anduvo: `INSERT INTO configuracion(clave, valor) VALUES ('backup.carpeta', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
     (mismo SQL que `nombrarPc` en `server/auditoria.ts:21`) y devolver `{ carpeta: ruta, copia: destino }`.

**Verificar:** `npm run typecheck` → sin errores.

### Paso 2: rutas en `server/backup.ts` y opción en `crearApp`

En `server/backup.ts`, `export function rutasBackup(app: Express, db: DatabaseSync, porDefecto: string)`
(importar `soloLocal` de `./terminales.ts` y los tipos `Express` de `express`, como hace `terminales.ts`):

- `GET /api/backup` (soloLocal) → `{ ...carpetaBackups(db, porDefecto), copias: ultimasCopias(carpeta) }`.
- `PUT /api/backup/carpeta` (soloLocal) → `elegirCarpeta(db, req.body?.carpeta)`; error → 400 `{ error }`.
- `POST /api/backup` (soloLocal) → `respaldar(db, porDefecto)` y responder `{ copia: destino }`;
  si `respaldar` tira (la carpeta configurada falló y la copia quedó en la por defecto) → 500 `{ error }`
  con el mensaje tal cual (ya dice dónde quedó la copia).

En `server/app.ts`: agregar `carpetaBackups?: string` a las opciones de `crearApp` y, junto a
`rutasTerminales(app, db);` (línea 115), `if (carpetaBackups) rutasBackup(app, db, carpetaBackups);`
(sin carpeta, como en la mayoría de los tests, las rutas no existen).

En `electron/main.ts`: `const carpetaBackups = join(app.getPath('userData'), 'backups');`, pasarla en
`crearApp(..., { ..., carpetaBackups })` y usarla en `backup` en lugar de repetir el `join`.

**Verificar:** `npm run typecheck` → sin errores; `npm test` → todo pasa (nada cambió de comportamiento).

### Paso 3: pantalla `src/Copias.tsx` y menú

Pantalla con el estilo de `src/Terminales.tsx`:

- Card **"Carpeta de las copias"**: texto secundario que explique: "Hornera hace una copia de la base al
  cerrar y cada 6 horas. Conviene una carpeta de Google Drive u OneDrive, así la copia queda también fuera
  de esta PC. Las copias que ya existen no se mueven." Mostrar la carpeta en uso (`Typography.Text code copyable`)
  y, si no está configurada, "(la de siempre)". `Space.Compact` con `Input` (ancho ~420, placeholder con
  la ruta por defecto) + botón primario **"Guardar"** (prueba con una copia; deshabilitado si no cambió) y
  botón **"Volver a la de siempre"** solo si `configurada`. Al guardar bien, `message.success` con
  "Listo: la copia de prueba quedó en …".
- Card **"Últimas copias"**: `Table` chica con Fecha (`toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })`),
  Archivo y Tamaño (MB con 1 decimal); botón **"Hacer una copia ahora"** arriba de la tabla.
  Sin copias: texto "Todavía no hay copias en esta carpeta."
- Errores en `Alert` arriba, como `Terminales.tsx`.

En `src/App.tsx`: entrada `copias: { grupo: 'Herramientas', titulo: 'Copias de seguridad', ayuda: 'Dónde se guardan las copias de la base y las últimas que se hicieron.', vista: <Copias /> }`
después de `terminales`, y cambiar el filtro de la línea 56 para ocultar en las terminales **las dos**
secciones solo-servidor (por ejemplo `const soloServidor = ['terminales', 'copias'];` y
`local || !soloServidor.includes(key)`), con el comentario `// solo en la PC servidor` en la entrada.

Si la pantalla tiene un Modal o Drawer, usar la skill `modales`. (Con el diseño de arriba no hace falta ninguno.)

**Verificar:** `npm run typecheck` → sin errores. A mano: `npx electron . --user-data-dir=<carpeta temporal>`,
abrir Herramientas → Copias de seguridad:
- escribir una carpeta nueva de la PC (por ejemplo `<carpeta temporal>\drive`) y Guardar → aparece la
  copia de prueba en la lista y el archivo existe en esa carpeta;
- escribir `\\otra-pc\copias` → error de "otras PCs de la red", la carpeta en uso no cambia;
- escribir `copias` (relativa) → error de "ruta completa";
- "Volver a la de siempre" → la carpeta en uso pasa a `<carpeta temporal>\backups`;
- "Hacer una copia ahora" → aparece una fila nueva.

### Paso 4: tests en `server/app.test.ts`

Junto al test de la línea 258, con `abrirDb(':memory:')` y `temporal(t)`:

1. `elegirCarpeta`: una carpeta válida guarda `backup.carpeta` y deja una copia ahí; `respaldar` después
   escribe en esa carpeta.
2. `elegirCarpeta`: ruta UNC, ruta relativa y una ruta que es un **archivo** (como el test existente,
   `writeFileSync(noEsCarpeta, '')`) tiran error y **no** cambian `backup.carpeta` (sigue la anterior o ninguna).
3. `elegirCarpeta('')` borra la fila y `respaldar` vuelve a la por defecto.
4. `ultimasCopias`: con 7 copias hechas con `hacerBackup(db, carpeta, new Date(2026, 0, 1, 0, 0, i))`
   devuelve 5, la primera la más nueva; carpeta inexistente → `[]`.
5. Rutas: `crearApp(db, 'test', { carpetaBackups: <temporal> })` → `GET /api/backup` responde la carpeta
   por defecto y `configurada: false`; `PUT /api/backup/carpeta` con ruta UNC → 400. Si los tests de la API
   simulan una terminal (pedido no local), agregar que `GET /api/backup` desde una terminal da 403.

**Verificar:** `npm test` → todos pasan, 152 + los nuevos, y `schema OK`.

### Paso 5: documentación y versión

- `manual/manual.html`: en la tabla de carpetas (línea ~128) aclarar "por defecto; se cambia en
  Herramientas → Copias de seguridad". En la sección 17 agregar un párrafo "Elegir dónde se guardan" con
  los pasos de la pantalla y la recomendación de Drive/OneDrive. **No** regenerar capturas ni el PDF.
- `ROADMAP.md`: anotar la feature en la versión que corresponda, como las anteriores.
- Commit con la skill `commit-version` (minor).
- `plans/README.md`: fila 048 → A TESTEAR.

**Verificar:** `npm test` → todo pasa; `git status` → solo archivos del alcance.

## Terminado cuando

- [ ] `npm run typecheck` sale sin errores.
- [ ] `npm test` pasa con los tests nuevos del paso 4.
- [ ] `grep -n "backup.carpeta" server/backup.ts` muestra la lectura y la escritura nueva.
- [ ] `grep -n "'copias'" src/App.tsx` muestra la entrada y el filtro de solo-servidor.
- [ ] `git status` no muestra archivos fuera del alcance.
- [ ] Fila 048 de `plans/README.md` actualizada.

## Parar y avisar si

- Los extractos de "Cómo está hoy" no coinciden con el código (cambió desde `9f35811`).
- Para que la pantalla funcione parece hacer falta un *preload*/IPC de Electron (por ejemplo, para el
  selector de carpetas): eso está fuera de este plan.
- Algún test existente de backups (`server/app.test.ts:238-276`) deja de pasar: el comportamiento de
  `hacerBackup`/`respaldar` no tiene que cambiar.
- Hace falta tocar `schema.sql` o `server/db.ts`.

## Para después

- Selector de carpetas de Windows (`dialog.showOpenDialog`) con un *preload* mínimo: más cómodo que pegar
  la ruta, pero agrega IPC a una app que hoy no tiene.
- Avisar en la pantalla si la última copia tiene más de un día (la carpeta de Drive se desconectó y nadie se enteró).
- Al revisar el PR: que `elegirCarpeta` no guarde nunca una carpeta sin copia de prueba exitosa, y que las
  rutas sean todas `soloLocal`.
