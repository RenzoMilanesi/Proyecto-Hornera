# Plan 078: Colores y tamaños solo del tema (y que no se vuelva a desordenar)

> **Executor**: seguí los pasos en orden; corré cada verificación y confirmá el resultado antes de seguir. Si pasa algo
> de "PARAR si", frená y avisá: no improvises. Al terminar, actualizá la fila 078 de `plans/README.md`.
>
> **Drift check (primero)**: `git diff --stat d1151db..HEAD -- src/ index.html`
> Si cambió, compará los extractos de abajo con el código actual; si no coinciden, PARAR.

## Estado
- **Prioridad**: P2 · **Esfuerzo**: M · **Riesgo**: BAJO (solo apariencia) · **Depende de**: nada · **Categoría**: deuda de interfaz / accesibilidad
- **Escrito contra**: `d1151db` (v0.53.4), 2026-10-25. Auditoría de buenas prácticas de estilos de `src/`.

## Diagnóstico

### Lo que está bien (no tocar)
- **Una sola librería de interfaz** (Ant Design 6) con tema propio en `ConfigProvider` (`src/main.tsx`, tema "Ladrillo"),
  locale `es_ES` y fuente local (IBM Plex Sans): la base correcta.
- **Patrones documentados y reusados**: skill `modales`, clase `.ficha`, `entradaPlata` / `pesos` en `src/api.ts`
  (7 pantallas los usan), `useUnaVez` contra el doble clic.
- **Consistencia de componentes**: 34 `Popconfirm` para lo destructivo, 79 `Alert` para errores/avisos, 42 `loading=`,
  tablas casi todas `size="small"`, `Typography type="secondary"` (79 usos) para texto de apoyo.
- **Accesibilidad básica cuidada**: botones reales (`<button>`) en filas clicables, `:focus-visible`, `aria-label` en la
  campanita, atajo Ctrl+K, diseño que se adapta con container queries (`.tarjetas-kpi`).
- **Gráfico de Liquidación**: rojo y verde van juntos, pero la deuda además lleva rayas (no depende solo del color).

### Lo que no se respeta
1. **La paleta vive en tres lugares y se desparramó.** Hay **49 colores hex distintos** entre `src/main.tsx` (tema),
   `index.html` (CSS global) y estilos inline en 9 archivos `.tsx`. Ejemplos:
   - **Dos rojos de error**: el tema define `colorError: '#B42318'`, pero `Avisos.tsx` usa `#cf1322`, `Asistente.tsx`
     `#A8071A` y `Copias.tsx` `#ffccc7` (los rojos por defecto de antd, no los del tema).
   - **Cinco grises para "texto secundario"**: el tema dice `#6E6259`; inline aparecen `#8A7E74`, `#A39588`, `#B3A698`,
     `#4A3F37`.
2. **Contraste insuficiente (WCAG AA pide 4,5:1 para texto chico).** Medido:
   - `#A39588` sobre blanco: **2,91:1** — el aviso de privacidad del asistente ("se envían a Anthropic", 11,5 px) y las
     fechas de "Recientes".
   - `#8A7E74` sobre blanco: **3,95:1** — el pie de cada respuesta del asistente (12 px) y el título "Recientes".
   - El gris del tema (`#6E6259`) da 5,91:1: alcanza con usar el del tema.
3. **Tamaños de letra fuera de escala**: 10 tamaños inline distintos (11, 11,5, 12, 12,5, 13, 14, 14,5, 16, 18, 20). La
   escala de antd es 12 / 14 / 16 / 20 / 24; 11,5, 12,5 y 14,5 no aportan nada visible.
4. **Hover hecho a mano con JavaScript** en `Avisos.tsx` (`resaltar` / `apagar` mutan `style.background` y `outline`),
   cuando `index.html` ya resuelve lo mismo con CSS para `.reciente-ia` (`:hover`, `:focus-visible`).
