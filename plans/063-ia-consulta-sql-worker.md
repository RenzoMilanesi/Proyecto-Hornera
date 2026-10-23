# Plan 063: Una consulta SQL del asistente no puede congelar el servidor

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug / perf
- **Planned at**: commit `fba59f6`, 2026-10-23

## Why this matters

`consulta_sql` (plan 061) corre el SQL que escribe la IA con `node:sqlite`, que es **sincrónico** y no tiene forma
de interrumpir una consulta (verificado en Electron 44: `DatabaseSync.prototype` no tiene `interrupt` ni manejador de
progreso). El tope de 5 s se mira **entre filas**: una consulta que tarda en dar la primera fila (un `WITH RECURSIVE`
sin condición de corte con `count(*)`, un cruce de tres tablas grandes) bloquea el event loop del servidor Express.
Mientras tanto ninguna PC de la oficina (servidor ni terminales) puede usar la app, hasta reiniciarla.

## Current state

`server/ia/herramientas.ts`:

```ts
export function consultaSql(db: DatabaseSync, sql: string) {
  const ruta = db.location();
  if (!ruta) throw new Error('consulta_sql necesita una base en archivo');
  const lectora = new DatabaseSync(ruta, { readOnly: true });
  try {
    lectora.setAuthorizer(...);   // solo SELECT/READ/FUNCTION/RECURSIVE, sin terminal ni configuracion
    // ponytail: el tiempo se mira entre filas; ... no se corta (node:sqlite no tiene interrupt).
    for (const fila of lectora.prepare(sql).iterate()) { ... MAX_FILAS ... MAX_MS ... }
  } finally { lectora.close(); }
}
```

El bucle (`server/ia/asistente.ts`, `preguntar`) llama `h.correr(db, input)` de forma sincrónica.

## Approach

Correr la consulta en un `worker_threads` Worker (stdlib, sin dependencias). El Worker abre la base de solo lectura,
pone el mismo authorizer, itera con el tope de filas y devuelve `{ filas, aviso? }` o `{ error }`. El hilo principal
espera con `Promise.race` y, a los 5 s, `worker.terminate()` (esto sí corta SQLite: mata el hilo). Así el servidor
sigue atendiendo mientras tanto.

- `consultaSql` pasa a ser `async`; `Herramienta.correr` pasa a devolver `unknown | Promise<unknown>`, y en
  `preguntar` se hace `await h.correr(...)`.
- El código del Worker va en el mismo archivo usando `isMainThread`/`workerData`, o en `server/ia/sqlWorker.ts`
  (TypeScript sin build: Node/Electron corren `.ts` directo; el Worker se crea con
  `new Worker(new URL('./sqlWorker.ts', import.meta.url))`). Verificar que Electron (`ELECTRON_RUN_AS_NODE=1 npx electron`)
  acepta un Worker `.ts` igual que el proceso principal; si no, STOP.
- Empaquetado: `server/**/*.ts` ya entra en `build.files`; un `.ts` nuevo en `server/ia/` viaja solo.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | sin errores |
| Tests | `node --test server/ia/herramientas.test.ts server/ia/asistente.test.ts` | todos `✔` |
| Todo | `npm test` | `fail 0`, `schema OK` |
| Worker en Electron | `ELECTRON_RUN_AS_NODE=1 npx electron <script que llame consultaSql>` | devuelve filas |

## Scope

**In scope**: `server/ia/herramientas.ts`, `server/ia/sqlWorker.ts` (nuevo), `server/ia/asistente.ts` (solo el
`await`), tests de `server/ia/`.
**Out of scope**: las demás herramientas (son funciones del programa, acotadas); el authorizer (mismas reglas).

## Steps

1. Mover apertura + authorizer + iteración al Worker; mensajes `{ ok: { filas, aviso? } }` / `{ error: string }`.
   Los errores de SQLite (`not authorized`, `no such table`) vuelven como texto: el bucle los manda como
   `tool_result` con `is_error: true`, igual que hoy.
2. `consultaSql` async con corte a `MAX_MS`: `terminate()` y resultado `{ filas: [], aviso: 'Se cortó a los 5 s …' }`
   o error "La consulta tardó más de 5 s: simplificala" (preferido: error, para que la IA corrija).
3. `correr` puede devolver promesa; `await` en `preguntar`.
4. Tests: los de `herramientas.test.ts` pasan a `await`; nuevo caso: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n) SELECT count(*) FROM n`
   rechaza con el mensaje de tiempo en menos de ~6 s (bajar el tope por parámetro en el test si hace falta para no
   demorar la suite: p. ej. `consultaSql(db, sql, 300)`).

## Done criteria

- [ ] El test de la consulta infinita termina y falla con el mensaje de tiempo.
- [ ] `npm test` → `fail 0`.
- [ ] Mientras corre la consulta infinita, el hilo principal sigue (el test puede verificar que un `setTimeout(…, 50)` se dispara antes del corte).

## STOP conditions

- El Worker no puede cargar `.ts` en Electron 44 → reportar; alternativa: Worker con código `eval: true` en JS plano.
- `terminate()` no corta una consulta en curso → reportar con el tiempo medido.

## Maintenance notes

- Saca el `ponytail:` del corte entre filas. El tope de filas sigue en el Worker.
- Cada consulta crea un Worker (~decenas de ms): aceptable para preguntas de a una.

## Resultado (2026-10-23, v0.42.5)

Se cumplió la condición de STOP del Worker: `terminate()` **no** corta una consulta en curso (el hilo queda trabado
en SQLite, quema un núcleo y no deja cerrar el proceso). Se usó un **proceso aparte** (`child_process.fork` de
`server/ia/sqlProceso.ts`), que sí se mata: ~70 ms por consulta. Detalles:
- En Electron, `fork` lanza `electron.exe`: hace falta `ELECTRON_RUN_AS_NODE=1` en el `env` (sin eso abre otra app).
  Probado desde el proceso principal real de Electron 44. Requiere que el fusible `RunAsNode` siga habilitado
  (hoy no hay `electronFuses` configurado).
- Al cortar, la promesa se rechaza recién en el `exit` del hijo: así no queda la base tomada.
- **Sin probar**: el instalador (script dentro de `app.asar`). Verificarlo en la próxima prueba del `.exe`
  (`GUIA-PRUEBAS.md`): una pregunta que use `consulta_sql`.
