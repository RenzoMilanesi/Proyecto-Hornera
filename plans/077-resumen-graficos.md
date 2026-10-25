# Plan 077: Resumen con gráficos: evolución año contra año y ranking de deptos por RevPAR

> **Executor**: seguí los pasos en orden; corré cada verificación y confirmá el resultado antes de seguir. Si pasa algo
> de "PARAR si", frená y avisá: no improvises. Al terminar, actualizá la fila 077 de `plans/README.md`.
>
> **Drift check (primero)**: `git diff --stat 7456f78..HEAD -- src/Resumen.tsx server/resumen.ts`
> Si cambió algo, compará los extractos de abajo con el código actual; si no coinciden, PARAR.

## Estado
- **Prioridad**: P2 · **Esfuerzo**: M · **Riesgo**: BAJO · **Depende de**: nada · **Categoría**: direction
- **Escrito contra**: `7456f78`, 2026-10-25. Pedido del usuario: "gráficos 1 y 2" de las ideas de estadísticas.

## Por qué
Hornera es una app de escritorio (Electron + React + Ant Design) que liquida alquileres temporarios. La pantalla
**Resumen** (`src/Resumen.tsx`) hoy muestra solo números y tablas. Dos preguntas que los dueños se hacen y la tabla
no contesta de un vistazo:
1. **¿Este mes estuvo mejor o peor que el mismo mes del año pasado?** La temporada manda (enero no se compara con
   junio), así que el gráfico pone los meses de enero a diciembre en el eje X y **una línea por año**.
2. **¿Qué deptos rinden más y cuáles quedan abajo?** RevPAR (ingreso por noche a la venta = ADR × ocupación) es el
   número para comparar deptos (ver DECISIONES.md). Un ranking en barras horizontales, con la mediana marcada.

No se agrega ninguna librería: DECISIONES.md dice textualmente "Barras simples en CSS: sin librería de gráficos."
El ranking va en HTML/CSS; las líneas, en un `<svg>` propio (React lo dibuja directo, sin dependencias).

## Estado actual

### Datos (no se tocan: el servidor ya los da)
`server/resumen.ts`:
- `evolucion(db)` (líneas 97-116), expuesta como `GET /api/resumen/evolucion`. Devuelve un array ordenado por `mes`
  (`'YYYY-MM'`), un elemento por mes:
  ```ts
  { mes, noches_disponibles, noches_ocupadas, ocupacion, adr, revpar, reservas, bruto, honorarios, costos_operativos,
    empresa_ars, resultado_ars, personales }
  ```
  - Meses cerrados en la app: todo con valor. `ocupacion` es una fracción 0..1; `adr`, `revpar`, `bruto` en
    **centavos de peso** (enteros). `ocupacion`/`adr`/`revpar` pueden ser `null` si no hubo noches.
  - Meses anteriores a la app (histórico del Excel, hoja OCUPACION, desde 12/2021): **solo `noches_ocupadas`**, el
    resto `null`.
  - Los meses abiertos no vienen.
- `resumenDelMes(db, mes)` (líneas 70-93), expuesta como `GET /api/resumen?mes=YYYY-MM`. Trae `deptos` (un objeto por
  depto con `codigo`, `nombre`, `ocupacion`, `adr`, `revpar`, … — `revpar` en centavos o `null`) y
  `totales.revpar_mediana` (centavos o `null`).

### La pantalla `src/Resumen.tsx`
- Imports (líneas 2-6):
  ```ts
  import { useEffect, useState } from 'react';
  import { Alert, Card, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
  import { mesVisto } from './Asistente.tsx';
  import type { elasticidadDelMes, evolucion, resumenDelMes } from '../server/resumen.ts';
  import { get, pesos } from './api.ts';
  ```
- Helpers ya definidos arriba: `pct(x)` → `'83 %'` (o `''` si null), `plata(x)` → `pesos(x)` o `''`,
  `type KpiDepto = Resumen['deptos'][number]`, `type Mes = ReturnType<typeof evolucion>[number]`.
