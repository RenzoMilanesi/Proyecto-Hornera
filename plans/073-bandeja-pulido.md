# 073 — Servidor en la bandeja: reinicio visible y textos al día

Escrito contra `c6b62fd` + el modo bandeja sin commitear en `electron/main.ts` (cerrar la ventana la oculta, ícono
en la bandeja con Abrir/Salir, inicio con Windows con `--oculto`). Revisión `improve deep` de ese cambio.
Si los archivos citados no se parecen a los extractos, PARAR y avisar.

## Por qué
1. **Restaurar una copia o "borrar todo" reinicia la app oculta.** En el servidor, Windows abre Hornera al entrar
   con `--oculto` (`app.setLoginItemSettings({ ..., args: ['--oculto'] })` en `iniciar()`). Si después la persona la
   abre desde la bandeja y restaura una copia, `electron/main.ts:185` hace:
   ```ts
   reiniciar: () => { app.relaunch(); app.quit(); },
   ```
   `app.relaunch()` sin argumentos repite los de la instancia actual, `--oculto` incluido: la ventana desaparece
   justo después de confirmar la restauración y parece que la app se cerró.
2. **Los textos dicen que la copia se hace "al cerrar la app"** y que la terminal deja de andar al cerrar Hornera en
   el servidor. Ahora cerrar la ventana no cierra la app: la copia sale al elegir **Salir** en la bandeja, al apagar
   Windows y cada 6 h.

## Pasos
1. `electron/main.ts:185`: reiniciar sin `--oculto`:
   ```ts
   reiniciar: () => { app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--oculto') }); app.quit(); },
   ```
   (El `app.relaunch()` de `iniciarTerminal` no cambia: una terminal no arranca con Windows.)
   Verificación: `npm run typecheck` → sin errores. En la app de prueba
   (`npx electron . --user-data-dir=<carpeta temporal> --oculto`), abrir desde la bandeja, Sistema → restaurar una
   copia: vuelve a abrir con la ventana visible.
2. Textos (solo redacción, sin capturas nuevas):
   - `manual/manual.html:841`: "al cerrar la app" → "al salir de Hornera (clic derecho en el ícono de la bandeja,
     **Salir**), al apagar Windows". Agregar en esa sección o en la de terminales un ítem: en el servidor, cerrar la
     ventana deja Hornera en la bandeja (junto al reloj) y las terminales siguen andando; arranca sola al entrar a Windows.
   - `manual/manual.html:924`: "Que Hornera esté abierta en el servidor" → "Que el servidor esté prendido, con la sesión
     de Windows iniciada (Hornera arranca sola, en la bandeja)".
   - `src/Copias.tsx:42`: "al cerrar y cada 6 horas" → "al salir, al apagar Windows y cada 6 horas".
   - `GUIA-PRUEBAS.md:27`: igual que Copias. `GUIA-PRUEBAS.md:124` (paso 6): "Cerrar Hornera en el servidor" →
     "En el servidor, cerrar la ventana: la terminal sigue andando. Después, clic derecho en el ícono de la bandeja →
     Salir: la terminal muestra que no puede conectar."
   - `server/backup.ts:1` y `DECISIONES.md:166`: "al cerrar" → "al salir".
   Verificación: `grep -rn "al cerrar la app" manual/manual.html GUIA-PRUEBAS.md` → sin resultados.

## Fuera de alcance
- Regenerar capturas o el PDF del manual (se hace al final de la tanda).
- La entrada de inicio automático que queda en el registro al desinstalar (Windows ignora un exe que no existe).
- Ícono propio para la bandeja (hoy usa el del .exe).

## Listo cuando
- `npm run typecheck` y `npm test` → todo pasa.
- `grep -n "relaunch()" electron/main.ts` → solo la línea de `iniciarTerminal`.
- El grep del paso 2 → sin resultados.

## Mantenimiento
Todo `app.relaunch` del servidor tiene que sacar `--oculto`: si se agrega otro reinicio, reusar `sistema.reiniciar`.
