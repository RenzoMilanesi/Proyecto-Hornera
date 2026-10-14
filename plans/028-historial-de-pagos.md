# Plan 028: Historial de pagos por depto y por propietario

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación antes de
> pasar al siguiente. Si aparece una condición STOP, frená y reportá: no improvises.
> Al terminar, marcá el estado en `plans/README.md`.
>
> **Drift check (correr primero)**:
> `git diff --stat d848dea..HEAD -- schema.sql schema.check.mjs server/db.ts server/app.test.ts server/liquidacion/cierre.ts server/liquidacion/pagos.ts server/importador/excel.ts server/app.ts src/App.tsx src/Deptos.tsx src/Propietarios.tsx src/Transferencias.tsx`
> Si alguno cambió, compará los extractos de "Estado actual" con el código; si no
> coinciden, es una condición STOP.

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MED (cambio de esquema) · **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `d848dea`, 2026-10-14

## Por qué
Hoy los pagos a propietarios solo se ven mes por mes, en Transferencias. Para contestarle a un
propietario ("¿cuánto me pagaron y cuándo?") y para el control interno ("¿qué quedó sin pagar?")
hay que recorrer mes por mes. Este plan agrega un **historial**: una fila por mes y por depto, con
su saldo, lo pagado, lo pendiente y el estado. También guarda **quién era el dueño** de cada
liquidación, para que un depto que cambia de manos no le pase sus pagos viejos al dueño nuevo.

## Decisiones ya tomadas con el usuario (no reabrir)
| Tema | Decisión |
|---|---|
| Uso | Contestarle al propietario **y** hacer control interno |
| Dónde | Pantalla propia "Historial" (grupo **Mes** del menú) **y** acceso directo desde cada fila de Deptos y Propietarios (panel lateral `Drawer`) |
| Fila | Una por **mes × depto**: saldo, pagado, pendiente, estado (`pagado` / `parcial` / `debe` / `pasó a AAAA-MM` / `en curso`). Al desplegarla se ven los pagos |
| Dueño | El del **mes de la liquidación**: se guarda al cerrar. Los meses ya cerrados toman el dueño actual (backfill) |
| Desde cuándo | Solo meses que están en la app (tabla `periodo`). `historico_mensual` (Excel viejo) **no** entra |
| Mes abierto | **Se incluye**, marcado `en curso`, con el saldo calculado en el momento (`liquidarPeriodo`) y sin pagos |
| Anulados | Ocultos; interruptor "Ver anulados" los muestra tachados y **no** suman |
| Totales | Arriba de la tabla: pagado y pendiente, **por moneda** |
| Exportar | **No** (fuera de alcance) |
| Acciones | "Marcar pagado" y "Anular pago" también desde el historial (solo meses cerrados) |
| Varios deptos | Por propietario: una fila por mes × depto, con filtro por depto y totales del propietario |

## Estado actual

- `schema.sql:356-391` — tabla `liquidacion` (snapshot al cerrar). **No** tiene propietario:
  ```sql
  CREATE TABLE liquidacion (
      id                     INTEGER PRIMARY KEY,
      periodo_id             INTEGER NOT NULL,
      depto_id               INTEGER NOT NULL,
      ...
      saldo_final_ars        INTEGER NOT NULL,
      saldo_final_usd        INTEGER NOT NULL,
      movimiento_pago_id     INTEGER,              -- se completa al marcar "pagado"
      pdf_path               TEXT,
      calculada_en           TEXT    NOT NULL,
  ```
- `server/db.ts:10-52` — `MIGRACIONES`: array de strings SQL; `MIGRACIONES[i]` lleva la versión
  i+1 a la i+2. Hoy la última es `// 6 → 7: reservas canceladas...` (línea 47). Ejemplo a copiar:
  ```ts
  // 5 → 6: propietario vinculado con su par de Stays.
  `ALTER TABLE propietario ADD COLUMN stays_owner_id TEXT;
   CREATE UNIQUE INDEX uq_propietario_stays ON propietario(stays_owner_id);`,
  ```
- `server/liquidacion/cierre.ts:36-54` — `cerrarPeriodo` inserta cada `liquidacion` con 25 columnas
  (`INSERT INTO liquidacion(periodo_id, depto_id, cambio, ... saldo_final_usd, calculada_en)`).
  `calculo.deptos` viene de `liquidarPeriodo` y cada `d` tiene `d.deptoId`.
