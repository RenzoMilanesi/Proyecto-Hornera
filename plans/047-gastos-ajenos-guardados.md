# 047 — Guardar los gastos ajenos (CAY, LAU, CAY/LAU, CASEST, CASA) y verlos en su pantalla

Escrito contra `da19b98` más los cambios sin commitear de los planes 037 (códigos ajenos) y 045. P2 · M.
Depende de: 045 (hecho).

## Por qué
El Excel de gastos varios trae gastos que **no son de Hornera**: personales de Amancay (`CAY`), de Lautaro
(`LAU`), compartidos entre los dos (`CAY/LAU`), de la Casa del Estudiante (`CASEST`, a veces escrito
`CASAEST`) y de la casa donde viven (`CASA`). Hoy `importarGastos` (`server/importador/gastos.ts`) los
suma en `reporte.cuenta` y los descarta: la cuenta se pierde al salir de la pantalla Importar. Lautaro y
Amancay quieren tenerlos guardados, con el detalle, y saber cuánto lleva cada uno.

Decisiones del usuario (2026-10-21):
1. **Se pueden editar** en la app (y anular, como todo en Hornera: no se borra).
2. **Los compartidos se parten**: la mitad de cada `CAY/LAU` va a Amancay y la otra mitad a Lautaro.
3. **CASA entra** igual que los demás.
4. **Meses cerrados se saltean** al importar, igual que hoy con los movimientos.

Invariante que no se negocia: estos gastos **nunca** tocan liquidaciones, saldos de cuentas ni el Resultado
de Hornera. Por eso van en una tabla propia y no en `movimiento`.

## Reglas del repo (de CLAUDE.md)
- TypeScript sin build: nada de enums, namespaces ni parámetros de propiedad; imports con extensión `.ts`.
- Plata en centavos (INTEGER), fechas ISO `YYYY-MM-DD`.
- Cambio de esquema: `schema.sql` + migración en `server/db.ts` (`MIGRACIONES`) + `schema.check.mjs`, **juntos**.
- Modales: skill `modales` (ficha, secciones, plata con `entradaPlata`). Leerla antes de escribir el modal.
- Datos ficticios en tests. Responder/comentar en español. Estilo mínimo; `ponytail:` marca simplificaciones.

## Pasos

### 1. Esquema
En `schema.sql`, junto a `movimiento`:
```sql
-- Gastos del Excel de gastos varios que no son de Hornera (plan 046): no entran en liquidaciones ni en el resultado.
CREATE TABLE gasto_ajeno (
    id          INTEGER PRIMARY KEY,
    periodo_id  INTEGER NOT NULL,
    fecha       TEXT    NOT NULL CHECK (date(fecha) IS fecha),
    codigo      TEXT    NOT NULL CHECK (codigo IN ('CAY','LAU','CAY/LAU','CASEST','CASA')),
    descripcion TEXT,
    importe     INTEGER NOT NULL CHECK (importe > 0),   -- centavos, positivo: es lo que se gastó
    estado      TEXT    NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulado')),
    origen      TEXT    UNIQUE,                         -- fila del Excel (misma clave que movimiento.origen); NULL = cargado a mano
    creado_en   TEXT    NOT NULL,
    CONSTRAINT fk_ajeno_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE TRIGGER tr_ajeno_periodo_cerrado_upd BEFORE UPDATE ON gasto_ajeno
WHEN (SELECT estado FROM periodo WHERE id = OLD.periodo_id) = 'cerrado'
  OR (SELECT estado FROM periodo WHERE id = NEW.periodo_id) = 'cerrado'
BEGIN
    SELECT RAISE(ABORT, 'periodo cerrado: reabrirlo para modificar gastos ajenos');
END;
```
Copiar el estilo de los triggers `tr_mov_periodo_cerrado_*` de `schema.sql`. Verificar que la tabla
`movimiento` sea `STRICT`; si no lo es, sacar `STRICT` acá también para ser consistentes.

