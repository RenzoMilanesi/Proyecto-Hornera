# Plan 076: Recargar sin servidor reintenta solo, y el puerto ocupado se explica

> **Executor**: seguí los pasos en orden; corré cada verificación y confirmá el resultado antes de seguir. Si pasa algo
> de "PARAR si", frená y avisá: no improvises. Al terminar, actualizá la fila 076 de `plans/README.md`.
>
> **Drift check (primero)**: `git diff --stat 2752357..HEAD -- electron/main.ts`
> Si cambió, compará los extractos de abajo con el código actual; si no coinciden, PARAR.

## Estado
- **Prioridad**: P2 · **Esfuerzo**: S · **Riesgo**: BAJO · **Depende de**: nada · **Categoría**: bug
- **Escrito contra**: `2752357`, 2026-10-25. Revisión `improve deep` de terminales y reconexión.

## Por qué
Hornera es una app Electron (`electron/main.ts`). La PC es **servidor** (levanta la API en el puerto 4310) o
**terminal** (su ventana abre la app del servidor). Al abrir, la terminal muestra `electron/terminal.html?conectando=…`
y reintenta con `net.fetch` hasta que el servidor responde (función `conectar` en `iniciarTerminal`).

1. **Recargar sin servidor lleva al formulario, no a "Conectando…".** Si la persona recarga la ventana (Ctrl+R, que
   viene en el menú por defecto de Electron) con el servidor caído, falla la carga y `did-fail-load` llama a
   `configurar(...)`: la pantalla de escribir la dirección, con un error y **sin reintentar**. Lo mismo si el servidor se
   cae justo entre la prueba de `conectar` y `loadURL`. Tiene que ser como al abrir: "Conectando…" y reintento.
2. **Puerto ocupado en el servidor.** Si el 4310 ya está en uso (otra copia de Hornera con otra carpeta de datos, p. ej.
   `npm run dev` y la instalada a la vez), `listen` rechaza con `EADDRINUSE`; `iniciar()` termina en
   `dialog.showErrorBox('Hornera no pudo iniciar', String(e?.stack ?? e))`: un stack técnico ilegible para quien la usa.

### Estado actual (`electron/main.ts`)
En `iniciarTerminal`:
```ts
  ventana.webContents.on('did-fail-load', (_e, codigo, descripcion, url, principal) => {
    // -3: navegación reemplazada por otra, no es una falla.
    if (principal && codigo !== -3 && url.startsWith('http')) configurar(`No se pudo conectar con ${rol.servidor} (${descripcion}). ¿Está abierta Hornera en el servidor?`);
  });
```
`conectar` (misma función) ya existe: `const conectar = async () => { const este = ++intento; ... }` y muestra
"Conectando…" con reintento cada ~2 s; `configurar` incrementa `intento`, lo que corta una espera en curso.

En `iniciarServidor`:
```ts
  await new Promise<void>((ok, error) => http.once('error', error).listen(PUERTO, HOST, ok));
```
`PUERTO` = 4310 (constante arriba del archivo).

## Pasos
1. `did-fail-load`: reemplazar `configurar(...)` por `conectar()`:
   ```ts
   ventana.webContents.on('did-fail-load', (_e, codigo, _descripcion, url, principal) => {
     // -3: navegación reemplazada por otra, no es una falla. Sin servidor (también al recargar): a esperar que vuelva.
     if (principal && codigo !== -3 && url.startsWith('http')) conectar();
   });
   ```
   `conectar` está declarada con `const` más arriba en la misma función: verificar que el handler quede **después** de
   su declaración (si no, PARAR). Verificación: `npm run typecheck` → sin errores.
2. Puerto ocupado: reemplazar la línea del `listen` por:
   ```ts
   await new Promise<void>((ok, error) => http.once('error', (e: NodeJS.ErrnoException) => error(e.code === 'EADDRINUSE'
     ? new Error(`El puerto ${PUERTO} ya está en uso: hay otra Hornera abierta en esta PC (¿la instalada y la de desarrollo?). Cerrala y volvé a abrir.`)
     : e)).listen(PUERTO, HOST, ok));
   ```
   **No tocar** el `.catch` de `app.whenReady().then(iniciar)` al final del archivo: el `Error` nuevo ya trae el texto
   en la primera línea de lo que muestra el diálogo.
   Verificación: `npm run typecheck` → sin errores.
3. **Prueba manual** (el puerto 4310 libre: si `npm run dev` está abierto, PARAR y pedir que lo cierren).
   - Recarga: terminal de prueba (carpeta temporal `T`, `rol.json` = `{"rol":"terminal","servidor":"http://127.0.0.1:4310"}`,
     `npx electron . --user-data-dir=T`) y servidor de prueba (carpeta `S`, `{"rol":"servidor"}`). Con la terminal ya
     adentro de la app, salir del servidor (bandeja → Salir) y apretar Ctrl+R en la terminal: muestra "Conectando con
     127.0.0.1…". Abrir el servidor: la terminal entra sola.
   - Puerto: con el servidor `S` abierto, abrir otro servidor con otra carpeta (`U`, `{"rol":"servidor"}`): el diálogo
     dice "El puerto 4310 ya está en uso…".

## PARAR si
- `conectar` no existe en `iniciarTerminal` o tiene otra forma: avisar.
- Tras el paso 1, una dirección mal escrita deja la terminal en "Conectando…" para siempre sin forma de salir: no
  debería (la pantalla tiene "Cambiar el servidor"); si no está ese link en `electron/terminal.html`, avisar.

## Fuera de alcance
- `src/` (el corte con la app ya cargada: plan 075). `electron/terminal.html`.
- El 403 de un nombre que el servidor no reconoce (`did-navigate` con código ≥ 400): sigue yendo al formulario, bien.

## Hecho cuando
- `npm run typecheck` sin errores y `npm test` con `fail 0`.
- `grep -n "No se pudo conectar con" electron/main.ts` → sin resultados.
- Pruebas manuales del paso 3 hechas.

## Mantenimiento
`did-fail-load` y la carga inicial pasan ahora por el mismo `conectar`: un cambio en cómo se espera al servidor se hace
en un solo lugar. Si se agrega otro puerto o se hace configurable, actualizar el texto del paso 2.
