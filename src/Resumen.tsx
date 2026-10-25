// Resumen interno (fase 6): KPIs del mes por depto y evolución. Lo de Hornera misma está en ResumenHornera.tsx.
import { useEffect, useState } from 'react';
import { Alert, Card, Segmented, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { mesVisto } from './Asistente.tsx';
import { LineasPorAnio, Ranking } from './Graficos.tsx';
import type { elasticidadDelMes, evolucion, resumenDelMes } from '../server/resumen.ts';
import { get, pesos } from './api.ts';

type Resumen = ReturnType<typeof resumenDelMes> & { elasticidad: ReturnType<typeof elasticidadDelMes> };
type KpiDepto = Resumen['deptos'][number];
type Mes = ReturnType<typeof evolucion>[number];

const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const pct = (x: number | null) => (x == null ? '' : `${Math.round(100 * x)} %`);
const chico = { content: { fontSize: 20 } }; // seis tarjetas: la plata entra en un renglón
const coef = (x: number | null | undefined) => (x == null ? '' : x.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const plata = (x: number | null) => (x == null ? '' : pesos(x));
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
// Título de tarjeta con un ⓘ que explica la cuenta al pasar el mouse.
const ayuda = (titulo: string, texto: string) => (
  <Tooltip title={texto}><span style={{ cursor: 'help' }}>{titulo} <sup>ⓘ</sup></span></Tooltip>
);
// Para ordenar: los null (sin noches) al final.
const orden = (k: 'ocupacion' | 'adr' | 'revpar' | 'neto_noche') => (a: KpiDepto, b: KpiDepto) => (a[k] ?? -1) - (b[k] ?? -1);

export function Resumen() {
  const [meses, setMeses] = useState<{ mes: string; estado: string }[]>([]);
  const [mes, setMes] = useState<string>();
  mesVisto.valor = mes ?? ''; // para el asistente
  const [datos, setDatos] = useState<Resumen>();
  const [historia, setHistoria] = useState<Mes[]>();
  const [metrica, setMetrica] = useState<Metrica>('noches');
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<{ mes: string; estado: string }[]>('periodos').then((p) => {
      setMeses(p);
      setMes((p.find((x) => x.estado === 'cerrado') ?? p[0])?.mes); // el último cerrado: números firmes
      if (!p.length) setError('No hay meses cargados: importá el Excel de un mes (Herramientas) o traelo de Stays.');
    }, (e) => setError(String(e)));
    get<Mes[]>('resumen/evolucion').then(setHistoria, (e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (!mes) return;
    setDatos(undefined);
    get<Resumen>(`resumen?mes=${mes}`).then(setDatos, (e) => setError(String(e)));
  }, [mes]);

  const t = datos?.totales;
  const r = datos?.resultado;
  const el = datos?.elasticidad;

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Space wrap>
        <Select style={{ width: 180 }} value={mes} onChange={setMes} placeholder="Mes"
          options={meses.map((p) => ({ value: p.mes, label: `${p.mes} · ${p.estado}` }))} />
        {datos?.estado === 'abierto' && <Tag color="blue">mes abierto: los números todavía cambian</Tag>}
      </Space>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      {datos?.avisos.length ? <Alert type="warning" showIcon title={datos.avisos.join(' ')} /> : null}

      {/* tarjetas-kpi (index.html): 6, 3 o 2 por fila según el ancho real, que se angosta con el panel del asistente */}
      <div className="tarjetas-kpi"><div>
        <Card size="small"><Statistic styles={chico} title="Ocupación" value={t ? pct(t.ocupacion) || '—' : '—'} /></Card>
        <Card size="small"><Statistic styles={chico} title="Noches vendidas" value={t?.noches_vendidas ?? '—'} suffix={t ? `/ ${t.noches_venta}` : undefined} /></Card>
        <Card size="small"><Statistic styles={chico} value={t ? plata(t.adr) || '—' : '—'} title={ayuda('ADR (tarifa por noche)',
          'Tarifa promedio por noche vendida, de toda la cartera: lo que pagaron los huéspedes por las noches (sin la tarifa por estadía) ÷ noches vendidas. Las estadías del propietario no cuentan.')} /></Card>
        <Card size="small"><Statistic styles={chico} value={t ? plata(t.revpar_mediana) || '—' : '—'} title={ayuda('RevPAR (mediana)',
          'Ingreso por noche a la venta: lo que pagaron los huéspedes por las noches ÷ noches a la venta (las del mes menos las bloqueadas y las del propietario). Es ADR × ocupación. Se calcula por depto y se muestra la mediana, así un depto muy grande o muy chico no la mueve.')} /></Card>
        <Card size="small"><Statistic styles={chico} title="Bruto" value={t ? pesos(t.bruto) : '—'} /></Card>
        <Card size="small"><Statistic styles={chico} title={ayuda('Honorarios',
          'Lo que cobra Hornera: la comisión de cada depto (hoy 20 %) sobre la base de honorarios = bruto − costos operativos (tarifa por estadía) − comisiones de plataformas y del channel manager. Se calcula por depto y se redondea hacia abajo a la centena de pesos. Un depto sin ingresos que paga el fee del channel manager da honorarios negativos. El % es sobre el bruto.')} value={r ? pesos(r.honorarios) : '—'}
          suffix={t?.honorario_efectivo != null && <Typography.Text type="secondary" style={{ fontSize: 13, marginLeft: 6 }}>{(100 * t.honorario_efectivo).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %</Typography.Text>} /></Card>
      </div></div>

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

      <Card size="small" title="Por depto">
        <Typography.Paragraph type="secondary">
          Noches vendidas / a la venta: sin bloqueos ni estadías del propietario. ADR: lo que pagaron los huéspedes por noche vendida,
          sin la tarifa por estadía. RevPAR: lo mismo por noche a la venta (ADR × ocupación); es el número para comparar deptos.
          Neto por noche: lo que le queda al propietario (valor liquidación inicial) por noche vendida.
        </Typography.Paragraph>
        <Table<KpiDepto> rowKey="codigo" size="small" pagination={false} scroll={{ x: 'max-content' }} loading={!datos && !error} dataSource={datos?.deptos} columns={[
          { title: 'Depto', dataIndex: 'codigo', width: 80, sorter: (a, b) => a.codigo.localeCompare(b.codigo) },
          { title: 'Nombre', dataIndex: 'nombre' },
          { title: 'Ocupación', dataIndex: 'ocupacion', ...derecha, render: pct, sorter: orden('ocupacion') },
          { title: 'Noches', key: 'noches', ...derecha, render: (_, d) => `${d.noches_vendidas} / ${d.noches_venta}` },
          { title: 'Reservas', dataIndex: 'reservas', ...derecha, sorter: (a, b) => a.reservas - b.reservas },
          { title: 'Bruto', dataIndex: 'bruto', ...derecha, render: (v: number) => pesos(v), sorter: (a, b) => a.bruto - b.bruto },
          { title: 'ADR', dataIndex: 'adr', ...derecha, render: plata, sorter: orden('adr') },
          { title: 'RevPAR', dataIndex: 'revpar', ...derecha, render: plata, sorter: orden('revpar'), defaultSortOrder: 'descend' },
          { title: 'Neto por noche', dataIndex: 'neto_noche', ...derecha, render: plata, sorter: orden('neto_noche') },
          { title: 'Honorarios', dataIndex: 'honorarios', ...derecha, render: (v: number) => pesos(v), sorter: (a, b) => a.honorarios - b.honorarios },
          { title: 'Elasticidad', key: 'elasticidad', ...derecha, render: (_, d) => coef(el?.deptos[d.codigo]) },
        ]} />
      </Card>

      <Card size="small" title="Elasticidad precio (indicativa)">
        {el && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Space size="large" wrap>
              <Statistic styles={chico} title="Mediana de los deptos" value={el.mediana == null ? '—' : coef(el.mediana)} />
              <Statistic styles={chico} title="Deptos con dato" value={el.validos} />
              <Statistic styles={chico} title="Compara contra" value={el.base ?? '—'} suffix={el.tipo === 'anual' ? '(un año antes)' : el.tipo === 'mensual' ? '(mes anterior)' : undefined} />
              <Statistic styles={chico} title="Confianza" value={el.confianza} />
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Cuánto cambia la ocupación cuando cambia el ADR: −1,2 = si el ADR sube 10 %, la ocupación baja 12 %.
              Entre 0 y −1, subir el precio aumenta el ingreso; por debajo de −1, lo baja.
            </Typography.Paragraph>
            <Alert type="warning" showIcon title="Antes de usar este número" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{el.avisos.map((a) => <li key={a}>{a}</li>)}</ul>} />
          </Space>
        )}
      </Card>

      <Card size="small" title="Evolución mensual">
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
        <Table<Mes> rowKey="mes" size="small" pagination={false} loading={!historia && !error} scroll={{ x: 'max-content', y: 480 }}
          dataSource={historia ? [...historia].reverse() : undefined} columns={[
            { title: 'Mes', dataIndex: 'mes', width: 90 },
            { title: 'Noches ocupadas', dataIndex: 'noches_ocupadas', width: 130, ...derecha },
            { title: 'Ocupación', dataIndex: 'ocupacion', ...derecha, render: pct },
            { title: 'ADR', dataIndex: 'adr', ...derecha, render: plata },
            { title: 'RevPAR', dataIndex: 'revpar', ...derecha, render: plata },
            { title: 'Bruto', dataIndex: 'bruto', ...derecha, render: (v: number | null) => (v == null ? '' : pesos(v)) },
          ]} />
      </Card>
    </Space>
  );
}
