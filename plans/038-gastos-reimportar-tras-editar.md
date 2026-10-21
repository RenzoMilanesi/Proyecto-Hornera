# 038 — Reimportar los gastos varios no duplica lo que se editó a mano

Escrito contra el commit `aada2bd` + el plan 037 sin commitear. Revisión `improve deep` del plan 037, 2026-10-21.
Prioridad P2 · Esfuerzo S · Riesgo bajo · Confianza alta.

## Problema
`server/importador/gastos.ts` decide si una fila del Excel "ya está" buscando en el período un movimiento con la
misma fecha, código de depto, tipo, detalle e importe (consulta `yaEsta`). Si el usuario edita ese movimiento en
Movimientos — justo lo que se espera con los códigos desconocidos, que entran a la empresa con `[CAY] · …` en el
detalle para reasignarlos —, la fila deja de coincidir y **el próximo "importar" la vuelve a cargar**: el gasto
queda dos veces (una vez reasignado al depto, otra en la empresa). Lo mismo si se corrige el importe o el detalle.

Escenario: importar → editar el gasto `[CAY] · súper` para ponerlo en el depto CAY → reimportar el mismo Excel
(o uno con más filas del mes) → aparece de nuevo `[CAY] · súper` en la empresa.

## Solución
Guardar en el movimiento la identidad de la fila de origen y deduplicar por ella, no por el contenido.

1. Esquema (las tres cosas juntas, regla de `CLAUDE.md`):
   - `schema.sql`, tabla `movimiento`: columna `origen TEXT` (NULL para todo lo cargado a mano o por CORRIENTE)
     y un índice `CREATE UNIQUE INDEX uq_mov_origen ON movimiento(origen) WHERE origen IS NOT NULL;`.
   - `server/db.ts`: migración nueva al final de `MIGRACIONES` con el mismo `ALTER TABLE` + índice.
   - `schema.check.mjs`: un caso que inserte dos movimientos con el mismo `origen` y espere el error de unicidad.
2. `origen` = `gastos:` + `Mensaje original` + `:` + depto/código + `:` + monto en centavos + `:` + n.º de
   aparición de esa terna en el Excel (un mensaje puede traer varios gastos, ver las expensas de 4 deptos en un
   mismo mensaje; y la misma terna puede repetirse). Si `Mensaje original` está vacío, usar fecha + descripción.
3. `crearMovimiento` no conoce `origen`: agregar un parámetro opcional `origen?: string | null` a
   `DatosMovimiento` que solo use el INSERT (no `editarMovimiento`: editar no cambia el origen).
4. En `importarGastos`, reemplazar `yaEsta` y el mapa `vistas` por `SELECT 1 FROM movimiento WHERE origen = ?`
   (cualquier estado: un anulado no vuelve).

## Verificación
- `npm run typecheck` sin errores; `npm test` todo en verde.
- Test nuevo en `server/importador/gastos.test.ts`: importar, editar con `editarMovimiento` el gasto de `ZZZ`
  (depto `AAA`, otro detalle), reimportar → `importados: 0`, `repetidos: 5`.

## Fuera de alcance
- No tocar el importador del Google Sheet (`server/importador/excel.ts`).
- Los movimientos ya importados antes de esta migración quedan con `origen` NULL: si se reimporta el mismo Excel
  después de migrar, se duplicarían. Si al ejecutar ya hay gastos importados con el plan 037 en una base real,
  PARAR y preguntar (opción: completar `origen` de esos con un UPDATE de una vez).