5. **Formato de fecha repetido**: `iso → dd/mm/aaaa` está copiado en `Emisores.tsx:19` e `Imprimir.tsx:12`;
   `toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })` en `Comprobantes`, `Copias` y `Terminales`;
   `new Date().toLocaleDateString('sv-SE')` (hoy) en `Limpieza`, `Movimientos` y `GastosAjenos`. `pesos` ya está
   centralizado; las fechas no.

### Lo que NO es un problema (descartado)
- **237 `style={{…}}` inline**: casi todos son márgenes y anchos (`marginTop: 16`, `width: '100%'`). Con Ant Design es lo
  idiomático; migrarlos a CSS modules o Tailwind es trabajo sin beneficio para el usuario. Solo se tocan los que llevan
  **color** o **tamaño de letra**.
- **`Imprimir.tsx`** usa Arial y grises propios: es la hoja para el PDF, sin antd y pensada para impresora. Queda igual.
- **Colores del gráfico de Liquidación**: paleta categórica de datos, no de interfaz. Se mudan a `tema.ts` (paso 1) para
  que estén con el resto, sin cambiar los valores.
- **No** agregar Tailwind, styled-components, Storybook ni un "design system": el tema de antd ya lo es.

## Pasos

### 1. Un solo archivo con la paleta: `src/tema.ts`
Mover el objeto `tema` (y la constante `marron`) de `src/main.tsx` a un archivo nuevo `src/tema.ts` que exporte:
```ts
export const tema: ThemeConfig = { /* el mismo de main.tsx, sin cambios */ };
// Colores que no son tokens de antd: menú lateral, avisos y el gráfico de Liquidación.
export const colores = {
  menuTitulo: '#fff', menuLink: '#E8C9A8', menuVersion: '#B3A698',
  avisoNaranja: '#d46b08', avisoInfo: '#8c8c8c', foco: '#B5835A',
  costos: '#B4B2A9', hornera: '#F0997B', gastos: '#EF9F27', propietario: '#1D9E75', deuda: '#E24B4A', deudaRaya: '#F7C1C1',
};
```
`main.tsx` importa `tema` de ahí. **Verificar**: `npm run typecheck` pasa y la app se ve igual (`npm run dev`).

### 2. Reemplazar los hex inline por el tema
| Dónde | Hoy | Queda |
|---|---|---|
| `Asistente.tsx` pie (`#8A7E74`), aviso de privacidad y fechas (`#A39588`), "Recientes" | `<div style={{ color: … }}>` | `<Typography.Text type="secondary">` (o `token.colorTextSecondary` con `theme.useToken()` si es un `div` de bloque) |
| `Asistente.tsx:162` error de herramienta (`#A8071A`) | `<span style={{ color }}>` | `<Typography.Text type="danger">` |
| `Asistente.tsx:163` fondo del SQL (`#F5EFE9`) | inline | `token.colorFillTertiary` o dejarlo en una clase de `index.html` junto a `.md-ia pre` (mismo color) |
| `Asistente.tsx:187` borde de propuesta pendiente (`#A8461F`) | inline | `token.colorPrimary` |
| `Avisos.tsx` `COLOR.rojo` (`#cf1322`) | constante | `token.colorError` |
| `Avisos.tsx` `COLOR.naranja`, `COLOR.info`, ícono `#4A3F37` | constante | `colores.avisoNaranja`, `colores.avisoInfo`, `token.colorText` |
| `Copias.tsx:82` borde (`#ffccc7`) | inline | `token.colorErrorBorder` |
| `ResumenHornera.tsx:15` rojo negativo (`#B42318`) | inline | `token.colorError` (o pasar `rojo` a usar `colorError` vía `theme.useToken()` en el componente) |
| `App.tsx:134-139` textos del menú lateral | hex | `colores.menuTitulo` / `menuLink` / `menuVersion` |
| `App.tsx:150` ayuda de la pantalla (`#4A3F37`) | hex | `token.colorTextSecondary` (sube de contraste) o `type="secondary"` |
| `Liquidacion.tsx:33-57` colores del gráfico | hex | `colores.*` (mismos valores) |