- Estado: `datos` (el resumen del mes), `historia` (la evolución), `mes`.
- Orden de las tarjetas en el JSX: selector de mes → alertas → `<div className="tarjetas-kpi">` (6 tarjetas) →
  `<Card size="small" title="Por depto">` (tabla) → `<Card size="small" title="Elasticidad precio (indicativa)">` →
  `<Card size="small" title="Evolución mensual">` (tabla). La última hoy es:
  ```tsx
      <Card size="small" title="Evolución mensual">
        <Typography.Paragraph type="secondary">
          Meses cerrados. Antes de usar la app solo hay noches ocupadas (hoja OCUPACION del Excel).
        </Typography.Paragraph>
        <Table<Mes> rowKey="mes" size="small" pagination={false} loading={!historia && !error} scroll={{ x: 'max-content', y: 480 }}
          dataSource={historia ? [...historia].reverse() : undefined} columns={[ ... ]} />
      </Card>
  ```

### Convenciones del repo (respetarlas)
- TypeScript sin build: imports con extensión `.ts`/`.tsx`; nada de `enum` ni `namespace`.
- Textos en español rioplatense ("tocá", "podés"). Comentarios cortos que dicen el porqué. Un comentario `ponytail:`
  marca una simplificación hecha a propósito y dice cuándo mejorarla.
- Estilo mínimo: sin abstracciones de más, sin librerías nuevas.
- Selector de opciones: `Segmented` de antd, como en `src/Comprobantes.tsx:86`:
  `<Segmented value={vista} onChange={setVista} options={[{ value: 'hornera', label: 'Desde Hornera' }, ...]} />`
- Colores del tema "Ladrillo" (`src/main.tsx`): terracota `#A8461F` (primario), marrón `#2A211B` (texto), texto
  secundario `#6E6259`, bordes `#D9CFC2` / `#E6DED3`, fondo `#F6F2EC`. Usar solo estos más los dos tonos claros
  indicados abajo.
- Tests de la interfaz: `src/*.test.ts` con `node:test` y `node:assert/strict`, solo funciones puras (sin JSX). Patrón:
  `src/api.test.ts`:
  ```ts
  // Correr: npm test. Solo los helpers puros de la interfaz.
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { get, leerPlata, SIN_CONEXION } from './api.ts';
  ```
  `npm test` ya corre `src/**/*.test.ts`.

## Comandos

| Para qué | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sin errores |
| Tests | `npm test` | `fail 0` (los de Excel pueden salir `skipped`) |
| Datos de demo | `node manual/seed.ts <carpeta>` | crea `<carpeta>/hornera.db` con meses 2026-08 y 2026-09 cerrados |
| Abrir con demo | `npx electron . --user-data-dir=<carpeta>` | abre la app (puerto 4310: si `npm run dev` está abierto, PARAR y pedir que lo cierren) |

## Alcance
**Se tocan solo**:
- `src/graficos.ts` (crear): funciones puras.
- `src/graficos.test.ts` (crear).
- `src/Graficos.tsx` (crear): los dos componentes.
- `src/Resumen.tsx`: usar los componentes.
- `manual/manual.html` (sección del Resumen, la lista de líneas ~207-215) y `GUIA-PRUEBAS.md` (sección 8).

**Fuera de alcance** (no tocar):
- `server/` entero: los datos ya alcanzan. Ni endpoints nuevos ni columnas nuevas.
- `src/ResumenHornera.tsx`: tiene su propia evolución (resultado); no es parte de este pedido.
- La tabla "Por depto" y la tabla "Evolución mensual": **quedan como están** (el gráfico se agrega arriba de la tabla).
- Capturas del manual y PDF: no regenerarlas (se hacen al final de la tanda).
- `package.json`: nada de dependencias nuevas.

## Pasos

### Paso 1: funciones puras en `src/graficos.ts`
Crear el archivo con exactamente esto:
```ts
// Cuentas de los gráficos del Resumen (sin React, para poder probarlas con node --test).

// Una serie por año, con 12 valores (ene..dic) y null donde no hay dato. Años de menor a mayor.
export function porAnio<T extends { mes: string }>(filas: T[], valor: (f: T) => number | null) {
  const anios = new Map<number, (number | null)[]>();
  for (const f of filas) {
    const v = valor(f);
    if (v == null) continue;
    const [anio, m] = f.mes.split('-').map(Number);
    if (!anios.has(anio)) anios.set(anio, Array(12).fill(null));
    anios.get(anio)![m - 1] = v;
  }
  return [...anios].sort(([a], [b]) => a - b).map(([anio, valores]) => ({ anio, valores }));
}

// Tope redondo del eje: el primer 1, 2, 5 o 10 × 10^n que no queda por debajo del máximo.
export function techo(max: number) {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((k) => k * p).find((x) => x >= max)!;
}

// El trazo de una línea con huecos: arranca de nuevo (M) después de cada null.
export function trazo(puntos: ({ x: number; y: number } | null)[]) {
  let d = '';
  let antes = false;
  for (const p of puntos) {
    if (p) d += `${antes ? 'L' : 'M'}${Math.round(p.x)},${Math.round(p.y)} `;
    antes = p != null;
  }
  return d.trim();
}
```
**Verificar**: `npm run typecheck` → sin errores.