En `server/db.ts`, al final de `MIGRACIONES`, agregar `// 17 → 18: gastos ajenos guardados (plan 046).` con el
mismo SQL. En `schema.check.mjs`, agregar un bloque `// Gastos ajenos` que pruebe: código inválido falla
(`CHECK`), importe 0 falla, `origen` repetido falla (`UNIQUE`), y un `UPDATE` con el período cerrado falla
(`periodo cerrado`).

Verificar: `node schema.check.mjs` sin salida de error.

### 2. Módulo `server/gastosAjenos.ts` (nuevo)
Seguir el estilo de `server/movimientos.ts` (`enTransaccion`, `auditar(db, 'gasto_ajeno', id, accion, antes, despues)`
de `server/auditoria.ts`, validación con `throw new Error('mensaje para el usuario')`). Exporta:
- `CODIGOS_AJENOS = ['CAY', 'LAU', 'CAY/LAU', 'CASEST', 'CASA']`.
- `crearGastoAjeno(db, { mes, fecha, codigo, descripcion, importe, origen })` → id. Valida código, importe > 0,
  y que el mes exista y esté abierto (reusar `periodoAbierto` si se exporta desde `movimientos.ts`; si no,
  exportarlo). Audita `alta`.
- `editarGastoAjeno(db, id, { fecha, codigo, descripcion, importe })` → vigente y mes abierto; el mes es el de
  la fecha (`fecha.slice(0, 7)`) y tiene que estar abierto. Audita `modificacion` con antes/después.
- `anularGastoAjeno(db, id)` → `estado = 'anulado'`, audita `anulacion`.
- `listarGastosAjenos(db, mes)` → `{ gastos: [...todas las filas del mes, vigentes y anuladas], totales }`,
  con `totales` calculado **solo con vigentes**:
  ```ts
  { porCodigo: Record<codigo, number>, amancay: number, lautaro: number }
  // amancay = CAY + mitad de CAY/LAU; lautaro = LAU + mitad de CAY/LAU
  ```
  Partir los compartidos sobre la **suma** del mes, no fila por fila: `mitad = Math.floor(compartido / 2)`;
  Amancay lleva `compartido - mitad` (el centavo impar) y Lautaro `mitad`. Comentario `ponytail:` con eso.

### 3. Importación (`server/importador/gastos.ts`)
Donde hoy está `if (AJENOS.has(codigo)) { anularViejo(origen, fila); return; }`:
- Seguir anulando el viejo (plan 045) y además, si no hay un `gasto_ajeno` con ese `origen`, crearlo con
  `crearGastoAjeno` (mes, fecha, codigo, descripcion, `monto`, origen). Si ya existe (vigente o anulado), no se
  toca: igual que con los movimientos, lo editado o anulado a mano manda. Sumar a un contador nuevo
  `r.ajenos` (los creados) en `ReporteGastos`; los existentes suman a `r.repetidos`.
- Usar `CODIGOS_AJENOS` del módulo nuevo en vez del `AJENOS` local (borrar el local).
- `r.cuenta` queda como está (es la cuenta de lo que trae el Excel).
- Los meses cerrados ya se saltean antes (`mes < primero` → `anteriores`); no cambiar eso.

### 4. Rutas (`server/app.ts`, junto a las de movimientos, ~línea 360)
```ts
app.get('/api/gastos-ajenos', (req, res) => { res.json(listarGastosAjenos(db, String(req.query.mes ?? ''))); });
app.post('/api/gastos-ajenos', (req, res) => intentar(res, () => ({ id: crearGastoAjeno(db, { ...req.body, origen: null }) })));
app.put('/api/gastos-ajenos/:id', (req, res) => intentar(res, () => editarGastoAjeno(db, Number(req.params.id), req.body ?? {})));
app.post('/api/gastos-ajenos/:id/anular', (req, res) => intentar(res, () => { anularGastoAjeno(db, Number(req.params.id)); return { ok: true }; }));
```
El `origen` lo pone solo el importador (igual que en `/api/movimientos`).

