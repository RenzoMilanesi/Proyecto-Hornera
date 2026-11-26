# Plan 080: El cruce automático de la tarjeta solo vincula pares únicos

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git log --oneline -3 -- server/tarjeta.ts server/tarjeta.test.ts`
> The plan was written against v0.58.0 (the commit that adds `server/tarjeta.ts`). If `cruzar` no longer
> matches the excerpt below, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: v0.58.0 (sobre `49e491b`), 2026-11-26

## Why this matters

Hornera → Tarjetas cruza cada consumo del resumen de la tarjeta con un gasto del mismo importe (±$1). Con importes
redondos hay varios candidatos y hoy gana el primero: con los datos reales de octubre, el consumo **LA HACIENDA $7.000**
(viandas, 25/09) quedó vinculado solo a **PRO · Ferretería $7.000**, y el consumo de la ferretería verdadera
(MERPAGO*FERRETERIALIVERPO $7.000, 07/10) quedó pendiente. Un vínculo automático equivocado es peor que uno pendiente:
nadie lo revisa porque ya figura "con gasto". Regla nueva: vincular solo si el par es **único en las dos direcciones**;
lo ambiguo queda pendiente para hacerlo a mano.

## Current state

- `server/tarjeta.ts` — lector del PDF, cruce y acciones. La función a cambiar es `cruzar(db, resumenId)`:

```ts
// server/tarjeta.ts (cruzar)
  const pendientes = db.prepare(`SELECT c.id, c.fecha, c.importe_ars FROM consumo_tarjeta c ${PENDIENTE} AND c.resumen_id = ? AND c.importe_ars > 0
    ORDER BY c.fecha`).all(resumenId) as { id: number; fecha: string; importe_ars: number }[];
  const cerca = `(abs(julianday(x.fecha) - julianday(:fecha)) <= ${DIAS_VENTANA} OR abs(julianday(x.fecha) - julianday(:cierre)) <= ${DIAS_VENTANA})`;
  const candidato = db.prepare(`
    SELECT 'mov' AS tipo, x.id, abs(julianday(x.fecha) - julianday(:fecha)) AS dist FROM movimiento x
     WHERE ... AND abs(-x.importe_ars - :importe) <= ${TOLERANCIA} AND ${cerca}
       AND NOT EXISTS (SELECT 1 FROM consumo_tarjeta c WHERE c.movimiento_id = x.id)
    UNION ALL
    SELECT 'ajeno', x.id, ... FROM gasto_ajeno x WHERE ...
    ORDER BY dist LIMIT 1`);
  ...
    for (const c of pendientes) {
      const g = candidato.get({ fecha: c.fecha, cierre: r.cierre, importe: c.importe_ars }) as { tipo: string; id: number } | undefined;
      if (!g) continue;
      (g.tipo === 'mov' ? ponerMov : ponerAjeno).run(g.id, c.id);
```

- `server/tarjeta.test.ts` — tests con renglones ficticios (`VISA`) y una base en memoria (`base()`, `gasto(db, importe, depto, fecha)`).
  El test `cruce: cada consumo en pesos va solo al gasto del mismo importe…` es el modelo.
- Convenciones: TypeScript sin build (imports con `.ts`), plata en centavos, comentarios en español, mínimo código;
  un comentario `ponytail:` marca una simplificación a propósito. Ver `CLAUDE.md`.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                | exit 0              |
| Tests     | `node --test server/tarjeta.test.ts` | all pass          |
| Todo      | `npm test`                         | all pass            |

## Scope

**In scope**: `server/tarjeta.ts` (solo `cruzar` y su comentario), `server/tarjeta.test.ts`.

**Out of scope**: la pantalla (`src/Tarjetas.tsx`), el esquema, `vincular`/`cargar`, la tolerancia (±$1) y la ventana (45 días).

## Steps

### Step 1: Test que reproduce el bug (debe fallar)

En `server/tarjeta.test.ts`, test nuevo: base con dos gastos de $7.000 (`gasto(db, 700000)` dos veces, fechas 2026-10-07)
y un resumen leído con dos consumos de $7.000 en fechas distintas (armar renglones como `VISA`, con importes `7.000,00`),
más un consumo único de $9.000 con un gasto único de $9.000. Esperado: `guardarResumen(...).vinculados === 1` (solo el de
$9.000) y los dos de $7.000 en `'pendiente'`. Segundo caso en el mismo test: un consumo de $5.000 y dos gastos de $5.000 →
pendiente.

**Verify**: `node --test server/tarjeta.test.ts` → el test nuevo falla (hoy vincula los de $7.000).

### Step 2: Vincular solo pares únicos

En `cruzar`: para cada consumo pendiente, traer **todos** los candidatos (sacar `LIMIT 1`). Vincular solo si hay
exactamente un candidato **y** ese gasto es candidato de exactamente un consumo pendiente del resumen (contar, para el
gasto elegido, cuántos pendientes del mismo resumen tienen importe dentro de la tolerancia y fecha dentro de la ventana;
se puede hacer en JS sobre la lista `pendientes`). Actualizar el comentario de la función: "Si hay más de un candidato
en cualquiera de las dos direcciones, queda pendiente para elegirlo a mano."

**Verify**: `node --test server/tarjeta.test.ts` → todos pasan, incluido el nuevo.

### Step 3: Suite completa

**Verify**: `npm run typecheck` → exit 0; `npm test` → todos pasan.

## Test plan

- Nuevo: ambigüedad en las dos direcciones (2 consumos/2 gastos y 1 consumo/2 gastos) queda pendiente; el par único se vincula.
- Los tests existentes de cruce (`±$1`, fuera de ventana, "Cruzar de nuevo") tienen que seguir pasando sin cambios.

## Done criteria

- [ ] `npm run typecheck` exit 0
- [ ] `npm test` exit 0, con el test nuevo de ambigüedad
- [ ] `git status` solo muestra `server/tarjeta.ts`, `server/tarjeta.test.ts` y `plans/README.md`

## STOP conditions

- `cruzar` no coincide con el excerpt (drift).
- Para hacerlo parece necesario cambiar el esquema o la pantalla.
- Algún test existente de `server/tarjeta.test.ts` necesita cambiar su resultado esperado (salvo el caso que este plan corrige): reportar cuál.

## Maintenance notes

- Con datos reales de octubre bajan los vínculos automáticos (de 30 a algo menos): es lo buscado; los ambiguos se ven como pendientes.
- Si después se agrega una pista por texto (rubro del comercio contra el concepto del gasto), entra acá como desempate.
