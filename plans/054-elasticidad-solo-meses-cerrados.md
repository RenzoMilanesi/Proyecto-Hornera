# 054 — Elasticidad: calcular solo con meses cerrados

Escrito contra `4a42a69` (2026-10-23). P2 · S · riesgo BAJO. Depende de: ninguno.

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 054 de `plans/README.md`.
>
> **Chequeo de cambios (primero):** `grep -n "Uno de los meses está abierto" server/resumen.ts` → 1 línea.
> Si no aparece, parar y avisar.

## Por qué

La pantalla Resumen muestra una **elasticidad precio** por depto: cuánto cambió la ocupación cuando cambió el
ADR, entre el mes elegido y un mes base (el mismo mes del año anterior o, si no existe, el mes anterior). La
calcula `elasticidadDelMes` en `server/resumen.ts`. Hoy acepta meses **abiertos**, y eso da números engañosos:

1. **Sesgo:** en un mes abierto las reservas siguen entrando hasta fin de mes. Su ocupación es parcial y se
   compara contra un mes base completo, así que la ocupación "baja" y la elasticidad sale más negativa de lo
   real. El único aviso es "Uno de los meses está abierto: los números todavía cambian", que no dice que el
   error va siempre para el mismo lado.
2. **Aviso falso:** un mes abierto sin cotización del dólar no calcula ningún depto (`liquidarPeriodo` en
   `server/liquidacion/servicio.ts` devuelve `deptos: []` con el aviso "Falta la cotización…"). La elasticidad
   entonces dice "Ningún depto cambió el ADR un 5 % o más", que es falso: no se pudo calcular.
3. Además, para un mes abierto la consulta `/api/resumen` corre el motor de liquidación dos veces (una en
   `resumenDelMes` y otra acá).

La pantalla arranca en el último mes cerrado, así que esto pasa solo si se elige a mano un mes abierto.

**Regla (decidida; no reabrir):** la elasticidad solo se calcula si el mes elegido está **cerrado**, y el mes
base tiene que estar **cerrado** también. Si el mismo mes del año anterior existe pero está abierto, se prueba
con el mes anterior (cerrado); si ninguno sirve, no hay base.

## Estado actual

`server/resumen.ts`:

```ts
export function elasticidadDelMes(db: DatabaseSync, mes: string) {
  const existe = (m: string) => db.prepare('SELECT 1 FROM periodo WHERE mes = ?').get(m) !== undefined;
  const anual = mesAnterior(mes, 12);
  const base = existe(anual) ? anual : existe(mesAnterior(mes, 1)) ? mesAnterior(mes, 1) : null;
  const avisos = ['Indicativa: el precio se sube cuando ...'];
  if (!base) {
    return { base: null, tipo: null, deptos: {} as Record<string, number>, mediana: null, validos: 0, confianza: 'sin datos', avisos: [...avisos, 'No hay un mes anterior cargado para comparar.'] };
  }
  ...
  if ([mes, base].some((m) => (db.prepare('SELECT estado FROM periodo WHERE mes = ?').get(m) as { estado: string }).estado === 'abierto')) {
    avisos.push('Uno de los meses está abierto: los números todavía cambian.');
  }
  return { ... };
}
```

## Paso 1 — `server/resumen.ts`

1. Renombrar `existe` a `cerrado` y que pregunte por el estado:
   ```ts
   const cerrado = (m: string) => db.prepare(`SELECT 1 FROM periodo WHERE mes = ? AND estado = 'cerrado'`).get(m) !== undefined;
   ```
   y usar `cerrado(...)` en la línea de `base`.
2. Justo antes de `if (!base)`, agregar la salida para un mes elegido que no está cerrado, con la **misma forma**
   de objeto que el `return` de `!base` (para que el tipo no cambie):
   ```ts
   if (!cerrado(mes)) {
     return { base: null, tipo: null, deptos: {} as Record<string, number>, mediana: null, validos: 0, confianza: 'sin datos', avisos: [...avisos, 'Se calcula solo con meses cerrados: en un mes abierto todavía faltan reservas y la ocupación sale más baja.'] };
   }
   ```
