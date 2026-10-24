# 069 — Acciones del asistente: cuatro ajustes de la revisión del plan 068

Escrito contra `2a56f0c` (2026-10-24). P2 · S. Depende de: 068 (hecho hasta el paso 6). Revisión `improve deep` del diff
`5282eae..2a56f0c`.

## Por qué
El plan 068 dejó que el asistente proponga cambios y que la persona los confirme con un botón. La revisión encontró un
hueco de alcance (puede proponer anular el **pago de una liquidación**, que el usuario dejó fuera: "pagar y facturar, no"),
un header que cualquier pantalla puede usar para marcar como editada una propuesta ajena, un encabezado de seguridad que
falta al servir comprobantes y caminos de confirmar sin test.

## Reglas del repo (CLAUDE.md)
- TypeScript sin build (sin enums ni namespaces; imports con `.ts`). Plata en centavos. Respuestas y mensajes en español.
- Verificación: `npm run typecheck` y `npm test` (el hook de pre-commit los corre). Commit con la skill `commit-version`
  (patch), un commit para todo el plan.

## Pasos

### 1. El asistente no propone anular pagos ni transferencias
`server/ia/propuestas.ts`, `proponerMovimiento`, rama `accion === 'anulacion'` (hoy, cerca de la línea 75):
```ts
  if (accion === 'anulacion') {
    const antes = movimientoActual(db, id);
    ensayar(db, () => anularMovimiento(db, id));
```
Agregar, después de leer `antes`: si `antes.tipo` no está en `TIPOS_CARGABLES` (importado de `../movimientos.ts`),
`throw new Error('Los pagos de liquidación y las transferencias se anulan en su pantalla (Transferencias o Movimientos), no desde el asistente.')`.
La edición ya la frena `editarMovimiento` ("no se editan").
- Test en `server/ia/asistente.test.ts` o `server/app.test.ts` (seguir el test "propuestas (plan 068)…"): crear un
  movimiento de tipo `liquidacion` con SQL (mirar `schema.check.mjs` para las columnas mínimas) y comprobar que
  `proponerMovimiento(db, { accion: 'anulacion', id, … })` tira ese error.

### 2. "X-Hornera-Ia" solo marca una propuesta pendiente de esta PC
`server/app.ts`, el middleware que lee `req.headers['x-hornera-ia']` (después de `app.use('/api', autorizar(db))`). Hoy el
`UPDATE propuesta_ia SET estado = 'editada' … WHERE id = ? AND estado = 'pendiente'` no mira de qué PC es. Cambiar el
WHERE a `id = ? AND estado = 'pendiente' AND conversacion_id IN (SELECT id FROM conversacion_ia WHERE pc = ?)` con
`pcActual.getStore() ?? nombrePc(db)` (lo mismo que `pcIa()` más abajo en el archivo; se puede mover `pcIa` arriba del
middleware y usarla). La marca "con IA" de la auditoría se queda como está.
- Test: en el test "lo guardado desde "Editar"…" de `server/app.test.ts`, agregar una propuesta de una conversación con
  `pc = 'Otra PC'` y comprobar que guardar con su id en el header no la marca `editada`.

### 3. Comprobantes servidos con `nosniff`
`server/app.ts`, ruta `GET /api/adjuntos/:id`: agregar `res.setHeader('X-Content-Type-Options', 'nosniff')` antes de
`res.send`. El tipo ya se valida por los primeros bytes al subir (`server/adjuntos.ts`); esto evita que un navegador
reinterprete el contenido.
- Test: en "comprobantes por la API…" de `server/app.test.ts`, `assert.equal(r.headers.get('x-content-type-options'), 'nosniff')`.

### 4. Tests de confirmar para gasto personal, ficha y cotización
Hoy `server/app.test.ts` ("confirmar y descartar tarjetas…") solo cubre movimientos. Agregar en ese mismo test, o en uno
nuevo con el mismo armado, una propuesta de cada una con `proponerGastoPersonal`, `proponerFicha` (alta de una clave) y
`proponerMes` (cotización manual de un mes abierto), confirmarlas por `POST /api/ia/propuestas/:id/confirmar` y comprobar:
el gasto personal existe, la clave está en la ficha, `periodo.usd_cotizacion` cambió, y las tres filas de auditoría tienen
`con_ia = 1`. `proponerMes` con `accion: 'traer_stays'` no se confirma en el test (necesita Stays).

## Fuera de alcance
- El "Editar" de una tarjeta no compara con el "antes" (la persona ve el formulario con lo que va a guardar): no tocar.
- Volver a mandar los adjuntos viejos en cada pregunta de la conversación (están en el prefijo cacheado): no tocar.

## Criterios de terminado
- `npm run typecheck` sin errores; `npm test` con `fail 0` y los tests nuevos de los pasos 1 a 4 pasando.
- `git diff --stat` toca solo `server/ia/propuestas.ts`, `server/app.ts`, `server/app.test.ts` (y/o
  `server/ia/asistente.test.ts`), `package.json` y este plan.

## Mantenimiento
Si se suma una acción nueva al asistente, revisar que su `proponer_*` no abra una puerta a algo que el usuario dejó fuera
(pagar, facturar, cerrar el mes) y que tenga su test de confirmar.
