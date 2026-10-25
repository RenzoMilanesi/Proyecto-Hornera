# Plan 075: La terminal avisa en español cuando se corta el servidor en pleno uso, y vuelve al código si la revocan

> **Executor**: seguí los pasos en orden; corré cada verificación y confirmá el resultado antes de seguir. Si pasa algo
> de "PARAR si", frená y avisá: no improvises. Al terminar, actualizá la fila 075 de `plans/README.md`.
>
> **Drift check (primero)**: `git diff --stat 2752357..HEAD -- src/api.ts src/App.tsx src/EnArca.tsx src/Transferencias.tsx`
> Si alguno cambió, compará los extractos de abajo con el código actual; si no coinciden, PARAR.

## Estado
- **Prioridad**: P1 · **Esfuerzo**: M · **Riesgo**: BAJO · **Depende de**: nada · **Categoría**: bug
- **Escrito contra**: `2752357`, 2026-10-25. Revisión `improve deep` de terminales y reconexión.

## Por qué
Hornera es una app Electron. Una **terminal** es otra PC cuya ventana abre la app (React) servida por la PC
**servidor** (`http://<servidor>:4310`). Toda la interfaz habla con la API con `fetch` relativo (`src/api.ts`).

1. **Corte en medio del uso.** Si el servidor se apaga o se cae la red con la terminal ya adentro de la app, `fetch`
   rechaza con `TypeError("Failed to fetch")`. `pedir` no lo atrapa, así que cada pantalla muestra **"Failed to
   fetch"** (en inglés, sin explicar nada), y al guardar la persona no sabe si se guardó. Tampoco hay aviso de que
   volvió la conexión.
2. **Terminal revocada en uso.** Si en el servidor revocan la terminal (Terminales → Revocar), la API responde
   `401 { error: 'Esta PC no está emparejada con el servidor', emparejar: true }` (`server/terminales.ts`, `autorizar`).
   La pantalla de emparejar (`<Emparejar />`) solo aparece si el 401 llega en el `fetch('/api/estado')` del
   arranque (`src/App.tsx` líneas 73-80), así que hasta reiniciar cada pantalla muestra ese error.

### Estado actual
`src/api.ts`:
```ts
async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  if (propuestaEnEdicion.id != null && init?.method && init.method !== 'GET' && !ruta.startsWith('adjuntos')) {
    init = { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Hornera-Ia': String(propuestaEnEdicion.id) } };
  }
  const res = await fetch(`/api/${ruta}`, init);
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw Object.assign(new Error(cuerpo?.error ?? `${res.status} ${res.statusText}`), { cuerpo }); // el cuerpo, por si trae más que el error
  }
  return res.json();
}
```
`descargarPdfComprobante` (mismo archivo) hace `const r = await fetch(\`/api/comprobantes/${id}/pdf\`);`.
Otros `fetch` directos de la interfaz: `src/EnArca.tsx:39` y `src/Transferencias.tsx:328`.

`src/App.tsx` (contenido de la pantalla):
```tsx
        <Typography.Paragraph style={{ marginBottom: 20, color: '#4A3F37' }}>{actual.ayuda}</Typography.Paragraph>
        {/* key: estado nuevo por sección, y al guardar algo desde el asistente (ponytail: se vuelve a montar y relee todo) */}
        <div key={`${seccion}-${refresco}`}>{actual.vista}</div>
```
Imports de antd en `src/App.tsx`: `import { Button, Layout, Menu, Space, Typography } from 'antd';`.

### Convenciones del repo
- Textos en español rioplatense ("revisá", "podés"). Comentarios cortos que dicen el porqué.
- Estilo mínimo: sin librerías nuevas ni abstracciones de más. Un comentario `ponytail:` marca una simplificación a propósito.
- Alertas con antd: `<Alert type="..." showIcon title="..." />` (el repo usa `title`, no `message`; ver `src/Emparejar.tsx`).

## Pasos
1. **`src/api.ts`: un `fetch` que traduce el corte.** Arriba de `pedir`, agregar:
   ```ts
   // Sin conexión con el servidor (terminal con el servidor apagado o la red cortada): fetch tira TypeError.
   // Se avisa a App (banner "Sin conexión") y el error dice qué pasó.
   export const SIN_CONEXION = 'Se cortó la conexión con el servidor: no se guardó ni se trajo nada. Revisá que la PC servidor esté prendida, con Hornera abierta.';
   export async function red(url: string, init?: RequestInit) {
     try {
       return await fetch(url, init);
     } catch {
       globalThis.dispatchEvent?.(new Event('hornera:sin-conexion'));
       throw new Error(SIN_CONEXION);
     }
   }
   ```
   En `pedir`, cambiar `await fetch(` por `await red(`. Dentro del `if (!res.ok)`, después de leer `cuerpo`, agregar:
   ```ts
   if (res.status === 401 && cuerpo?.emparejar) globalThis.location?.reload(); // revocada: App vuelve a pedir el código
   ```
   En `descargarPdfComprobante`, `src/EnArca.tsx:39` y `src/Transferencias.tsx:328`: `fetch(` → `red(` (importar `red`
   de `./api.ts` donde haga falta). **No** tocar el `fetch('/api/estado')` de `src/App.tsx` ni los de `src/Imprimir.tsx`.
   Verificación: `npm run typecheck` → sin errores.
