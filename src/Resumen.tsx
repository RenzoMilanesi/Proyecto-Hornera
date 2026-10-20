// Resumen interno (fase 6): KPIs del mes por depto, resultado de Hornera, saldos de cuentas y evolución.
import { useEffect, useState } from 'react';
import { Alert, Card, Col, Descriptions, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { KpiDepto, resumenDelMes } from '../server/resumen.ts';
import { get, pesos } from './api.ts';

type Resumen = ReturnType<typeof resumenDelMes>;
interface Cuenta { nombre: string; moneda: 'ARS' | 'USD'; saldo: number }
interface Mes { mes: string; noches_disponibles: number | null; noches_ocupadas: number | null; reservas: number | null; bruto: number | null; honorarios: number | null; resultado_ars: number | null }

const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const pct = (ocupadas: number, disponibles: number) => (disponibles ? `${Math.round((100 * ocupadas) / disponibles)} %` : '');
const porNoche = (bruto: number, noches: number) => (noches ? pesos(Math.round(bruto / noches)) : '');

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
        <Col span={5}><Card size="small"><Statistic title="Ocupación" value={t ? pct(t.noches_ocupadas, t.noches_disponibles) : '—'} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="Noches ocupadas" value={t?.noches_ocupadas ?? '—'} suffix={t ? `/ ${t.noches_disponibles}` : undefined} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Reservas" value={t?.reservas ?? '—'} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="Bruto" value={t ? pesos(t.bruto) : '—'} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="Resultado Hornera" value={r ? pesos(r.total_ars) : '—'}
          styles={{ content: { color: r && r.total_ars < 0 ? '#B42318' : undefined } }} /></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title="Resultado de Hornera">
            {r && (
              <Descriptions size="small" column={1} items={[
                { label: 'Honorarios', children: pesos(r.honorarios) },
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
        <Table<KpiDepto> rowKey="codigo" size="small" pagination={false} loading={!datos && !error} dataSource={datos?.deptos} columns={[
          { title: 'Depto', dataIndex: 'codigo', width: 80, sorter: (a, b) => a.codigo.localeCompare(b.codigo) },
          { title: 'Nombre', dataIndex: 'nombre' },
          { title: 'Ocupación', key: 'ocupacion', ...derecha, render: (_, d) => pct(d.noches_ocupadas, d.noches_disponibles),
            sorter: (a, b) => a.noches_ocupadas / (a.noches_disponibles || 1) - b.noches_ocupadas / (b.noches_disponibles || 1) },
          { title: 'Noches', key: 'noches', ...derecha, render: (_, d) => `${d.noches_ocupadas} / ${d.noches_disponibles}` },
          { title: 'Reservas', dataIndex: 'reservas', ...derecha, sorter: (a, b) => a.reservas - b.reservas },
          { title: 'Bruto', dataIndex: 'bruto', ...derecha, render: (v: number) => pesos(v), sorter: (a, b) => a.bruto - b.bruto },
          { title: 'Por noche', key: 'adr', ...derecha, render: (_, d) => porNoche(d.bruto, d.noches_ocupadas) },
          { title: 'Honorarios', dataIndex: 'honorarios', ...derecha, render: (v: number) => pesos(v), sorter: (a, b) => a.honorarios - b.honorarios, defaultSortOrder: 'descend' },
        ]} />
      </Card>

      <Card size="small" title="Evolución mensual">
        <Typography.Paragraph type="secondary">
          Meses cerrados. Antes de usar la app solo hay noches ocupadas (hoja OCUPACION del Excel).
        </Typography.Paragraph>
        <Table<Mes> rowKey="mes" size="small" pagination={false} loading={!historia && !error} scroll={{ y: 480 }}
          dataSource={historia ? [...historia].reverse() : undefined} columns={[
            { title: 'Mes', dataIndex: 'mes', width: 90 },
            { title: 'Noches ocupadas', dataIndex: 'noches_ocupadas', width: 130, ...derecha },
            { title: 'Ocupación', key: 'ocupacion', ...derecha, render: (_, m) => (m.noches_disponibles ? pct(m.noches_ocupadas ?? 0, m.noches_disponibles) : '') },
            { title: 'Bruto', dataIndex: 'bruto', ...derecha, render: (v: number | null) => (v == null ? '' : pesos(v)) },
            { title: 'Honorarios', dataIndex: 'honorarios', ...derecha, render: (v: number | null) => (v == null ? '' : pesos(v)) },
            { title: 'Resultado', dataIndex: 'resultado_ars', ...derecha, render: (v: number | null) => (v == null ? '' : pesos(v)) },
          ]} />
      </Card>
    </Space>
  );
}