- `server/importador/excel.ts:351-356` — el importador del Excel también inserta `liquidacion`
  (26 columnas, incluye `movimiento_pago_id`).
- Fixtures de tests que insertan `liquidacion` **sin** propietario: `server/liquidacion/servicio.test.ts`,
  `server/stays/sync.test.ts`, `server/resumen.test.ts`, `schema.check.mjs:34-38`. Por eso la columna
  nueva es **nullable** y las consultas usan `COALESCE(l.propietario_id, d.propietario_id)`.
- `server/liquidacion/pagos.ts:25-48` — `listarTransferencias(db, mes)`: por cada liquidación del mes
  calcula `saldo`, `pagado`, `pendiente`, `arrastradoA` (el mes siguiente ya está cerrado) y `pagos`
  (solo `estado = 'vigente'`). Hace `JOIN propietario pr ON pr.id = d.propietario_id` (dueño **actual**).
  `pagarLiquidacion` (línea 52) valida y crea el movimiento `tipo = 'liquidacion'`.
- Pagos = `movimiento` con `tipo = 'liquidacion'`, `depto_id`, `periodo_id`; anular = `POST
  /api/movimientos/:id/anular` (ya existe, lo usa `src/Transferencias.tsx:69`).
- `server/liquidacion/servicio.ts:37` — `liquidarPeriodo(db, mes)`: liquidación del mes **abierto**
  (devuelve `deptos: LiquidacionDepto[]` con `deptoId`, `codigo`, `propietario`, `moneda`,
  `resultado.saldo.{ars,usd}`; `cambio === null` si falta la cotización → `deptos` vacío).
- `server/app.ts:309-310` — rutas `GET /api/transferencias?mes=` y `POST /api/liquidaciones/:id/pagar`.
- `src/Transferencias.tsx:13-46` — `FormPago` (modal "Marcar pagado"), hoy **no exportado**.
- `src/App.tsx` — objeto `secciones` con `grupo`, `titulo`, `ayuda`, `vista`; el menú agrupa por `grupo`.
- `src/Deptos.tsx`, `src/Propietarios.tsx` — tablas con buscador; filas tipadas `Depto` / `Propietario` con `id`.

### Convenciones del repo (de `CLAUDE.md`)
- TypeScript sin build: nada de `enum`, `namespace` ni parámetros de propiedad; imports con `.ts`.
- Plata en **centavos** (INTEGER). Fechas ISO.
- Cambio de esquema: `schema.sql` + migración en `server/db.ts` + `schema.check.mjs`, **juntos**.
- Sin abstracciones especulativas; comentario `ponytail:` para simplificaciones a propósito.
- Datos de tests ficticios ("Propietario Uno", "AAA"). Tests con `node:test` + `assert/strict`.
- Español en textos, comentarios y nombres.

## Comandos
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan (los del Excel real pueden salir `skipped`) + `schema OK` |
| Un test | `node --test server/liquidacion/historial.test.ts` | pasa |

## Scope
**In**: `schema.sql`, `schema.check.mjs`, `server/db.ts`, `server/app.test.ts`, `server/liquidacion/cierre.ts`,
`server/importador/excel.ts`, `server/liquidacion/pagos.ts`, `server/liquidacion/historial.ts` (crear),
`server/liquidacion/historial.test.ts` (crear), `server/app.ts`, `src/Historial.tsx` (crear),
`src/App.tsx`, `src/Deptos.tsx`, `src/Propietarios.tsx`, `src/Transferencias.tsx`, `package.json`
(versión), `ROADMAP.md`, `plans/README.md`.

**Out** (no tocar): el motor (`server/liquidacion/motor.ts`), el PDF (`hoja.ts`, `src/Imprimir.tsx`),
`historico_mensual`, Movimientos. Nada de exportar a Excel/PDF.

## Git
- Rama actual (`main`), un commit al final con la skill `commit-version`: **minor** (pantalla nueva +
  columna nueva) → `0.14.0`. Mensaje estilo `Feature: historial de pagos por depto y propietario`.
- No pushear.

## Pasos

