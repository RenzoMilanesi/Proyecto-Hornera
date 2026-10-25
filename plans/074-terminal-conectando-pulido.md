# 074 — Terminal "Conectando…": textos al día y sin rechazos sueltos

Escrito contra `71c7adc` + el cambio sin commitear en `electron/main.ts` (`iniciarTerminal`: antes de abrir la app
del servidor muestra `terminal.html?conectando=<servidor>` y reintenta `net.fetch(servidor, { method: 'HEAD' })`
hasta que responda) y `electron/terminal.html` (modo `?conectando` con spinner, segundos y link
*Cambiar el servidor*). Revisión `improve deep` de ese cambio. Si los archivos citados no se parecen a los
extractos, PARAR y avisar.

## Por qué
1. **Los textos describen el comportamiento viejo.** Ahora, con el servidor apagado, la terminal muestra
   "Conectando con PC-…" y entra sola cuando el servidor vuelve; ya no hace falta tocar *Conectar*.
   - `manual/manual.html` (sección 20, lista bajo la figura `terminal-conectar.png`):
     ```html
     <li>Si el servidor está apagado o se salió de Hornera en el servidor, la terminal avisa que no puede conectar. Al volver a abrirlo, tocar
       <span class="boton">Conectar</span>.</li>
     ```
   - `GUIA-PRUEBAS.md`, sección 7, paso 6: "…la terminal muestra que no puede conectar. Abrir Hornera de nuevo y
     tocar *Conectar*: vuelve a entrar."
2. **Rechazo sin atrapar en `conectar`.** `conectar` es `async` y se llama sin `await` ni `.catch` (desde
   `will-navigate` y al iniciar). Hace `await ventana.loadFile(pantalla, …)`: si otra carga la reemplaza
   (p. ej. `did-fail-load` llama a `configurar()` en ese momento), `loadFile` rechaza con `ERR_ABORTED` y queda
   un *unhandled rejection* en el proceso principal. No rompe nada (Electron solo lo loguea), pero ensucia la
   consola y esconde errores reales.

## Pasos
1. `electron/main.ts`, dentro de `conectar` en `iniciarTerminal`: la línea
   ```ts
   await ventana.loadFile(pantalla, { query: { conectando: servidor } });
   ```
   pasa a
   ```ts
   await ventana.loadFile(pantalla, { query: { conectando: servidor } }).catch(() => {}); // reemplazada por otra carga
   ```
   No tocar el resto del loop. Verificación: `npm run typecheck` → sin errores.
2. `manual/manual.html`: reemplazar ese `<li>` por:
   ```html
   <li>Si el servidor está apagado o se salió de Hornera en el servidor, la terminal muestra <b>Conectando con …</b> y sigue
     intentando sola: entra apenas el servidor vuelve. Desde ahí, <span class="boton">Cambiar el servidor</span> vuelve a la pantalla de la dirección.</li>
   ```
   Sin capturas nuevas (la regla del proyecto: capturas al final de la tanda).
3. `GUIA-PRUEBAS.md` sección 7, paso 6: cambiar la segunda oración por "…clic derecho en el ícono de la bandeja →
   Salir. Cerrar y abrir la terminal: muestra *Conectando con …* con los segundos. Abrir Hornera en el servidor: la
   terminal entra sola en unos segundos." Agregar un paso: "Con la terminal en *Conectando…*, tocar *Cambiar el
   servidor*: vuelve al formulario con la dirección cargada."

## Fuera de alcance
- `src/` y el servidor. El servidor que se cae **con la terminal ya adentro de la app** (las pantallas muestran
  errores de `fetch` de `src/api.ts`; no vuelve sola a "Conectando…"): es otro cambio, a decidir aparte.

## Hecho cuando
- `npm run typecheck` y `npm test` pasan.
- `grep -n "tocar\s*$" manual/manual.html` no muestra la oración vieja; `grep -n "Conectando con" manual/manual.html GUIA-PRUEBAS.md` → una línea en cada uno.

## Mantenimiento
Si cambia el flujo de `iniciarTerminal`, revisar la sección 20 del manual y la sección 7 de la guía juntos.