### 5. Pantalla `src/GastosAjenos.tsx` (nueva)
Copiar la estructura de `src/Movimientos.tsx` (selector de mes, filtro, switch "Ver anulados", tabla con
`Table.Summary`, botón anular con `Popconfirm`, período cerrado = solo lectura con el mismo `Alert`):
- Arriba, tarjetas `Statistic` con: **Amancay** (`totales.amancay`), **Lautaro** (`totales.lautaro`),
  **Casa del Estudiante** (`porCodigo.CASEST`), **Casa** (`porCodigo.CASA`). Debajo de Amancay y Lautaro, en
  texto secundario: `propios $X + mitad de compartidos $Y`.
- Filtro por código (Select con los 5 códigos y sus nombres: CAY · Amancay, LAU · Lautaro,
  CAY/LAU · Compartidos, CASEST · Casa del Estudiante, CASA · Casa).
- Tabla: fecha, código (con el nombre), descripción, importe (`pesos`), acciones (editar / anular).
- Botón **"Nuevo gasto"** y modal de alta/edición con fecha, código, descripción e importe
  (`entradaPlata`), **siguiendo la skill `modales`**.

En `src/App.tsx`, agregar la sección al grupo `'Mes'` después de `movimientos`:
```ts
gastosAjenos: { grupo: 'Mes', titulo: 'Gastos personales', ayuda: 'Gastos de Amancay, Lautaro, la Casa del Estudiante y la casa. No son de Hornera: no entran en liquidaciones ni en el resultado.', vista: <GastosAjenos /> },
```
En `src/Importar.tsx`: sumar `ajenos: number` a la interfaz y un renglón "Gastos personales guardados" en
el `Descriptions`; actualizar el párrafo (dice "no se importan, solo se suman en la cuenta" → "se guardan en
Gastos personales").

### 6. Documentación
- `plans/037-importar-gastos-varios.md`: la regla de ajenos dice ahora que se guardan en `gasto_ajeno`.
- `DECISIONES.md`: una línea en la sección de movimientos: los gastos ajenos van en `gasto_ajeno`, aparte, y
  los compartidos se parten mitad y mitad.
- `manual/manual.html`: una sección corta para la pantalla nueva. **No** regenerar capturas ni PDF (se hace al
  final de la tanda).

## Tests
- `server/gastosAjenos.test.ts` (nuevo, patrón de `server/importador/gastos.test.ts` con su `base()`):
  - totales: CAY 1000, LAU 500, CAY/LAU 301 (centavos) → amancay 1151, lautaro 650; un anulado no suma.
  - editar en mes abierto cambia y audita; en mes cerrado tira error; código inválido tira error.
- `server/importador/gastos.test.ts`: en el primer test, tras importar, `SELECT codigo, importe FROM gasto_ajeno`
  da CAY 150000, CASEST 70000, CAY/LAU 40000 y CASA 300000; reimportar no duplica (`r.ajenos === 0`); un
  `gasto_ajeno` editado a mano no se pisa al reimportar. Ajustar el `deepEqual` del reporte con `ajenos`.

## Fuera de alcance
- Cargar gastos de meses cerrados o pasados.
- Que estos gastos afecten cualquier cálculo de `server/liquidacion/`, `server/resumen.ts` o cuentas.
- Partir CASEST o CASA entre personas.

## Done
- `npm test` pasa (incluye `node schema.check.mjs`).
- `npm run typecheck` sin errores.
- `grep -rn "gasto_ajeno" server/liquidacion server/resumen.ts` no devuelve nada.

## STOP si
- `periodoAbierto` no existe o tiene otra firma en `server/movimientos.ts`: reportar antes de inventar otra.
- La auditoría (`server/auditoria.ts`) necesita registrar la tabla `gasto_ajeno` en algún listado para
  mostrarla en Herramientas → Auditoría: agregarla si es una línea; si es más, reportar.
