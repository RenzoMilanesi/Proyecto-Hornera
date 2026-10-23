// Resumen interno (fase 6): KPIs del mes por depto, resultado de Hornera, saldos de cuentas y evolución.
import { useEffect, useState } from 'react';
import { Alert, Card, Col, Descriptions, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import type { elasticidadDelMes, evolucion, resumenDelMes } from '../server/resumen.ts';
import { get, pesos } from './api.ts';

type Resumen = ReturnType<typeof resumenDelMes> & { elasticidad: ReturnType<typeof elasticidadDelMes> };
type KpiDepto = Resumen['deptos'][number];
interface Cuenta { nombre: string; moneda: 'ARS' | 'USD'; saldo: number }
type Mes = ReturnType<typeof evolucion>[number];

const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const pct = (x: number | null) => (x == null ? '' : `${Math.round(100 * x)} %`);
const chico = { content: { fontSize: 20 } }; // seis tarjetas: la plata entra en un renglón
const coef = (x: number | null | undefined) => (x == null ? '' : x.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const plata = (x: number | null) => (x == null ? '' : pesos(x));
// Título de tarjeta con un ⓘ que explica la cuenta al pasar el mouse.
const ayuda = (titulo: string, texto: string) => (
  <Tooltip title={texto}><span style={{ cursor: 'help' }}>{titulo} <sup>ⓘ</sup></span></Tooltip>
);
// Para ordenar: los null (sin noches) al final.
const orden = (k: 'ocupacion' | 'adr' | 'revpar' | 'neto_noche') => (a: KpiDepto, b: KpiDepto) => (a[k] ?? -1) - (b[k] ?? -1);

export function Resumen() {
  const [meses, setMeses] = useState<{ mes: string; estado: string }[]>([]);
  const [mes, setMes] = useState<string>();
  const [datos, setDatos] = useState<Resumen>();
  const [historia, setHistoria] = useState<Mes[]>();
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
  const totalCuentas = (moneda: 'ARS' | 'USD') => (datos?.cuentas as Cuenta[] | undefined)?.filter((c) => c.moneda === moneda).reduce((s, c) => s + c.saldo, 0) ?? 0;

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Space wrap>
        <Select style={{ width: 180 }} value={mes} onChange={setMes} placeholder="Mes"
          options={meses.map((p) => ({ value: p.mes, label: `${p.mes} · ${p.estado}` }))} />
        {datos?.estado === 'abierto' && <Tag color="blue">mes abierto: los números todavía cambian</Tag>}
      </Space>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      {datos?.avisos.length ? <Alert type="warning" showIcon title={datos.avisos.join(' ')} /> : null}

      <Row gutter={16}>
        <Col span={4}><Card size="small"><Statistic styles={chico} title="Ocupación" value={t ? pct(t.ocupacion) || '—' : '—'} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic styles={chico} title="Noches vendidas" value={t?.noches_vendidas ?? '—'} suffix={t ? `/ ${t.noches_venta}` : undefined} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic styles={chico} value={t ? plata(t.adr) || '—' : '—'} title={ayuda('ADR (tarifa por noche)',
          'Tarifa promedio por noche vendida, de toda la cartera: lo que pagaron los huéspedes por las noches (sin la tarifa por estadía) ÷ noches vendidas. Las estadías del propietario no cuentan.')} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic styles={chico} value={t ? plata(t.revpar_mediana) || '—' : '—'} title={ayuda('RevPAR (mediana)',
          'Ingreso por noche a la venta: lo que pagaron los huéspedes por las noches ÷ noches a la venta (las del mes menos las bloqueadas y las del propietario). Es ADR × ocupación. Se calcula por depto y se muestra la mediana, así un depto muy grande o muy chico no la mueve.')} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic styles={chico} title="Bruto" value={t ? pesos(t.bruto) : '—'} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Resultado Hornera" value={r ? pesos(r.total_ars) : '—'}
          styles={{ content: { ...chico.content, color: r && r.total_ars < 0 ? '#B42318' : undefined } }} /></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title="Resultado de Hornera">
            {r && (
              <Descriptions size="small" column={1} items={[
                { label: 'Honorarios', children: <>{pesos(r.honorarios)}{t?.honorario_efectivo != null && <Typography.Text type="secondary"> · {(100 * t.honorario_efectivo).toLocaleString('es-AR', { maximumFractionDigits: 1 })} % del bruto</Typography.Text>}</> },
                { label: 'Costos operativos cobrados', children: pesos(r.costos_operativos) },
                { label: 'Ingresos y gastos de la empresa (INT)', children: <>{pesos(r.empresa.ars)}{r.empresa.usd ? ` · ${pesos(r.empresa.usd, 'USD')}` : ''}</> },
                { label: <b>Resultado en pesos</b>, children: <b>{pesos(r.total_ars)}</b> },
              ]} />
            )}
            <Typography.Text type="secondary">Los movimientos de la empresa en dólares se muestran aparte.</Typography.Text>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="Saldos de cuentas (hoy)">
            <Table<Cuenta> rowKey="nombre" size="small" pagination={false} dataSource={datos?.cuentas as Cuenta[] | undefined} columns={[
              { title: 'Cuenta', dataIndex: 'nombre' },
              { title: 'Saldo', dataIndex: 'saldo', ...derecha, render: (v: number, c) => <Typography.Text type={v < 0 ? 'danger' : undefined}>{pesos(v, c.moneda)}</Typography.Text> },
            ]} summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><b>Total</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right"><b>{pesos(totalCuentas('ARS'))} · {pesos(totalCuentas('USD'), 'USD')}</b></Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Por depto">
        <Typography.Paragraph type="secondary">
          Noches vendidas / a la venta: sin bloqueos ni estadías del propietario. ADR: lo que pagaron los huéspedes por noche vendida,
          sin la tarifa por estadía. RevPAR: lo mismo por noche a la venta (ADR × ocupación); es el número para comparar deptos.
          Neto por noche: lo que le queda al propietario (valor liquidación inicial) por noche vendida.
        </Typography.Paragraph>
        <Table<KpiDepto> rowKey="codigo" size="small" pagination={false} loading={!datos && !error} dataSource={datos?.deptos} columns={[
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
        <Typography.Paragraph type="secondary">
          Meses cerrados. Antes de usar la app solo hay noches ocupadas (hoja OCUPACION del Excel).
        </Typography.Paragraph>
        <Table<Mes> rowKey="mes" size="small" pagination={false} loading={!historia && !error} scroll={{ y: 480 }}
          dataSource={historia ? [...historia].reverse() : undefined} columns={[
            { title: 'Mes', dataIndex: 'mes', width: 90 },
            { title: 'Noches ocupadas', dataIndex: 'noches_ocupadas', width: 130, ...derecha },
            { title: 'Ocupación', dataIndex: 'ocupacion', ...derecha, render: pct },
            { title: 'ADR', dataIndex: 'adr', ...derecha, render: plata },
            { title: 'RevPAR', dataIndex: 'revpar', ...derecha, render: plata },
            { title: 'Bruto', dataIndex: 'bruto', ...derecha, render: (v: number | null) => (v == null ? '' : pesos(v)) },
            { title: 'Honorarios', dataIndex: 'honorarios', ...derecha, render: (v: number | null) => (v == null ? '' : pesos(v)) },
            { title: 'Resultado', dataIndex: 'resultado_ars', ...derecha, render: (v: number | null) => (v == null ? '' : pesos(v)) },
          ]} />
      </Card>
    </Space>
  );
}
