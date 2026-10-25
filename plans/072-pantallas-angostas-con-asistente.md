# 072 — Pantallas que quedan angostas con el asistente abierto

Escrito contra `61d882d` (v0.52.1). Revisión `improve deep` del rediseño del panel, extendida a todo `src/`.
Si los archivos citados no se parecen a los extractos, PARAR y avisar.

## Por qué
Desde v0.52.1 el panel del asistente corre la pantalla en vez de taparla (`src/App.tsx`: `marginRight` del
`Layout.Content` = ancho del panel, 360–900 px). La ventana abre en 1280 px y el menú ocupa 200: con el panel en
420 a la pantalla le quedan ~660 px. Dos cosas no se acomodan:

1. **Tablas sin scroll horizontal.** Solo 10 de las 68 `<Table>` de `src/` tienen `scroll={{ x: 'max-content' }}`.
   Una tabla más ancha que su contenedor se sale por la derecha y queda debajo del panel (pasó en el Resumen, ya
   arreglado en `Resumen.tsx:79`). La convención del repo es esa prop; ejemplo, `src/Movimientos.tsx:283`:
   ```tsx
   <Table<Movimiento> rowKey="id" size="small" pagination={false} sticky scroll={{ x: 'max-content' }} loading={!!mes && !movimientos && !error}
   ```
2. **Fila de tarjetas con `span={4}` fijo.** `src/Resumen.tsx:60-69` y `src/ResumenHornera.tsx:58-64` ponen 6
   tarjetas `Statistic` en `<Row gutter={16}><Col span={4}>`: el ancho de cada una baja con la pantalla y los importes
   se parten en dos renglones (`$` arriba, `31.977.424,00` abajo). Los `Col` responsivos de antd (`md=`, `xl=`) no
   sirven: miran el ancho de la **ventana**, que no cambia al abrir el panel.

## Pasos
1. Agregar `scroll={{ x: 'max-content' }}` a estas tablas de primer nivel (las que ocupan el ancho de la pantalla).
   Si la tabla ya tiene `scroll={{ y: 480 }}`, queda `scroll={{ x: 'max-content', y: 480 }}`:
   - `src/Deptos.tsx:90` (acciones de 230 px)
   - `src/Propietarios.tsx:197` (acciones de 280 px)
   - `src/GastosAjenos.tsx:164`
   - `src/Vencimientos.tsx:32`
   - `src/Cuentas.tsx:53`
   - `src/Limpieza.tsx:240`
   - `src/Resumen.tsx:116` (evolución, ya tiene `y: 480`)
   - `src/ResumenHornera.tsx:166` (evolución, ya tiene `y: 480`)
   De paso, en `src/Resumen.tsx:79` falta un espacio entre `scroll={{ x: 'max-content' }}` y `loading=`.
   **No** agregarlo a tablas anidadas (dentro de `expandable`, de un Drawer de 900 px o de un `Col` de
   `ResumenHornera`): `Liquidacion.tsx:150-152` documenta que una tabla interna con `max-content` dentro de otra se
   estira a 1.000.000 px. Tampoco a `Auditoria.tsx:56`: usa `tableLayout="fixed"` y ya se ajusta.
   Verificación: `npm run typecheck` → sin errores.
2. `src/Resumen.tsx` y `src/ResumenHornera.tsx`: cambiar la fila de tarjetas por una grilla que se acomoda al ancho
   real. `<Row gutter={16}>` → `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>`
   y cada `<Col span={4}>…</Col>` → solo su `<Card>` (sacar el `Col`). Mantener `Row`/`Col` en el resto de esos
   archivos (las filas `span={14}`/`span={10}` de `ResumenHornera.tsx:67` y `:99` quedan como están).
   Si `Row`/`Col` dejan de usarse en `Resumen.tsx`, sacarlos del import de `antd`.
   Verificación: `npm run typecheck`; en la app, Resumen con el panel en 420 px: las tarjetas pasan a dos filas y
   ningún importe se parte. Con el panel cerrado (≈ 1024 px útiles a 1280 de ventana) entran 5 por fila con 180 px;
   para mantener las 6 de hoy, usar `minmax(160px, 1fr)` y comprobar que "$ 31.977.424,00" entra en un renglón.
3. Recorrer con el panel abierto en 420 px las pantallas del paso 1 y las que ya tenían scroll: ninguna columna queda
   debajo del panel. Anotar en este plan cualquier pantalla que siga cortándose y PARAR antes de improvisar.

## Fuera de alcance
- El panel del asistente en sí (fecha "hoy/ayer", tope del ancho, teclado): plan 071.
- Columnas `ellipsis` o anchos de columnas: solo se agrega el scroll, no se rediseña ninguna tabla.
- Tablas de los Drawers de 900 px (`Deptos.tsx:92/96`, `Propietarios.tsx:212`, `Limpieza.tsx:155`, `Comprobantes.tsx:110`).

## Listo cuando
- `npm run typecheck` → sin errores. `npm test` → todos pasan.
- `grep -E "scroll=\{\{ ?x:" src/*.tsx | wc -l` → 18 (10 de antes + las 8 del paso 1).
- `grep -n "span={4}" src/Resumen.tsx src/ResumenHornera.tsx` → sin resultados.

## Mantenimiento
Toda tabla nueva de primer nivel lleva `scroll={{ x: 'max-content' }}` (la pantalla puede angostarse con el panel
abierto). Filas de tarjetas nuevas: grilla `auto-fill`, no `Col span` fijo.
