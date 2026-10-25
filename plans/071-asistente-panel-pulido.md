# 071 — Panel del asistente: pulido

Escrito contra `61d882d` (v0.52.1). Revisión `improve deep` del rediseño del panel, extendida a todo `src/`.
Si `src/Asistente.tsx` o `src/App.tsx` no se parecen a los extractos, PARAR y avisar.

## Por qué
Tres detalles del panel del asistente (`src/Asistente.tsx`, `PanelAsistente`; el ancho vive en `src/App.tsx`):

1. **"hoy/ayer" de Recientes se corre de noche.** `actualizada_en` es un sello en hora local con offset
   (`server/ia/asistente.ts:229` → `sello()` de `server/sello.ts`: `2026-10-24T22:05:00-03:00`), pero `cuando`
   compara contra la fecha **UTC** de hoy:
   ```ts
   // 'YYYY-MM-DD HH:MM:SS' → hoy / ayer / 22/10 (ponytail: la fecha de SQLite es UTC; a la noche puede correrse un día)
   const cuando = (f: string) => {
     const dia = (d: Date) => d.toISOString().slice(0, 10);
   ```
   Entre las 21 y las 24 h (Argentina, UTC−3) lo de hoy dice "ayer" y lo de ayer muestra la fecha. El comentario
   además explica la causa al revés. En el resto de `src/` "hoy" se arma en hora local con
   `new Date().toLocaleDateString('sv-SE')` (`Movimientos.tsx:27`, `Limpieza.tsx:23`, `GastosAjenos.tsx:19`):
   es la única excepción del repo.
2. **El ancho guardado no se limita a la ventana.** `App.tsx` lee `anchoAsistente` de `localStorage` sin tope y el
   Drawer permite hasta 900 px. La ventana abre en 1280 px (`electron/main.ts:52`, sin `minWidth`) y el menú ocupa
   200 px: con 900 al contenido le quedan 180 px, y en una terminal con pantalla chica, menos.
   ```ts
   const [anchoAsistente, setAnchoAsistente] = useState(() => {
     try { return Number(localStorage.getItem('anchoAsistente')) || 420; } catch { return 420; }
   });
   ```
3. **Las filas de Recientes no se usan con teclado.** Son `<div className="reciente-ia" onClick>`; es el único
   `div` con `onClick` de `src/`. La campanita ya resolvió lo mismo con un `<button>` (`src/Avisos.tsx:52-55`, plan 070):
   ```tsx
   <button key={a.clave} type="button" onClick={() => { abrir(false); irA(a.seccion); }}
     style={{ all: 'unset', boxSizing: 'border-box', display: 'flex', gap: 8, width: '100%', padding: '6px 4px', cursor: 'pointer', borderRadius: 4 }}
     onMouseEnter={resaltar} onMouseLeave={apagar} onBlur={apagar}
     onFocus={(e) => { resaltar(e); if (e.currentTarget.matches(':focus-visible')) e.currentTarget.style.outline = '2px solid #B5835A'; }}>
   ```

## Pasos
1. `src/Asistente.tsx`, `cuando`: comparar contra el día **local**, como el resto de la interfaz. Reemplazar `dia` por
   `(d: Date) => d.toLocaleDateString('sv-SE')` (da `YYYY-MM-DD` en hora local) y corregir el comentario:
   `// sello local con offset ('2026-10-24T22:05:00-03:00') → hoy / ayer / 22/10`. El "ayer" con
   `hoy.getTime() - 86400000` se queda (un cambio de horario no aplica en Argentina).
   Verificación: `npm run typecheck` → sin errores. A mano en la consola de DevTools de la app, después de las 21 h:
   una conversación de hoy dice "hoy".
2. `src/App.tsx`: limitar el ancho a lo que deja la ventana. Tope = `window.innerWidth - 200 (menú) - 560 (mínimo para
   la pantalla)`, nunca menos de 360. Calcularlo en el render
   (`const ancho = Math.min(anchoAsistente, Math.max(360, window.innerWidth - 760))`) y usar `ancho` en el
   `marginRight` del `Layout.Content` y en la prop `ancho` del panel. Para que se recalcule al cambiar el tamaño de la
   ventana, un `useEffect` con `resize` que fuerce un render (`const [, setVentana] = useState(0)`,
   `addEventListener('resize', () => setVentana((n) => n + 1))`, con su `removeEventListener`). No tocar lo guardado:
   si la ventana vuelve a crecer, vuelve el ancho elegido.
   En `src/Asistente.tsx` el `maxSize={900}` pasa a `maxSize={Math.min(900, Math.max(360, window.innerWidth - 760))}`.
   Verificación: `npm run typecheck`; en la app, arrastrar el panel a 900, achicar la ventana a ~1100 px: el panel se
   achica solo y la pantalla de al lado conserva al menos 560 px.
3. `src/Asistente.tsx`, Recientes: la fila pasa a `<button type="button" className="reciente-ia" onClick={() => abrir(c.id)}>`.
   En `index.html`, a `.reciente-ia` sumarle `all: unset; box-sizing: border-box; width: 100%;` **antes** de las
   propiedades que ya tiene (`display: flex; gap; padding; border-bottom; cursor; border-radius`) y agregar
   `.reciente-ia:focus-visible { outline: 2px solid #B5835A; }`. Se usa CSS y no `onFocus` porque la fila ya tiene clase.
   Verificación: en la app, con el panel vacío, Tab llega a cada conversación, se ve el contorno y Enter la abre.

## Fuera de alcance
- Tablas y tarjetas de las pantallas que quedan angostas con el panel abierto: plan 072.
- La fecha de vencimiento de certificados (`server/emisores.ts:140`, `src/Emisores.tsx:21`): compara UTC con UTC, está bien.
- `server/avisos.ts`, `server/ficha.ts`, `server/cotizacion.ts`: ya usan hora local.

## Listo cuando
- `npm run typecheck` → sin errores. `npm test` → todos pasan (no hay tests de interfaz; no agregar).
- `grep -n "toISOString" src/Asistente.tsx` → sin resultados.
- `grep -n "<div[^>]*onClick" src/*.tsx` → sin resultados.

## Mantenimiento
"Hoy" en la interfaz siempre con `toLocaleDateString('sv-SE')`, nunca `toISOString()`. Una lista clickeable nueva
usa `<button>` (como `Avisos.tsx` y Recientes). Si se agrega `minWidth` a la ventana en `electron/main.ts`, el
tope del paso 2 sigue valiendo igual.
