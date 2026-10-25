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
      {/* display: contents → los tres hijos van a las tres columnas; el title va en cada uno (en el contenedor no se ve). */}
      {orden.map((f) => (
        <div key={f.clave} style={{ display: 'contents' }}>
          <span title={f.detalle} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.etiqueta}</span>
          <div title={f.detalle} style={{ position: 'relative', height: 16, background: '#F6F2EC', borderRadius: 3 }}>
            {/* Arriba de la mediana en terracota; abajo, en un tono claro: se ve la mitad que rinde menos. */}
            <div style={{ width: `${(100 * Math.max(f.valor, 0)) / max}%`, height: '100%', borderRadius: 3,
              background: mediana != null && f.valor < mediana ? '#E3C2B1' : TERRACOTA }} />
            {mediana != null && <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${(100 * mediana) / max}%`,
              borderLeft: `2px dashed ${MARRON}` }} />}
          </div>
          <span title={f.detalle} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formato(f.valor)}</span>
        </div>
      ))}
    </div>
  );
}