### 1. Esquema: propietario de la liquidación
- `schema.sql`, tabla `liquidacion`, después de `depto_id`:
  ```sql
  propietario_id         INTEGER,              -- dueño al cerrar; NULL = el actual del depto
  ```
  y la FK `CONSTRAINT fk_liq_propietario FOREIGN KEY (propietario_id) REFERENCES propietario(id) ON DELETE RESTRICT ON UPDATE CASCADE`
  + `CREATE INDEX ix_liq_propietario ON liquidacion(propietario_id);`
- `server/db.ts`, nueva entrada al final de `MIGRACIONES`:
  ```ts
  // 7 → 8: dueño del depto al cerrar cada liquidación (historial por propietario).
  `ALTER TABLE liquidacion ADD COLUMN propietario_id INTEGER REFERENCES propietario(id);
   UPDATE liquidacion SET propietario_id = (SELECT propietario_id FROM depto WHERE depto.id = liquidacion.depto_id);
   CREATE INDEX ix_liq_propietario ON liquidacion(propietario_id);`,
  ```
  (SQLite no admite `ADD COLUMN` con `CONSTRAINT` nombrada: en la migración va `REFERENCES` inline.)
- `schema.check.mjs`: abre la base con `new DatabaseSync` **sin** `PRAGMA foreign_keys = ON`, así que
  no puede probar la FK. Agregar después del bloque "Período cerrado":
  `assert.equal(db.prepare('SELECT propietario_id FROM liquidacion').get().propietario_id, null);`
- `server/app.test.ts` (también en scope) tiene dos tests de migración que hay que actualizar:
  - `'una base del esquema 1 migrada queda igual que una base nueva'` (línea 160): arma la base v1
    quitándole a `schema.sql` lo que agregó cada migración. Agregar dos `.replace` para quitar la
    línea `propietario_id …` de `liquidacion` y el `CREATE INDEX ix_liq_propietario …;`, y sumar
    "ni el dueño de la liquidación (7 → 8)" al comentario. Si también pusiste la FK nombrada
    (`CONSTRAINT fk_liq_propietario …`), quitarla con otro `.replace`. El test compara nombres de
    columnas, `notnull` e índices (no el SQL), así que FK nombrada vs. inline no lo rompe.
  - `'una base del esquema 1 conserva sus datos al migrar'` (línea 190): la base v1 mínima crea
    `depto (id INTEGER PRIMARY KEY)` **sin** `propietario_id`, y el `UPDATE` del backfill la
    referencia → la migración fallaría. Cambiar esa línea a
    `CREATE TABLE depto (id INTEGER PRIMARY KEY, propietario_id INTEGER) STRICT;` con el comentario
    "-- lo tocan las migraciones 4 → 5 y 7 → 8".

**Verify**: `npm test` → pasa, incluidos los dos tests de migración de `server/app.test.ts` y `schema OK`.

### 2. Guardar el dueño al cerrar y al importar
- `server/liquidacion/cierre.ts`: agregar `propietario_id` a la lista de columnas y un `?` más; el valor:
  `(SELECT propietario_id FROM depto WHERE id = ?)` no sirve dentro de `VALUES` posicional con `.get(...)`
  sin repetir el id, así que antes del `for` preparar
  `const duenio = db.prepare('SELECT propietario_id FROM depto WHERE id = ?');` y pasar
  `(duenio.get(d.deptoId) as { propietario_id: number }).propietario_id`.
- `server/importador/excel.ts:351`: igual (columna + valor del dueño del depto al importar).

**Verify**: `npm test` → pasa. Agregar en `server/liquidacion/cierre.test.ts` una aserción: tras
`cerrarPeriodo`, `SELECT propietario_id FROM liquidacion` = id del propietario del depto.

### 3. Transferencias usa el dueño del mes
- `server/liquidacion/pagos.ts`, `listarTransferencias`: cambiar
  `JOIN propietario pr ON pr.id = d.propietario_id` por
  `JOIN propietario pr ON pr.id = COALESCE(l.propietario_id, d.propietario_id)`.
- Agregar `propietarioId: number` a `interface Transferencia` (seleccionar `pr.id AS propietario_id`).

**Verify**: `npm test` → pasa.