`index.html` puede seguir con sus hex (es un solo lugar y coincide con el tema). Si querés que lea del tema: en la app
abierta, en DevTools, `getComputedStyle(document.documentElement).getPropertyValue('--ant-color-primary')`; si devuelve
el terracota, reemplazar los hex de `index.html` por `var(--ant-color-primary)`, `var(--ant-color-border-secondary)`,
etc. Si devuelve vacío, **no** forzarlo: dejar los hex.

**Verificar**: `grep -n "#[0-9a-fA-F]\{3,6\}\b" src/*.tsx` solo muestra `Imprimir.tsx`. Abrir el asistente: el pie, el
aviso de privacidad y "Recientes" se leen más oscuros (gris del tema).

### 3. Tamaños de letra a la escala
En `Asistente.tsx` y `Resumen.tsx`: `11.5` → `12`, `12.5` → `12`, `14.5` (`.md-ia` en `index.html`) → `14`.
Donde el texto ya es `Typography.Text type="secondary"` de apoyo, preferir `token.fontSizeSM` (12) a un número.
**Verificar**: `grep -o "fontSize: [0-9.]*" src/*.tsx | sort -u` no muestra decimales.

### 4. Hover de la campanita con CSS
En `index.html`, al lado de `.reciente-ia`, agregar `.aviso-fila` con el mismo patrón (`all: unset`, `:hover` con fondo
`#f5f0eb`, `:focus-visible` con `outline: 2px solid #B5835A`). En `Avisos.tsx` usar `className="aviso-fila"`, sacar el
`style` largo del `<button>` y borrar `resaltar` / `apagar` y los cuatro `onMouseEnter/onMouseLeave/onBlur/onFocus`.
**Verificar**: abrir la campanita con avisos; pasar el mouse y moverse con Tab: se resalta igual que antes.

### 5. Fechas junto a `pesos` en `src/api.ts`
Agregar al lado de `pesos`:
```ts
// "2026-10-25" → "25/10/2026"
export const fecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
// Fecha y hora cortas: "25/10/26, 14:30"
export const fechaHora = (v: string) => new Date(v).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
// Hoy en ISO, hora local (no UTC).
export const hoy = () => new Date().toLocaleDateString('sv-SE');
```
Reemplazar las copias en `Emisores`, `Comprobantes`, `Copias`, `Terminales`, `Limpieza`, `Movimientos` y `GastosAjenos`.
`Imprimir.tsx` puede importar `fecha` de `api.ts` (ya importa de ahí) o quedarse con la suya: no importa.
**No** tocar `Auditoria.tsx:24` (formato propio sin año, a propósito) ni `cuando` del asistente.
**Verificar**: `npm run typecheck`; las pantallas Copias, Terminales y Comprobantes muestran las fechas igual que antes.

### 6. Que no vuelva: un test y una regla
- `src/estilos.test.ts` (ya corre con `npm test`, igual que `src/api.test.ts`): leer cada `src/*.tsx` salvo
  `Imprimir.tsx` y fallar si encuentra `/#[0-9a-fA-F]{3,6}\b/`, indicando archivo y línea. Mensaje: "Color suelto: usá
  el tema (src/tema.ts) o Typography type".
- En `CLAUDE.md`, sección Reglas, una línea: *Colores y tamaños de letra: del tema (`src/tema.ts`, `theme.useToken()`,
  `Typography type`); nada de hex sueltos en `src/*.tsx` (lo controla `src/estilos.test.ts`). `Imprimir.tsx` es la
  excepción (hoja del PDF).*
- En la skill `modales`, en el bloque de reglas, la misma idea en una línea.

**Verificar**: `npm test` pasa; agregar a mano un `color: '#123456'` en cualquier `.tsx` hace fallar el test; sacarlo.

## Al terminar
- Recorrer en la app: menú lateral, Resumen, Liquidación (gráfico), campanita, asistente (vacío y con una respuesta),
  Copias. Todo igual salvo los grises del asistente, ahora más legibles.
- No regenerar capturas ni el PDF del manual por esto (cambio visual menor).
- Commit con la skill `commit-version` (patch: no cambia funciones).
