# 050 — Foto diaria del calendario de Stays (precio y disponibilidad por noche y depto)

Escrito contra `2ad3f12` + las métricas ADR/RevPAR sin commitear (2026-10-23). P3 · M · riesgo BAJO. Depende de: ninguno.

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 050 de `plans/README.md`.
>
> **Chequeo de cambios (primero):** `git log --oneline -5 -- server/stays/cliente.ts server/db.ts electron/main.ts`.
> Si `server/stays/cliente.ts` ya tiene un método `calendario`, o si `schema.sql`
> ya tiene `calendario_precio`, parar y avisar: alguien empezó esto.

## Por qué

Amancay quiere medir la **elasticidad** (cuánto caen las reservas cuando sube el precio). Para eso hace
falta saber **a qué precio estaba publicada cada noche mientras seguía libre**, y cuándo se vendió. Hoy la
app solo guarda lo cobrado por las noches vendidas. Stays tiene ese dato en su calendario, pero **solo de
hoy en adelante**: las fechas pasadas vuelven vacías y una noche vendida muestra el precio vigente hoy, no el
de cuando se reservó (probado el 2026-10-23 contra la cuenta real). La única forma de tener la historia es
**guardar una foto del calendario todos los días**, empezando ya.

Este plan **solo junta los datos**. El análisis de elasticidad y cualquier pantalla con números quedan para
después, cuando haya meses de fotos.

## Lo que devuelve Stays (medido el 2026-10-23)

`GET https://hrnr.stays.net/external/v1/calendar/listing/{_id}?from=AAAA-MM-DD&to=AAAA-MM-DD`
(misma Basic auth que el resto; `{_id}` es el `_id` del alojamiento, el de `content/listings`).

- Un año entero en un solo pedido: 365 días, ~95 KB, ~1 s. Fechas antes de hoy no vienen.
- Respuesta: un arreglo, un elemento por noche. Forma (valores ficticios):

```json
[
  {
    "date": "2026-11-02",
    "avail": 1,
    "closedToArrival": false,
    "closedToDeparture": false,
    "prices": [
      { "minStay": 1,  "_mcval": { "ARS": 56000, "BRL": 149, "USD": 30 } },
      { "minStay": 7,  "_mcval": { "ARS": 44800, "BRL": 119, "USD": 24 } },
      { "minStay": 28, "_mcval": { "ARS": 36400, "BRL": 97,  "USD": 19 } }
    ]
  }
]
```

- `avail`: 1 = libre; 0 = no disponible (**vendida o bloqueada**: el calendario no distingue; se cruza
  después con `reserva` y `bloqueo`).
- `prices[0]`: el precio de la noche; su `minStay` es la **estadía mínima** de ese día (varía: 1, 2, 3, 5).
  Los otros tramos (7 y 28 noches) son descuentos por estadía larga.
- `_mcval.ARS` viene en **pesos con decimales posibles**, no en centavos.

## Diseño (decidido; no reabrir)

- **Guardar solo cambios.** Una fila por (depto, noche) cada vez que algo de esa noche cambia respecto de la
  última fila guardada: disponibilidad, estadía mínima o precios. Una foto sin cambios no escribe filas de
  precio. Así 30 deptos × 365 noches por día no engordan la base ni los backups.
- **Registrar cada foto** en otra tabla (fecha, cuántos deptos, cuántos cambios, error). Sin eso no se
  distingue "el precio no cambió" de "ese día la app no estuvo prendida".
- **Horizonte:** de hoy a hoy + 364 días.
- **Qué deptos:** los que no están `finalizado` y cuyo `codigo` coincide con el `internalName` de un
  alojamiento de Stays (la misma regla que usa "traer mes"; `depto.stays_listing_id` casi siempre está vacío,
  no usarlo).
- **Cuándo:** solo en la PC **servidor**, desde `electron/main.ts`. Al iniciar (a los 2 minutos) y después
  cada hora se fija si ya hay foto de hoy (fecha local); si no hay y hay credenciales de Stays, la toma. La
  app no siempre está prendida: los días sin foto quedan como hueco, y está bien.
