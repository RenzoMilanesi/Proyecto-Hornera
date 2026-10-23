# 057 — Limpieza: importar las horas del Form y liquidar a la coordinadora con división por chica

Escrito contra `ad5d3f7` (2026-10-23). P1 · L. Depende de: —.

## Por qué
El objetivo es **centralizar los gastos de la empresa HORNERA** en la app. La limpieza se lleva hoy en un Google
Sheet aparte ("HORAS LIMPIEZA"): las chicas cargan cada tarea desde el celular con un Google Form (hoja
"Horas Cargadas") y cada tanto se liquida un período a mano (hoja "Liquidaciones": horas × precio por hora). Se le
paga **todo a la coordinadora**, que después reparte; el gasto llega a la app a mano o no llega.

Decisiones del usuario (2026-10-23):
1. Las horas **siguen entrando por el Form**; la app importa el Excel cada vez que se baja.
2. Las liquidaciones **se llevan desde la app** de ahora en más, con **horas y plata por chica**, aunque en la
   realidad se pague todo junto a la coordinadora.
3. Es **control interno de la empresa**: no va al propietario ni toca la liquidación del depto ni el motor.
4. **Solo desde 2026-09-10** (el período anterior ya está cargado a mano como movimiento). Sin historial.
5. Los períodos son de **fechas libres** (no quincenas fijas), cargados a mano.
6. Los plus por tipo de tarea siguen, **ajustables por el usuario, en horas o en pesos**.
7. Las filas repetidas exactas del Form son **duplicados** (no se pagan dos veces).
8. Las horas totales (por chica, depto, mes) son **información**: no generan plata por sí solas.

## Cómo es el Excel (verificado sobre el archivo real, no commitear)
Hoja `Horas Cargadas`, una fila por tarea. Columnas por encabezado:
`Fecha` (fecha), `Depto` (código), `Operaria` (apodo en mayúsculas), `Horas` (duración como **hora del día**:
fracción de día; usar solo la parte fraccionaria × 24 × 60 → minutos), `Extras` (tipo de tarea). El resto son
fórmulas o columnas vacías: ignorarlas.
- Tipos que aparecen: `Limpieza`, `Check-Out`, `Check-In`, `Cambio Blanqueria`, `Oficina`, y **vacío** (desde
  mayo-2026 el Form deja vacío lo que es limpieza) → tratar vacío como `Limpieza`.
- Plus que usa la planilla hoy: Check-In +1 h, Cambio Blanqueria +1 h, Check-Out +0,5 h, el resto 0.
- `Depto`: códigos de la app salvo `COTI` (= `COT`) y `MAIPU` (= `MAPU`); `INT` = empresa (depto NULL). Pueden
  venir con espacios (`CAF `): `trim()` + mayúsculas.
- Hay fechas cargadas como texto mal escritas (`29/9/25`): aviso y no se importa.
- La coordinadora carga sus horas internas como `INT` al cierre de cada período; a veces dos filas idénticas.
- No hay un ID estable por fila (la marca temporal casi siempre falta).

## Reglas del repo (de CLAUDE.md)
- TypeScript sin build: nada de enums, namespaces ni parámetros de propiedad; imports con extensión `.ts`.
- Plata en centavos (INTEGER), fechas ISO. Duraciones en **minutos** (INTEGER): nada de horas en REAL.
- Cambio de esquema: `schema.sql` + migración en `server/db.ts` (`MIGRACIONES`) + `schema.check.mjs`, juntos.
- Modales: skill `modales`. Datos ficticios en tests (apodos y montos inventados). `ponytail:` marca simplificaciones.

## Pasos