### 4. Servidor: `historial`
Crear `server/liquidacion/historial.ts`:
```ts
export interface FilaHistorial {
  mes: string;
  enCurso: boolean;                 // mes abierto: saldo estimado, sin pagos
  liquidacionId: number | null;     // null si enCurso
  codigo: string; depto: string; propietarioId: number; propietario: string;
  moneda: 'ARS' | 'USD';
  saldo: number; pagado: number; pendiente: number;
  estado: 'pagado' | 'parcial' | 'pendiente' | 'debe' | 'arrastrado' | 'en_curso';
  arrastradoA: string | null;
  pagos: { id: number; fecha: string; importe: number; cuenta: string | null; anulado: boolean }[];
}
export function historial(db, filtro: { deptoId?: number; propietarioId?: number }, anulados: boolean): FilaHistorial[]
```
- Meses cerrados: para cada `periodo` con `estado = 'cerrado'` (orden `mes DESC`), llamar
  `listarTransferencias(db, mes)` y filtrar por `deptoId` (necesita el `depto_id`: agregarlo a
  `Transferencia` como `deptoId` en el paso 3) o por `propietarioId`.
  ponytail: una consulta por mes; con ~12 meses/año alcanza, una sola consulta si crece a cientos.
- Estado: `saldo < 0` → `debe`; `arrastradoA` y `pendiente > 0` → `arrastrado`; `pendiente === 0` →
  `pagado`; `pagado > 0` → `parcial`; si no → `pendiente`.
- Anulados (`anulados = true`): sumar a `pagos` los movimientos `tipo = 'liquidacion' AND estado =
  'anulado'` del mismo `periodo_id` y `depto_id`, con `anulado: true`, **sin** cambiar `pagado`.
- Mes abierto: el `periodo` con `estado = 'abierto'` (si hay); `liquidarPeriodo(db, mes)`; si
  `cambio === null` no agrega filas. Para cada depto que pase el filtro (por propietario: el dueño
  **actual** del depto): `saldo` = `resultado.saldo` en la moneda del depto (`moneda === 'USD' ?
  saldo.usd : saldo.ars`), `pagado = 0`, `pendiente = saldo`, `estado = 'en_curso'`, `pagos = []`.
  Va primero (es el mes más nuevo).
- `server/app.ts`, junto a la línea 309:
  `app.get('/api/historial', (req, res) => intentar(res, () => historial(db, { deptoId: Number(req.query.depto) || undefined, propietarioId: Number(req.query.propietario) || undefined }, req.query.anulados === '1')));`
  `historial` tira `new Error('Elegí un depto o un propietario.')` si el filtro viene vacío;
  `intentar` (`server/app.ts:246-252`) lo devuelve como 400 `{ error }`.

**Verify**: `npm run typecheck` → exit 0.

### 5. Tests del historial
Crear `server/liquidacion/historial.test.ts` con el patrón de `server/liquidacion/cierre.test.ts`
(base en memoria con `abrirDb(':memory:')`, propietarios/deptos ficticios, períodos, `cerrarPeriodo`,
`pagarLiquidacion`). Casos:
1. Depto con mayo cerrado y pagado completo → fila `pagado`, `pendiente = 0`, 1 pago.
2. Pago parcial → `parcial`; con `anulados = false` el pago anulado no aparece; con `true` aparece con
   `anulado: true` y `pagado` no cambia.
3. **Cambio de dueño**: cerrar mayo con el depto del Propietario Uno; `UPDATE depto SET propietario_id = 2`;
   cerrar junio. `historial({ propietarioId: 1 })` tiene mayo y no junio; `{ propietarioId: 2 }` tiene junio y no mayo.
4. Mes abierto con cotización → primera fila `en_curso`, `liquidacionId: null`.
5. Mayo sin pagar y junio cerrado → mayo `arrastrado` con `arrastradoA = '2026-06'`.
6. Sin filtro → `historial(db, {}, false)` tira "Elegí un depto o un propietario." (la validación va
   dentro de `historial`; la ruta la convierte en 400 con el `intentar` de `server/app.ts:246`).

**Verify**: `node --test server/liquidacion/historial.test.ts` → 6 pasan; `npm test` → todo pasa.