### Paso 2: tests en `src/graficos.test.ts`
```ts
// Correr: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { porAnio, techo, trazo } from './graficos.ts';

test('porAnio: una serie por año, meses sin dato en null, años ordenados', () => {
  const filas = [{ mes: '2025-12', v: 3 }, { mes: '2024-01', v: 1 }, { mes: '2025-01', v: null }, { mes: '2025-02', v: 2 }];
  const series = porAnio(filas, (f) => f.v);
  assert.deepEqual(series.map((s) => s.anio), [2024, 2025]);
  assert.equal(series[0].valores[0], 1);
  assert.equal(series[1].valores[0], null); // enero 2025 sin dato
  assert.equal(series[1].valores[1], 2);
  assert.equal(series[1].valores[11], 3);
  assert.equal(series[1].valores.length, 12);
});

test('porAnio: un año sin ningún dato no aparece', () => {
  assert.deepEqual(porAnio([{ mes: '2023-05', v: null }], (f) => f.v), []);
});

test('techo: redondea el máximo hacia arriba a 1, 2 o 5 × 10^n', () => {
  assert.deepEqual([0, 7, 10, 13, 260, 0.83, 4_350_000].map(techo), [1, 10, 10, 20, 500, 1, 5_000_000]);
});

test('trazo: corta la línea en los huecos', () => {
  assert.equal(trazo([{ x: 0, y: 10 }, { x: 5, y: 20 }, null, { x: 15, y: 5 }, { x: 20, y: 0 }]), 'M0,10 L5,20 M15,5 L20,0');
});
```
**Verificar**: `npm test` → `fail 0`, y los 4 tests nuevos con ✔. Si `techo(0.83)` no da `1` por un error de coma
flotante, PARAR y avisar (no cambiar el test para que pase).

### Paso 3: componentes en `src/Graficos.tsx`
Crear el archivo con dos componentes. El código de abajo es la forma esperada; respetá medidas, colores y textos.

```tsx
// Gráficos del Resumen, sin librería (DECISIONES.md): líneas en SVG y barras en CSS.
import { porAnio, techo, trazo } from './graficos.ts';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TERRACOTA = '#A8461F';
const MARRON = '#2A211B';
const GRIS = '#6E6259';
const VIEJO = '#CDBFB0'; // años anteriores al pasado: de fondo, para ver la forma de la temporada
const GRILLA = '#E6DED3';

// Color y grosor por antigüedad: el último año en terracota, el anterior en marrón, el resto de fondo.
const estilo = (i: number, n: number) =>
  i === n - 1 ? { color: TERRACOTA, ancho: 2.5, r: 3.5 } : i === n - 2 ? { color: MARRON, ancho: 1.75, r: 3 } : { color: VIEJO, ancho: 1.25, r: 2 };

export function LineasPorAnio<T extends { mes: string }>({ filas, valor, formato, tope }: {
  filas: T[];
  valor: (f: T) => number | null;
  formato: (v: number) => string;
  tope?: number; // fijo (p. ej. 1 = 100 % para la ocupación); si no, el máximo redondeado
}) {
  const series = porAnio(filas, valor);
  if (!series.length) return <p style={{ color: GRIS }}>Todavía no hay meses cerrados con este dato.</p>;
  const W = 720, H = 260, izq = 84, der = 12, arr = 12, aba = 28;
  const max = tope ?? techo(Math.max(...series.flatMap((s) => s.valores.filter((v): v is number => v != null))));
  const x = (i: number) => izq + (i * (W - izq - der)) / 11;
  const y = (v: number) => arr + (1 - v / max) * (H - arr - aba);
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  return (
    // ponytail: ancho fijo en viewBox; con la ventana muy angosta aparece scroll horizontal en vez de rearmar el eje.
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 560, display: 'block' }} role="img"
        aria-label={`Gráfico por mes, una línea por año: ${series.map((s) => s.anio).join(', ')}`}>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={izq} x2={W - der} y1={y(m)} y2={y(m)} stroke={GRILLA} />
            <text x={izq - 8} y={y(m) + 4} textAnchor="end" fontSize={12} fill={GRIS}>{formato(m)}</text>
          </g>
        ))}
        {MESES.map((m, i) => <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill={GRIS}>{m}</text>)}
        {series.map((s, i) => {
          const e = estilo(i, series.length);
          return (
            <g key={s.anio}>
              <path d={trazo(s.valores.map((v, j) => (v == null ? null : { x: x(j), y: y(v) })))} fill="none" stroke={e.color}
                strokeWidth={e.ancho} strokeLinejoin="round" strokeLinecap="round" />
              {s.valores.map((v, j) => v != null && (
                <circle key={j} cx={x(j)} cy={y(v)} r={e.r} fill={e.color}>
                  <title>{`${MESES[j]} ${s.anio}: ${formato(v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: GRIS, marginTop: 4 }}>
        {series.map((s, i) => (
          <span key={s.anio} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 18, height: 3, borderRadius: 2, background: estilo(i, series.length).color }} />{s.anio}
          </span>
        ))}
      </div>
    </div>
  );
}