### 1. Esquema (migración siguiente a la última de `MIGRACIONES`)
```sql
-- Tareas de limpieza importadas del Google Form "Horas Cargadas" (plan 057). Control interno: no tocan liquidaciones de deptos.
CREATE TABLE tarea_limpieza (
    id           INTEGER PRIMARY KEY,
    fecha        TEXT    NOT NULL CHECK (date(fecha) IS fecha),
    depto_id     INTEGER REFERENCES depto(id),          -- NULL = empresa (INT)
    operaria     TEXT    NOT NULL CHECK (operaria <> ''),
    tipo         TEXT    NOT NULL,                      -- Limpieza, Check-In, Check-Out, Cambio Blanqueria, Oficina...
    minutos      INTEGER NOT NULL CHECK (minutos >= 0), -- duración cargada, sin el plus
    fila_excel   INTEGER                                -- para los avisos
) STRICT;
CREATE INDEX ix_tarea_limpieza_fecha ON tarea_limpieza(fecha);

-- Período liquidado a la coordinadora: fechas libres, sin pisarse. Las reglas se copian al crearlo.
CREATE TABLE liquidacion_limpieza (
    id             INTEGER PRIMARY KEY,
    desde          TEXT    NOT NULL CHECK (date(desde) IS desde),
    hasta          TEXT    NOT NULL CHECK (date(hasta) IS hasta AND hasta >= desde),
    precio_hora    INTEGER NOT NULL CHECK (precio_hora > 0),     -- centavos
    plus_json      TEXT    NOT NULL CHECK (json_valid(plus_json)), -- {"Check-In":{"modo":"horas","valor":60},...}
    ajuste         INTEGER NOT NULL DEFAULT 0,                   -- centavos, con signo (corrección a mano)
    ajuste_nota    TEXT,
    movimiento_id  INTEGER REFERENCES movimiento(id) ON DELETE SET NULL, -- el pago; NULL = pendiente
    creado_en      TEXT    NOT NULL
) STRICT;

-- Foto por chica al pagar: lo pagado no cambia aunque después se reimporte el Excel.
CREATE TABLE liquidacion_limpieza_operaria (
    liquidacion_limpieza_id INTEGER NOT NULL REFERENCES liquidacion_limpieza(id) ON DELETE CASCADE,
    operaria   TEXT    NOT NULL,
    tareas     INTEGER NOT NULL,
    minutos    INTEGER NOT NULL,   -- duración + plus en horas
    importe    INTEGER NOT NULL,   -- centavos: minutos × precio / 60 + plus en pesos, redondeado
    PRIMARY KEY (liquidacion_limpieza_id, operaria)
) STRICT, WITHOUT ROWID;
```
- Que dos liquidaciones no se pisen: trigger `BEFORE INSERT/UPDATE` que aborte si existe otra con
  `desde <= NEW.hasta AND hasta >= NEW.desde` (mensaje: `el período se pisa con otro`).
- Al anular el movimiento del pago, liberar el vínculo y borrar la foto: copiar el patrón de
  `tr_mov_anulado_libera_liq` de `schema.sql`.
- `plus_json`: `modo` es `"horas"` (valor en **minutos**) o `"pesos"` (valor en **centavos** por tarea).
- `schema.check.mjs`: probar el solapamiento (falla), `hasta < desde` (falla), `plus_json` inválido (falla) y que
  anular el movimiento deja `movimiento_id` NULL.

### 2. Configuración
En `configuracion` (clave/valor), con los valores por defecto si no están:
- `limpieza_desde` = `2026-09-10` (no se importa nada anterior).
- `limpieza_plus` = `{"Check-In":{"modo":"horas","valor":60},"Cambio Blanqueria":{"modo":"horas","valor":60},"Check-Out":{"modo":"horas","valor":30}}`
  (tipo que no figura = sin plus).
- `limpieza_precio_hora`: el último usado, para proponerlo en la próxima liquidación.
- `limpieza_alias` = `{"COTI":"COT","MAIPU":"MAPU"}`.
Una nueva liquidación copia `limpieza_plus` a su `plus_json`; cambiar la preferencia no toca las ya creadas. Una
liquidación **pendiente** puede editar su precio, plus y ajuste; una **pagada**, no.

### 3. Módulo `server/limpieza.ts` (nuevo)
Estilo de `server/movimientos.ts` / `server/gastosAjenos.ts` (`enTransaccion`, `auditar`, errores con mensaje para
el usuario).
- `calcular(tareas, precioHora, plus)` — **función pura**: agrupa por operaria → `{ operaria, tareas, minutos,
  importe }[]` y total. `minutos` = duración + plus en horas; `importe = Math.round(minutos * precioHora / 60) +
  Σ plus en pesos`. Total = **suma de las chicas** + ajuste (así lo que reparte la coordinadora cierra exacto).
- `crearLiquidacion(db, { desde, hasta, precio_hora })`, `editarLiquidacion(db, id, {...})` (solo pendiente).
- `verLiquidacion(db, id)`: si está pagada, la foto de `liquidacion_limpieza_operaria`; si no, `calcular` sobre las
  tareas con `fecha BETWEEN desde AND hasta`. Incluye detalle por depto (informativo).
- `pagarLiquidacion(db, id, { fecha, cuenta_id })`: en una transacción guarda la foto por chica y crea con
  `crearMovimiento` un gasto de la **empresa** (`depto: null`, `tipo: 'gasto'`, concepto `Limpieza`, detalle
  `Limpieza DD/MM–DD/MM`, importe negativo, mes = `fecha.slice(0, 7)`, que tiene que estar abierto).
- `listarLiquidaciones(db)` y `horas(db, { desde, hasta })` → totales por operaria, por depto y por mes.