- **Errores:** nunca muestran diálogo ni frenan la app. Se guarda el mensaje en la tabla de fotos y se
  reintenta en la próxima hora (una foto con error no cuenta como "foto de hoy").
- **Plata en centavos** (regla del repo): `Math.round(_mcval.ARS * 100)`.

## Paso 1 — Esquema 20

Leer `server/db.ts` (arreglo `MIGRACIONES`, comentario de la línea 8) y la última migración para imitar el
estilo. Agregar **juntos**:

1. Al final de las tablas de `schema.sql` (antes de la sección `VISTAS`):

```sql
-- ------------------------------------------------------------
--  CALENDARIO DE STAYS (plan 050): foto diaria de precio y disponibilidad por noche.
-- ------------------------------------------------------------
-- Una fila por (depto, noche) cada vez que esa noche cambia respecto de la última fila: el valor
-- vale desde `visto` hasta la próxima fila de la misma noche. avail 0 = vendida o bloqueada.
CREATE TABLE calendario_precio (
    depto_id     INTEGER NOT NULL,
    noche        TEXT    NOT NULL CHECK (date(noche) IS noche),
    visto        TEXT    NOT NULL CHECK (date(visto) IS visto),   -- fecha de la foto
    disponible   INTEGER NOT NULL CHECK (disponible IN (0,1)),
    min_noches   INTEGER,                                          -- minStay del primer tramo
    precio       INTEGER,                                          -- centavos ARS del primer tramo
    tramos_json  TEXT    CHECK (tramos_json IS NULL OR json_valid(tramos_json)),  -- [[minStay, centavos], ...]
    CONSTRAINT pk_calendario_precio PRIMARY KEY (depto_id, noche, visto),
    CONSTRAINT fk_calprecio_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE CASCADE ON UPDATE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE calendario_foto (
    fecha    TEXT    PRIMARY KEY CHECK (date(fecha) IS fecha),
    deptos   INTEGER NOT NULL,
    cambios  INTEGER NOT NULL,
    error    TEXT                                                  -- NULL = salió bien
) STRICT;
```

2. La misma DDL como nueva entrada al final de `MIGRACIONES` en `server/db.ts`.
3. En `schema.check.mjs` (verifica las reglas de `schema.sql` con `run` y `falla`; leerlo entero), sumar al
   final, con el depto `OVL` (id 1) que el archivo ya crea:
   - una fila válida de `calendario_precio` y otra de `calendario_foto`;
   - `falla(...)` para `disponible = 2` (`CHECK`), para `noche = '2026-13-01'` (`CHECK`) y para repetir la
     misma (depto, noche, visto) (`UNIQUE` / `PRIMARY KEY`).