// Barras horizontales de mayor a menor, con la mediana como línea punteada. `detalle` va al pasar el mouse.
export function Ranking({ filas, mediana, formato }: {
  filas: { clave: string; etiqueta: string; valor: number; detalle: string }[];
  mediana: number | null;
  formato: (v: number) => string;
}) {
  if (!filas.length) return <p style={{ color: GRIS }}>Ningún depto tuvo noches a la venta este mes.</p>;
  const orden = [...filas].sort((a, b) => b.valor - a.valor);
  const max = orden[0].valor || 1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 220px) 1fr auto', gap: '6px 12px', alignItems: 'center', fontSize: 13 }}>
      {orden.map((f) => (
        <div key={f.clave} title={f.detalle} style={{ display: 'contents' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.etiqueta}</span>
          <div style={{ position: 'relative', height: 16, background: '#F6F2EC', borderRadius: 3 }}>
            {/* Arriba de la mediana en terracota; abajo, en un tono claro: se ve la mitad que rinde menos. */}
            <div style={{ width: `${(100 * Math.max(f.valor, 0)) / max}%`, height: '100%', borderRadius: 3,
              background: mediana != null && f.valor < mediana ? '#E3C2B1' : TERRACOTA }} />
            {mediana != null && <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${(100 * mediana) / max}%`,
              borderLeft: `2px dashed ${MARRON}` }} />}
          </div>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formato(f.valor)}</span>
        </div>
      ))}
    </div>
  );
}
```
Notas para no equivocarse:
- `display: 'contents'` en el `div` de cada fila hace que sus tres hijos ocupen las tres columnas del grid. El
  `title` de ese `div` no se muestra en todos los navegadores con `contents`; si al probar (paso 6) el tooltip no
  aparece, poné el `title={f.detalle}` en cada uno de los tres hijos en vez de en el `div` y sacalo de ahí.
- `<title>` dentro de `<circle>` es el tooltip nativo del SVG: no hace falta código de hover.

**Verificar**: `npm run typecheck` → sin errores.

### Paso 4: usar los componentes en `src/Resumen.tsx`
1. Imports: agregar `Segmented` a la lista de antd (orden alfabético: `..., Select, Segmented, Space, ...`; cualquier
   orden compila) y una línea nueva:
   ```ts
   import { LineasPorAnio, Ranking } from './Graficos.tsx';
   ```
2. Debajo de `const plata = ...` (línea ~16), agregar:
   ```ts
   // Pesos sin centavos, para ejes y barras (los centavos no se leen en un gráfico).
   const pesosRedondos = (c: number) => `$ ${Math.round(c / 100).toLocaleString('es-AR')}`;
   // Qué se grafica en la evolución. Noches primero: es lo único con años de historia (hoja OCUPACION).
   const METRICAS = {
     noches: { label: 'Noches ocupadas', valor: (m: Mes) => m.noches_ocupadas, formato: (v: number) => Math.round(v).toLocaleString('es-AR'), tope: undefined },
     ocupacion: { label: 'Ocupación', valor: (m: Mes) => m.ocupacion, formato: (v: number) => `${Math.round(100 * v)} %`, tope: 1 },
     adr: { label: 'ADR', valor: (m: Mes) => m.adr, formato: pesosRedondos, tope: undefined },
     revpar: { label: 'RevPAR', valor: (m: Mes) => m.revpar, formato: pesosRedondos, tope: undefined },
   };
   type Metrica = keyof typeof METRICAS;
   ```
3. Dentro de `Resumen()`, junto a los otros `useState`:
   ```ts
   const [metrica, setMetrica] = useState<Metrica>('noches');
   ```
4. **Ranking**: entre el `</div></div>` que cierra `tarjetas-kpi` y `<Card size="small" title="Por depto">`, agregar:
   ```tsx
      <Card size="small" title={ayuda('Ranking por RevPAR',
        'RevPAR = lo que pagaron los huéspedes por las noches ÷ noches a la venta. Junta precio y ocupación: es el número para comparar deptos. La línea punteada es la mediana; las barras claras, los deptos por debajo de ella.')}>
        {datos && (
          <>
            <Ranking mediana={datos.totales.revpar_mediana} formato={pesosRedondos}
              filas={datos.deptos.flatMap((d) => (d.revpar == null ? [] : [{
                clave: d.codigo, etiqueta: `${d.codigo} · ${d.nombre}`, valor: d.revpar,
                detalle: `Ocupación ${pct(d.ocupacion)} · ADR ${plata(d.adr)} · ${d.noches_vendidas} / ${d.noches_venta} noches`,
              }]))} />
            {datos.deptos.some((d) => d.revpar == null) && (
              <Typography.Paragraph type="secondary" style={{ margin: '10px 0 0' }}>
                Sin noches a la venta este mes: {datos.deptos.filter((d) => d.revpar == null).map((d) => d.codigo).join(', ')}.
              </Typography.Paragraph>
            )}
          </>
        )}
      </Card>
   ```
5. **Evolución**: en `<Card size="small" title="Evolución mensual">`, reemplazar el `<Typography.Paragraph>` de arriba
   por esto (la `<Table>` de abajo queda **igual**):
   ```tsx
        <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
          <Segmented value={metrica} onChange={setMetrica}
            options={Object.entries(METRICAS).map(([value, m]) => ({ value: value as Metrica, label: m.label }))} />
          {historia && <LineasPorAnio filas={historia} valor={METRICAS[metrica].valor} formato={METRICAS[metrica].formato}
            tope={METRICAS[metrica].tope} />}
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Una línea por año: el último en terracota, el anterior en marrón. Meses cerrados; antes de usar la app solo hay
            noches ocupadas (hoja OCUPACION del Excel). Las noches ocupadas crecen con la cantidad de deptos: para comparar
            años, mirá la ocupación.
            {(metrica === 'adr' || metrica === 'revpar') && ' En pesos de cada mes, sin ajustar por inflación: entre un año y otro, la suba en pesos no es una suba real.'}
          </Typography.Paragraph>
        </Space>
   ```
   (`onChange` de `Segmented` puede quedar tipado como `(v: Metrica) => void` gracias al `as Metrica`; si el typecheck
   se queja, usá `onChange={(v) => setMetrica(v as Metrica)}`.)

**Verificar**: `npm run typecheck` → sin errores; `npm test` → `fail 0`.

### Paso 5: textos del manual y la guía
- `manual/manual.html`, en la lista de la sección del Resumen (líneas ~207-215):
  - Después del `<li>` de **Tarjetas de arriba** … (antes del de **Honorarios ≠ 20 % del bruto**), agregar:
    ```html
    <li><b>Ranking por RevPAR:</b> una barra por depto, de mayor a menor. La línea punteada es la mediana; las barras claras son
      los deptos que quedan por debajo. Pasando el mouse se ve la ocupación, el ADR y las noches de ese depto.</li>
    ```
  - El `<li>` de **Evolución mensual** pasa a:
    ```html
    <li><b>Evolución mensual:</b> un gráfico con los meses de enero a diciembre y una línea por año (el último en terracota, el anterior
      en marrón), para comparar cada mes con el mismo mes del año anterior. Arriba se elige qué ver: noches ocupadas, ocupación, ADR o
      RevPAR. Los meses anteriores a Hornera solo tienen noches ocupadas (vienen de la hoja OCUPACION del Excel). El ADR y el RevPAR
      están en pesos de cada mes, sin ajustar por inflación. Debajo sigue la tabla con los números.</li>
    ```
  - No tocar figuras ni capturas.
- `GUIA-PRUEBAS.md`, sección `## 8. Resumen (fase 6)`: agregar al final de la lista:
  ```
  5. **Ranking por RevPAR**: los deptos de mayor a menor, igual que la tabla Por depto ordenada por RevPAR; la línea
     punteada en el valor de la tarjeta "RevPAR (mediana)".
  6. **Evolución en gráfico**: con *Noches ocupadas*, una línea por año desde 2021; cada punto (pasando el mouse) igual
     al número de la tabla de abajo. Con *Ocupación*, *ADR* y *RevPAR*, solo los meses cerrados en la app.
  ```
**Verificar**: `grep -n "Ranking por RevPAR" manual/manual.html GUIA-PRUEBAS.md` → una línea en cada uno.

### Paso 6: prueba a mano con datos de demo
1. Carpeta temporal `D` (fuera del repo). `node manual/seed.ts D` → crea `D/hornera.db`.
2. Agregar histórico ficticio para ver varios años (los deptos del seed tienen `id` 1, 2, 3…). Guardar esto en un
   archivo temporal fuera del repo, p. ej. `D/historico.mjs`, y correr `node D/historico.mjs D/hornera.db`:
   ```js
   import { DatabaseSync } from 'node:sqlite';
   const db = new DatabaseSync(process.argv[2]);
   const ids = db.prepare('SELECT id FROM depto').all().map((d) => d.id);
   const ins = db.prepare('INSERT OR IGNORE INTO historico_mensual (depto_id, mes, noches_ocupadas) VALUES (?, ?, ?)');
   for (const anio of [2024, 2025, 2026]) for (let m = 1; m <= 12; m++) {
     const mes = `${anio}-${String(m).padStart(2, '0')}`;
     if (mes >= '2026-08') continue; // de agosto 2026 en adelante están los meses del seed
     const temporada = [1, 2, 7, 12].includes(m) ? 24 : 15; // datos ficticios: verano y vacaciones de invierno más altos
     for (const id of ids) ins.run(id, mes, temporada + ((id * 7 + m) % 6));
   }
   ```
3. `npx electron . --user-data-dir=D` → pantalla **Resumen**.
   - El **Ranking por RevPAR** aparece entre las tarjetas y "Por depto", de mayor a menor, con la línea punteada.
   - **Evolución mensual** con *Noches ocupadas*: líneas de 2024, 2025 y 2026 (2026 en terracota, 2025 en marrón,
     2024 clara). Pasar el mouse por un punto: muestra "ene 2025: …".
   - Tocar *Ocupación*: solo los puntos de agosto y septiembre 2026; el eje llega a 100 %.
   - Tocar *ADR*: aparece la frase de inflación.
   - Abrir el panel del asistente (se angosta la pantalla): el gráfico no se rompe (a lo sumo, scroll horizontal).
4. Cerrar la app y borrar la carpeta `D`.

Si en el paso 3 alguna línea sale invertida (valores altos abajo) o los meses corridos uno, PARAR y avisar.

## PARAR si
- `GET /api/resumen/evolucion` o `resumenDelMes` ya no devuelven los campos de "Estado actual": el servidor cambió.
- Hace falta tocar `server/` o agregar una dependencia para que funcione.
- `Segmented` u otro componente de antd no existe con esa API en la versión instalada (mirar `package.json`).

## Hecho cuando
- `npm run typecheck` sin errores y `npm test` con `fail 0`, con los 4 tests de `src/graficos.test.ts`.
- `git diff --stat` muestra solo los archivos de "Alcance" (más `plans/README.md`).
- `git diff package.json` → vacío.
- Prueba a mano del paso 6 hecha.
- Al commitear (skill `commit-version`): es capacidad nueva → **minor** (`0.53.4` → `0.54.0`) y una entrada en
  `ROADMAP.md`.

## Mantenimiento
- Si `evolucion()` suma métricas (p. ej. bruto en dólares), alcanza con agregar una entrada a `METRICAS` en
  `src/Resumen.tsx`.
- ADR y RevPAR en pesos nominales: con la inflación, la comparación entre años en pesos engaña (lo dice el texto).
  `ponytail:` siguiente paso posible = graficarlos en dólares con el tipo de cambio de cada período (el bruto ya lo usa
  para convertir US$), que necesita sumar ese campo a `evolucion()` en el servidor.
- `src/ResumenHornera.tsx` puede reusar `LineasPorAnio` para el resultado mes a mes, con `valor: (m) => m.resultado_ars`.