### 6. Interfaz
- `src/Transferencias.tsx`: `export` a `FormPago` (sin otros cambios).
- Crear `src/Historial.tsx`:
  - `export function Historial({ deptoId, propietarioId }: { deptoId?: number; propietarioId?: number })`.
    Sin props: arriba un `Select` con búsqueda para elegir **depto o propietario** (opciones de
    `get('deptos')` y `get('propietarios')`, agrupadas). Con props: no muestra el selector.
  - Filtro por depto (`Select`) cuando el historial es de un propietario con más de un depto.
  - Interruptor "Ver anulados" → recarga con `&anulados=1`.
  - Totales arriba: **Pagado** y **Pendiente** por moneda (pendiente = suma de `pendiente` de filas
    `parcial`/`pendiente`; las `debe` se muestran aparte como "Debe"; `en_curso` y `arrastrado` no suman).
  - Tabla (`size="small"`, `sticky`, `pagination={false}`): Mes, Depto, Propietario (solo si el
    historial es por depto — muestra quién era el dueño ese mes), Saldo, Pagado, Pendiente, Estado
    (`Tag`: pagado green, parcial gold, pendiente blue, debe red, arrastrado default "pasó a AAAA-MM",
    en_curso purple "en curso"), y botón "Marcar pagado" si `estado` es `pendiente` o `parcial`.
  - Fila desplegable con los pagos: fecha, importe, cuenta, botón "Anular" con `Popconfirm`
    (como `src/Transferencias.tsx:114-125`); los anulados con `<Typography.Text delete>` y sin botón.
  - "Marcar pagado" abre `FormPago` (importado de `./Transferencias.tsx`) con `t` armado desde la fila
    (`liquidacionId`, `codigo`, `propietario`, `moneda`, `pendiente`; `cbu`/`esHornera` no están en
    `FilaHistorial`: agregarlos en el paso 4 si `FormPago` los necesita para su texto) y la
    `fecha_pago` del período (de `get('periodos')`).
- `src/App.tsx`: nueva sección `historial: { grupo: 'Mes', titulo: 'Historial', ayuda: 'Pagos a cada
  propietario mes a mes: lo liquidado, lo pagado y lo pendiente.', vista: <Historial /> }`, después de
  `transferencias`.
- `src/Deptos.tsx` y `src/Propietarios.tsx`: columna final con botón "Historial" que abre un
  `Drawer` (`width={900}`, título "Historial de <código o nombre>") con
  `<Historial deptoId={…} />` / `<Historial propietarioId={…} />`.

**Verify**: `npm run typecheck` → exit 0. Abrir la app con datos de prueba
(`npx electron . --user-data-dir=<carpeta temporal>`), importar un mes y comprobar: la sección
Historial aparece en el grupo MES; desde Deptos el botón abre el panel; los totales cambian al anular.

### 7. Cierre
- `package.json` → `0.14.0`; `ROADMAP.md`, línea "Todo lo construido…": agregar "historial de pagos".
- `plans/README.md`: fila 028 → `A TESTEAR`.

## Test plan
- `server/liquidacion/historial.test.ts`: los 6 casos del paso 5.
- `server/liquidacion/cierre.test.ts`: aserción de `propietario_id` del paso 2.
- Migración: los tests existentes de migración deben seguir pasando (base vieja migrada = base nueva).

## Done criteria
- [ ] `npm run typecheck` → exit 0
- [ ] `npm test` → todo pasa, incluidos 6 tests nuevos en `historial.test.ts`, y `schema OK`
- [ ] `grep -n "propietario_id" schema.sql server/db.ts server/liquidacion/cierre.ts server/importador/excel.ts` → aparece en los cuatro
- [ ] `grep -n "COALESCE(l.propietario_id" server/liquidacion/pagos.ts` → 1 coincidencia
- [ ] `git status` → solo archivos de la lista "In"
- [ ] `plans/README.md` actualizado

## STOP
- Un test de migración de `server/app.test.ts` sigue fallando después de los ajustes del paso 1.
- `listarTransferencias` se usa en otro lado y agregar campos rompe un tipo fuera del scope.
- `FormPago` necesita cambios de comportamiento (no solo `export`) para usarse desde el historial.
- Los tests del importador con el Excel real (si el archivo está) fallan después del paso 2.

## Mantenimiento
- Si algún día se edita el dueño de un depto desde la app, el historial ya lo respeta (usa el del cierre).
- Reabrir un mes borra sus liquidaciones; al volver a cerrar se guarda el dueño **de ese momento**.
- Exportar el historial (Excel/PDF para el propietario) quedó afuera a propósito; si se pide, reusar
  `historial()` como fuente.
- Adelantos (`pre_liquidacion`) y cobros directos (`pago_directo`) **no** figuran como pagos: ya
  restan dentro del saldo de la liquidación del mes.