### 4. Importación (`server/importador/limpieza.ts`, nuevo)
`importarHoras(db, archivo: Buffer)` con `xlsx` como `server/importador/gastos.ts`:
- Leer la hoja `Horas Cargadas` por encabezado; si no está, error claro.
- Saltear filas con fecha `< limpieza_desde`. Fecha inválida, depto desconocido u operaria vacía → aviso con el
  número de fila (`__rowNum__`, como en gastos.ts) y no se importa.
- Duplicado exacto (fecha + depto + operaria + tipo + minutos) → se importa una sola vez, aviso.
  `ponytail:` una tarea real repetida el mismo día con la misma duración se pierde; si pasa, la chica la carga
  con otra duración o se agrega un ajuste.
- **Reemplazo**: en una transacción borra las tareas desde `limpieza_desde` que **no caen en una liquidación
  pagada** e inserta las del archivo que tampoco caen en una. Para las que caen en una pagada, comparar con la
  foto y avisar si difieren (`El período 10/09–22/09 ya está pagado y el Excel cambió: N tareas, M h de diferencia`).
- Reporte: `{ importadas, duplicadas, anteriores, avisos }`. Auditar `importacion`.

### 5. Rutas (`server/app.ts`)
`POST /api/importar/limpieza` (mismo patrón que `/api/importar/gastos`), `GET/POST /api/limpieza/liquidaciones`,
`PUT /api/limpieza/liquidaciones/:id`, `POST /api/limpieza/liquidaciones/:id/pagar`, `GET /api/limpieza/horas`,
`GET/PUT /api/limpieza/config` (plus y alias).

### 6. Pantalla `src/Limpieza.tsx` (nueva, grupo "Mes" en `src/App.tsx`)
- **Liquidaciones**: lista (período, horas, total, pagada/pendiente). Botón "Nueva" (modal: desde, hasta, precio
  por hora propuesto). Al abrir una: tabla **por chica** (tareas, horas, importe) con total, el detalle por depto
  plegado, ajuste con nota y "Marcar pagada" (fecha + cuenta). Propone `desde` = día siguiente al último `hasta`.
- **Horas**: rango de fechas → totales por chica, por depto y por mes. Solo información.
- **Reglas**: plus por tipo (horas o pesos) y precio por hora sugerido.
- En `src/Importar.tsx`, tercera opción "Horas de limpieza (Form)".
- Modales con la skill `modales`; plata con `entradaPlata`.

### 7. Carga inicial (a mano, con la app andando; no es código)
Los períodos **10/09–22/09** y **23/09–07/10** ya se pagaron en la realidad, con horas `INT` duplicadas incluidas
(decisión del usuario 2026-10-23: **se cargan con lo que se pagó de verdad**). Para cada uno: importar el Excel,
crear la liquidación con el precio por hora de la hoja "Liquidaciones", poner como **ajuste** la diferencia entre
lo pagado (columna `monto_liquidacion` de esa hoja) y lo que calcula la app, con nota `Horas INT duplicadas
pagadas`, y marcarla pagada con la fecha de pago real. El ajuste cuenta en el total pero no en la división por
chica. Verificar que el gasto en Movimientos coincida con lo pagado.

### 8. Documentación
`DECISIONES.md`: sección "Limpieza" con las decisiones de arriba. `ROADMAP.md` si corresponde.

## Tests (`server/limpieza.test.ts`, `server/importador/limpieza.test.ts`; datos ficticios)
- `calcular`: dos chicas, Check-Out con plus en horas y Check-In con plus en pesos → minutos e importes exactos;
  total = suma de las chicas + ajuste; redondeo a centavos por chica.
- Liquidaciones que se pisan → error. Pagar crea el movimiento de la empresa con concepto Limpieza y la foto;
  reimportar después con cambios no cambia la foto y deja un aviso.
- Importar: tipo vacío = Limpieza; alias `COTI`→`COT`; `INT` → depto NULL; fila anterior al corte ignorada;
  duplicado exacto importado una vez; fecha en texto → aviso. Armar el xlsx en el test con `XLSX.utils.aoa_to_sheet`.

## Fuera de alcance
- Costo real de limpieza por depto contra lo cobrado al propietario (la hoja "Hs calculo bibi"): el usuario va a
  averiguar qué es. Con estos datos sale fácil después.
- Pagarle a cada chica por separado: el pago es uno solo a la coordinadora.
- Lavandería: plan 058.

## Done
`npm test` y `npm run typecheck` pasan; se importa un Excel de prueba, se crea y paga una liquidación y aparece el
gasto en Movimientos (empresa, concepto Limpieza) y en el Resultado de Hornera.

## STOP si
- Los encabezados del Excel no son los de arriba, o la columna `Horas` no es una hora del día.
- El usuario quiere que el plus en pesos se pague aparte de las horas (hoy se suma al importe de la chica).
