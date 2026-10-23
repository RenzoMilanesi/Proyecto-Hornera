# 056 — Test: elasticidad contra el mismo mes del año anterior (confianza "baja" y valores positivos)

Escrito contra `4a42a69` (2026-10-23). P3 · S · riesgo BAJO. Depende de: **054** (mismo archivo de tests; con
054 el mes base tiene que estar cerrado).

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 056 de `plans/README.md`.
>
> **Chequeo de cambios (primero):**
> 1. `grep -n "export function elasticidadDelMes" server/resumen.ts` → 1 línea.
> 2. `grep -n "solo con meses cerrados" server/resumen.ts` → 1 línea (el plan 054 está hecho). Si no, **parar**.

## Por qué

`elasticidadDelMes` (en `server/resumen.ts`) compara cada depto entre el mes elegido y un mes base: el mismo mes
del año anterior (`tipo: 'anual'`) o, si no existe, el mes anterior (`tipo: 'mensual'`). La confianza es
`'baja'` solo con `tipo === 'anual'` y 5 deptos o más con dato; si no, `'muy baja'`:

```ts
  const positivos = valores.filter((v) => v > 0).length;
  if (tipo === 'mensual') avisos.push(`Compara contra ${base}, el mes anterior: ...`);
  ...
  if (positivos) avisos.push(`En ${positivos} depto(s) la ocupación subió junto con el precio (valor positivo): ahí pesó la demanda, no el precio.`);
  ...
  return {
    base, tipo, deptos, mediana: valores.length ? (mediana(valores.map((v) => v * 100)) ?? 0) / 100 : null, validos: valores.length,
    confianza: tipo === 'anual' && valores.length >= 5 ? 'baja' : 'muy baja', avisos,
  };
```

El único test (`server/resumen.test.ts`, "elasticidad: arco entre meses, …") cubre solo la comparación
mensual con un depto. Nada prueba la rama anual, la confianza `'baja'` ni el aviso de valores positivos: si
alguien rompe el cálculo de `mesAnterior(mes, 12)` o la condición de confianza, la pantalla mostraría una
confianza mejor (o peor) que la real sin que falle ningún test.

## Paso 1 — Test nuevo en `server/resumen.test.ts`

Leer el archivo entero. Helpers: `periodo(db, mes, inicio, cierre, estado)` (devuelve `{ id }`) y
`liquidacion(db, periodoId, deptoId, ocupadas, bruto, costos, honorarios)`, que inserta con
`noches_disponibles = 30` y sin detalle de reservas: el alojamiento de ese mes es `bruto − costos` y
ADR = alojamiento / ocupadas.

Test nuevo **"elasticidad contra el mismo mes del año anterior: confianza baja y aviso de valores positivos"**:

1. `abrirDb(':memory:')`, `INSERT INTO propietario(nombre) VALUES ('Propietario Uno')` y 5 deptos
   `AAA`, `BBB`, `CCC`, `DDD`, `EEE` (ids 1 a 5) con `propietario_id = 1`.
2. Períodos `2025-04` (`2025-04-01` a `2025-05-01`) y `2026-04` (`2026-04-01` a `2026-05-01`), los dos con
   estado `'abierto'`. **No** crear `2026-03`.
3. Liquidaciones (costos 0, honorarios 0):
   - Deptos 1 a 4, en `2025-04`: `ocupadas 20`, `bruto 20000000` (ADR $10.000). En `2026-04`: `ocupadas 15`,
     `bruto 16500000` (ADR $11.000). Elasticidad de cada uno: (−5/17,5) ÷ (1/10,5) = **−3**.
   - Depto 5, en `2025-04`: `ocupadas 10`, `bruto 10000000` (ADR $10.000). En `2026-04`: `ocupadas 12`,
     `bruto 13200000` (ADR $11.000). Elasticidad: (2/11) ÷ (1/10,5) = 1,909… → **1.91**.
4. `UPDATE periodo SET estado = 'cerrado'`.
5. `const e = elasticidadDelMes(db, '2026-04')` y asertar:
   - `e.base === '2025-04'`, `e.tipo === 'anual'`, `e.validos === 5`.
   - `e.deptos` deep-equal `{ AAA: -3, BBB: -3, CCC: -3, DDD: -3, EEE: 1.91 }`.
   - `e.mediana === -3`, `e.confianza === 'baja'`.
   - Algún aviso matchea `/En 1 depto\(s\) la ocupación subió/`.
   - **Ningún** aviso matchea `/el mes anterior/` ni `/Solo \d+ depto/`.

Datos ficticios.

Verificación: `node --test server/resumen.test.ts` → todos pasan.

## Paso 2 — Que el test falle si se rompe

Cambiar a mano, **temporalmente**, `valores.length >= 5` por `valores.length >= 6` en `server/resumen.ts` y
correr el test: tiene que fallar en `confianza`. Volver el cambio atrás y confirmar con
`git diff server/resumen.ts` → vacío.

## Hecho cuando

- `npm test` → `fail 0`, con un test más que antes.
- `git diff --stat` → solo `server/resumen.test.ts` (y `plans/README.md`).

## Fuera de alcance

- Cambiar `server/resumen.ts`. Si el test muestra un error real en el cálculo, **parar y avisar** con el valor
  obtenido y el esperado.
- Meses cerrados con detalle de reservas (lo cubre el plan 053).

## Parar y avisar

- Si `e.deptos.EEE` no da 1.91 o los demás no dan −3, y no es un error del propio test.

## Mantenimiento

- Si cambia el umbral de 5 deptos o la regla de confianza, este test es el que tiene que cambiar primero.