2. **Test.** En `src/api.test.ts` (patrón: el test de `leerPlata` del mismo archivo), agregar:
   ```ts
   test('sin conexión: el error dice qué pasó, no "Failed to fetch"', async () => {
     const original = globalThis.fetch;
     globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
     try {
       await assert.rejects(get('deptos'), { message: SIN_CONEXION });
     } finally {
       globalThis.fetch = original;
     }
   });
   ```
   (importar `get` y `SIN_CONEXION` junto a `leerPlata`). Verificación: `npm test` → `fail 0`, y el test nuevo aparece con ✔.
3. **`src/App.tsx`: banner de conexión.** Agregar `Alert` al import de antd. Junto a los otros `useState`:
   ```ts
   const [conexion, setConexion] = useState<'ok' | 'cortada' | 'volvio'>('ok');
   ```
   Junto a los otros `useEffect`:
   ```ts
   useEffect(() => {
     const alCortarse = () => setConexion('cortada');
     window.addEventListener('hornera:sin-conexion', alCortarse);
     return () => window.removeEventListener('hornera:sin-conexion', alCortarse);
   }, []);
   // Cortada: se prueba cada 3 s; al volver, aviso unos segundos. No se recarga la pantalla: se perdería lo que se estaba escribiendo.
   useEffect(() => {
     if (conexion === 'ok') return;
     if (conexion === 'volvio') {
       const t = setTimeout(() => setConexion('ok'), 5000);
       return () => clearTimeout(t);
     }
     const t = setInterval(() => fetch('/api/estado').then((r) => r.ok && setConexion('volvio'), () => {}), 3000);
     return () => clearInterval(t);
   }, [conexion]);
   ```
   Arriba del `<div key={`${seccion}-${refresco}`}>`:
   ```tsx
   {conexion === 'cortada' && <Alert type="warning" showIcon style={{ marginBottom: 16 }}
     title="Sin conexión con el servidor. Se sigue intentando solo; lo que no se guardó, hay que volver a guardarlo cuando vuelva." />}
   {conexion === 'volvio' && <Alert type="success" showIcon style={{ marginBottom: 16 }} title="Volvió la conexión con el servidor." />}
   ```
   Verificación: `npm run typecheck` → sin errores; `npm test` → `fail 0`.
4. **Prueba manual** (dos ventanas en esta PC; el puerto 4310 tiene que estar libre: si `npm run dev` está abierto, PARAR y pedir que lo cierren).
   - Servidor de prueba: carpeta temporal `S` con `rol.json` = `{"rol":"servidor"}`; `npx electron . --user-data-dir=S`.
   - Terminal: carpeta temporal `T` con `rol.json` = `{"rol":"terminal","servidor":"http://127.0.0.1:4310"}`; `npx electron . --user-data-dir=T`.
   - Con la terminal en Movimientos, cerrar el servidor (clic derecho en el ícono de la bandeja → Salir). Tocar otra
     pantalla en la terminal: aparece el banner amarillo y el error dice "Se cortó la conexión…", no "Failed to fetch".
   - Volver a abrir el servidor: en ≤ 3 s el banner pasa a verde y desaparece a los 5 s.
   - (127.0.0.1 no necesita emparejar, así que la revocación se prueba con el test de `server/terminales.test.ts`
     existente y leyendo el código: no hace falta una prueba manual.)

## PARAR si
- `pedir` ya no usa `fetch` directo, o `App.tsx` ya tiene un manejo de conexión: el código cambió, avisar.
- `globalThis.dispatchEvent` rompe el typecheck: avisar en vez de silenciarlo con `any`.

## Fuera de alcance
- `electron/main.ts` y `electron/terminal.html` (la pantalla "Conectando…" del arranque: plan 076).
- El servidor (`server/`). `src/Imprimir.tsx` (solo lo usa el servidor para armar PDFs).
- Reintentar automáticamente un guardado que falló: la persona lo vuelve a guardar (no duplicar movimientos).

## Hecho cuando
- `npm run typecheck` sin errores y `npm test` con `fail 0`, incluido el test nuevo.
- `grep -n "await fetch(" src/api.ts src/EnArca.tsx src/Transferencias.tsx` → solo la línea dentro de `red`.
- Prueba manual del paso 4 hecha.

## Mantenimiento
Un `fetch` nuevo en la interfaz debería usar `red` (o `get`/`enviar`) para que el corte se explique igual.
Si algún día se agrega WebSocket (DECISIONES.md lo descarta por ahora), el banner puede escucharlo en vez de probar cada 3 s.
