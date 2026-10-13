# Plan 027: La terminal no queda trabada si el servidor responde con error

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 7bbd1d1..HEAD -- electron/main.ts electron/terminal.html`.
> La fase 5d se escribió después de ese commit (sin commitear al planificar).

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (UX, sin salida)
- **Planned at**: commit `7bbd1d1` + fase 5d sin commitear, 2026-10-13

## Why this matters
En modo terminal (`iniciarTerminal`, `electron/main.ts`), la ventana vuelve a `electron/terminal.html`
(donde se elige otro servidor o se pasa a servidor) solo en `did-fail-load`, es decir cuando **no hay
conexión**. Si algo responde en esa dirección pero con un error HTTP, la ventana muestra el JSON del
error y no hay forma de salir: no hay menú, `will-navigate` bloquea otros orígenes y la dirección
quedó guardada en `rol.json`. Casos reales:
- Se escribió la PC con un nombre que el servidor no reconoce en el Host (p. ej. un nombre con sufijo
  DNS del router como `pc-oficina.home`, o una IPv6): la API responde 403 `Host no permitido`
  (`hostPermitido` en `server/app.ts` solo acepta el nombre del equipo, `nombre.local` y las IPv4).
- La IP guardada ahora la tiene otro equipo que atiende en el puerto 4310.
Hoy la única salida es borrar `%APPDATA%\hornera\rol.json` a mano.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `electron/main.ts` (solo `iniciarTerminal`).
**Out**: `server/*` (no cambiar qué Host se acepta), `src/*`.

## Steps
1. En `iniciarTerminal`, sumar un handler `ventana.webContents.on('did-navigate', (_e, url, codigo) => …)`:
   si `url` empieza con `http` y `codigo >= 400`, llamar
   `configurar(\`El servidor ${rol.servidor} respondió con error ${codigo}. Revisá la dirección (usá el nombre que muestra Terminales en el servidor).\`)`.
   `did-navigate` solo corre en navegaciones del frame principal y trae el código HTTP como 3.er argumento.
   STOP si en la versión de Electron del proyecto (`package.json`) la firma de `did-navigate` no incluye
   `httpResponseCode`: reportar.
2. No tocar el 401 de "sin emparejar": ese lo devuelve `/api/estado` (un `fetch`), no la navegación a `/`,
   que responde 200 con la interfaz. Confirmar que la navegación a `/` no pasa por `autorizar` (está
   montado en `/api`).

**Verify**: `npm run typecheck` → exit 0; `npm test` → todos pasan.

## Prueba manual
1. `npx electron . --user-data-dir=<tmp-servidor>` con `rol.json` = `{"rol":"servidor"}`.
2. Otra instancia con `--user-data-dir=<tmp-terminal>` y `rol.json` =
   `{"rol":"terminal","servidor":"http://<ip-de-esta-pc>:4310"}` → debe abrir la pantalla de emparejar.
3. Cambiar `servidor` por `http://localhost.:4310` (Host no aceptado) y reabrir → debe mostrar
   `terminal.html` con el mensaje de error, no un JSON.

## Maintenance
Si en el futuro se agregan rutas de la interfaz que respondan 4xx a propósito en una navegación del
frame principal, este handler las va a tratar como "servidor equivocado".