La igualdad entre una base migrada y una nueva la verifica `server/app.test.ts` ("una base del esquema 1
migrada queda igual que una base nueva"): si la DDL de la migración y la de `schema.sql` difieren, ese test falla.

Verificación: `npm test` → `fail 0` (incluye `node schema.check.mjs`).

## Paso 2 — Cliente de Stays

En `server/stays/cliente.ts`:

1. Exportar el tipo de un día, con el mismo estilo de comentarios que `DetalleStays`:

```ts
// Un día del calendario (GET /calendar/listing/{_id}): solo lo que se guarda.
export interface DiaCalendarioStays {
  date: string;            // "2026-11-02"
  avail: number;           // 1 libre, 0 vendida o bloqueada
  prices?: { minStay?: number; _mcval?: { ARS?: number } }[];
}
```

2. Sumar a `ClienteStays` el método `calendario(listingId: string, desde: string, hasta: string): Promise<DiaCalendarioStays[]>`
   e implementarlo en `crearClienteStays` con el `pedir` existente (que ya reintenta cortes):
   `` (await pedir(`calendar/listing/${encodeURIComponent(listingId)}?from=${desde}&to=${hasta}`)).json() ``.

Verificación: `npm run typecheck` sin errores.

## Paso 3 — `server/stays/calendario.ts`

Archivo nuevo, una función principal sin dependencias de Electron:

```ts
export async function fotoCalendario(db: DatabaseSync, cliente: ClienteStays, hoy: string): Promise<{ deptos: number; cambios: number }>
```

Qué hace, en orden:

1. Si ya hay una fila en `calendario_foto` con `fecha = hoy` y `error IS NULL`, devolver sin pedir nada.
2. `cliente.alojamientos()` y cruzar `internalName` con `depto.codigo` de los deptos con `estado <> 'finalizado'`.
3. **Bajar todo primero**, sin escribir nada: para cada depto, **en serie** (no en paralelo: Stays se cuelga
   con muchas conexiones, ver el comentario de `INTENTOS` en `cliente.ts`),
   `cliente.calendario(_id, hoy, hoy + 364 días)`, y guardar las respuestas en memoria.
4. **Recién después, escribir**, en una transacción **sin ningún `await` adentro**. Es obligatorio: la API usa
   la misma conexión a la base; si la transacción quedara abierta mientras se espera a Stays, lo que el usuario
   guarde en ese rato entraría en ella (y un `ROLLBACK` se lo llevaría), y otra ruta que haga `BEGIN` fallaría
   con "cannot start a transaction within a transaction". Copiar el patrón de `server/stays/sync.ts`
   (comentario "---- 2. Escribir": `db.exec('BEGIN')`, `try { …; db.exec('COMMIT') } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }`).
   Adentro, por cada día de cada depto: armar `{ disponible: avail ? 1 : 0, min_noches: prices[0]?.minStay ?? null,
   precio: centavos de prices[0]._mcval.ARS o null, tramos_json: JSON de [[minStay, centavos], ...] o null }`;
   comparar con la **última** fila de esa (depto, noche) (`ORDER BY visto DESC LIMIT 1`); si no hay o difiere
   en algún campo, insertar con `visto = hoy`. Contar las insertadas. Al final, dentro de la misma transacción,
   `INSERT OR REPLACE INTO calendario_foto(fecha, deptos, cambios, error) VALUES (hoy, n, cambios, NULL)`.
5. Si algo tira error (al bajar o al escribir): no queda ninguna fila de precio de esta foto; guardar la foto
   con `error = mensaje` (con `INSERT OR REPLACE`, fuera de toda transacción) y volver a tirar el error.

Para sumar días a una fecha ISO hay utilidades en `server/stays/sync.ts` (`sumarMeses`) y en el motor; si no
hay una de días, escribir una línea con `Date.UTC`, igual que `dias()` en `server/liquidacion/motor.ts`.

Verificación: `npm run typecheck`.

## Paso 4 — Tests: `server/stays/calendario.test.ts`

Patrón: `server/stays/sync.test.ts` (Stays simulado con `createServer` de `node:http`, datos ficticios,
`abrirDb(':memory:')`). Sumar al simulado la ruta `calendar/listing/{_id}`. Casos mínimos:

1. **Primera foto:** 2 deptos con 3 noches cada uno → 6 filas en `calendario_precio`, 1 en `calendario_foto`
   con `cambios = 6`; precio en centavos (`56000` pesos → `5600000`).
2. **Segunda foto el mismo día:** no hace ningún pedido al calendario (el simulado anota los pedidos) y no
   agrega filas.
3. **Foto del día siguiente con un solo cambio** (una noche pasa de `avail 1` a `0`): agrega 1 fila con
   `visto` = el día nuevo; las demás noches no se repiten.
4. **Un depto finalizado o sin alojamiento en Stays** no se pide.
5. **Error de Stays** (500 en el calendario del **segundo** depto, para que el primero ya se haya bajado):
   no queda ninguna fila de precio de esa foto,
   `calendario_foto.error` tiene el mensaje, la función tira el error, y una llamada posterior el mismo día
   (con Stays ya respondiendo bien) sí toma la foto.

Usar solo códigos y montos ficticios.

Verificación: `node --test server/stays/calendario.test.ts` → todos pasan; `npm test` → `fail 0`.

## Paso 5 — Disparo diario en `electron/main.ts`

Leer `iniciarServidor()` y el backup periódico (`BACKUP_CADA_MS`, `setInterval`, `clearInterval` en `cerrar`).
Imitarlo:

```ts
const CALENDARIO_CADA_MS = 60 * 60 * 1000; // se fija cada hora si ya hay foto de hoy
```

- Una función `fotoDelDia()` que lee las credenciales con el mismo almacén que se le pasa a `crearApp`
  (`almacenCredenciales()`); si no hay, no hace nada. Si hay, llama
  `fotoCalendario(db, crearClienteStays(creds), hoyLocal())` (`hoyLocal` está en `server/cotizacion.ts`).
  Errores: `console.error`, **sin** `dialog`.
- Que no se pisen dos fotos: una variable `enCurso` que la saltea si la anterior no terminó.
- `setTimeout(fotoDelDia, 2 * 60 * 1000)` al iniciar y `setInterval(fotoDelDia, CALENDARIO_CADA_MS)`;
  limpiar ambos en `cerrar`.
- **Solo en `iniciarServidor`**, nunca en la terminal.

Verificación: `npm run typecheck`. Prueba manual en la sección siguiente.

## Paso 6 — Documentación

- `DECISIONES.md`, en la sección de Stays: 2-3 viñetas con el qué y el porqué (foto diaria para medir
  elasticidad más adelante; solo cambios; solo hacia adelante porque Stays no da el pasado; `avail 0` no
  distingue vendida de bloqueada).
- `CLAUDE.md`, en Estructura, junto a `server/stays/`: mencionar `server/stays/calendario.ts`.
- **No** tocar el manual de usuario: no hay pantalla nueva.

## Hecho cuando

- `npm run typecheck` sin errores y `npm test` → `fail 0`.
- `node schema.check.mjs` pasa.
- `grep -n "calendario_precio" schema.sql server/db.ts` → aparece en los dos.
- Prueba manual con la base de demo (`node manual/seed.ts <carpeta>` y `npx electron . --user-data-dir=<carpeta>`):
  sin credenciales de Stays, la app arranca y a los 2 minutos no pasa nada ni aparece ningún diálogo.
- (Si quien prueba tiene acceso a la PC real) en la base real, después de 2 minutos con la app abierta:
  `SELECT * FROM calendario_foto` tiene la fila de hoy con `error` NULL, y `calendario_precio` tiene filas.
  **No** commitear ni copiar nada de esa base.

## Fuera de alcance (no tocar)

- Cualquier pantalla, gráfico o cálculo de elasticidad. Las métricas de `server/resumen.ts`.
- `server/stays/sync.ts` ("traer mes"): no mezclar la foto con la sincronización de reservas.
- Precios en USD/BRL, reglas de precio de Stays (`price/…`), restricciones `closedToArrival/Departure`.
- Borrar fotos viejas. Si algún día pesan, se decide aparte.

## Parar y avisar

- Si `calendar/listing/{_id}` responde algo distinto de lo descrito (otra forma, 403, 404): pegar el status y
  las **claves** de la respuesta (no los valores) y parar.
- Si la migración de esquema falla en `schema.check.mjs` y no es obvio por qué.
- Si para disparar la foto hace falta tocar cómo se guardan las credenciales (`stays.cred`, `safeStorage`).

## Mantenimiento

- `avail 0` mezcla vendida y bloqueada: el análisis futuro tiene que cruzar con `reserva` (llegada/salida) y
  `bloqueo` del mismo depto.
- Si Stays cambia el precio de golpe en muchos deptos (una regla de temporada), una foto puede escribir miles
  de filas: es esperable, no es un error.
- Los backups crecen con esta tabla. Con solo cambios debería ser poco; si una revisión ve que crece mucho,
  revisar primero si la comparación del paso 3.4 está fallando (por ejemplo, `tramos_json` con distinto orden
  de claves o decimales, que hace que todo "cambie" todos los días).