3. Cambiar el aviso de `!base` a: `'No hay un mes anterior cerrado para comparar.'`
4. Borrar el bloque `if ([mes, base].some(... 'abierto')) { avisos.push('Uno de los meses está abierto…') }`:
   ya no puede pasar.

No tocar `kpisDelMes`, `resumenDelMes`, `metricas`, `arco` ni `src/Resumen.tsx` (la pantalla ya muestra
"sin datos", "—" y los avisos).

Verificación: `npm run typecheck` sin errores; `node --test server/resumen.test.ts` → todos pasan (el test
existente de elasticidad cierra los meses antes de calcular).

## Paso 2 — Test en `server/resumen.test.ts`

Leer el archivo: tiene los helpers `periodo(db, mes, inicio, cierre, estado)` (devuelve `{ id }`) y
`liquidacion(db, periodoId, deptoId, ocupadas, bruto, costos, honorarios)`. Patrón: el test
"elasticidad: arco entre meses, …" del mismo archivo.

Test nuevo **"elasticidad: solo con meses cerrados"**:

1. `abrirDb(':memory:')`, propietario y un depto `AAA` (como en el test existente).
2. Períodos: `2025-04` **abierto**, `2026-03` cerrado, `2026-04` abierto (usar el helper con estado
   `'abierto'` y después `UPDATE periodo SET estado = 'cerrado' WHERE mes = '2026-03'`, porque `liquidacion`
   se inserta con el período abierto).
3. Liquidaciones de `AAA` en `2026-03` y `2026-04` con los mismos números del test existente
   (`20, 21000000, 1000000, 0` y `15, 17500000, 1000000, 0`).
4. Asertar sobre `elasticidadDelMes(db, '2026-04')` (abierto): `confianza === 'sin datos'`, `base === null`,
   `deptos` deep-equal `{}`, y algún aviso que matchee `/solo con meses cerrados/`.
5. `UPDATE periodo SET estado = 'cerrado' WHERE mes = '2026-04'` y asertar: `base === '2026-03'`
   (el año anterior está abierto, así que va al mes anterior), `tipo === 'mensual'`, `deptos` deep-equal
   `{ AAA: -3 }`, y que **ningún** aviso matchee `/está abierto/`.

Datos ficticios.

Verificación: `node --test server/resumen.test.ts` → todos pasan.

## Paso 3 — Documentación

- `DECISIONES.md`, renglón que empieza con `- **Elasticidad (indicativa`: agregar después de "La cartera
  muestra la mediana." la frase "Solo con meses cerrados (el elegido y el base): en un mes abierto faltan
  reservas y la ocupación sale más baja."
- `manual/manual.html`: en la fila del glosario `<tr><td>Elasticidad</td>`, agregar al final de la descripción
  "Solo se calcula con meses cerrados." **No** regenerar capturas ni el PDF del manual.

## Hecho cuando

- `npm run typecheck` sin errores y `npm test` → `fail 0`, con un test más que antes.
- `grep -c "está abierto" server/resumen.ts` → 0.
- `grep -n "solo con meses cerrados" server/resumen.ts` → 1 línea.

## Fuera de alcance

- `src/Resumen.tsx`, el motor, `servicio.ts`.
- La línea de DECISIONES que dice que la elasticidad "queda afuera del sistema" (es el plan 055).

## Parar y avisar

- Si el test existente de elasticidad deja de pasar y no es por el texto del aviso de `!base`.
- Si `typecheck` marca que el tipo de retorno cambió en `src/Resumen.tsx`.

## Mantenimiento

- Si algún día se quiere ver la elasticidad "en vivo" del mes en curso, hay que comparar contra el mismo
  punto del mes base (reservas hechas hasta el mismo día), no contra el mes base completo.
