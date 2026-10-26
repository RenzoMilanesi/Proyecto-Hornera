// Resumen de Hornera misma: resultado del mes por concepto, gastos personales aparte, lo que falta pagar,
// lo disponible, lo facturado por emisor y la evolución. El Resumen de arriba es de deptos y reservas.
import { useEffect, useState } from 'react';
import { Alert, Card, Col, Descriptions, Empty, Row, Select, Space, Statistic, Table, Tag, theme, Typography } from 'antd';
import { mesVisto } from './Asistente.tsx';
import type { evolucion, resumenHornera } from '../server/resumen.ts';
import { get, pesos } from './api.ts';
import { NOMBRES } from './GastosAjenos.tsx';

type Datos = ReturnType<typeof resumenHornera>;
type Mes = ReturnType<typeof evolucion>[number];

const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const chico = { content: { fontSize: 20 } };
const plata = (v: number | null) => (v == null ? '' : pesos(v));
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const subtitulo = (t: string) => <Typography.Text strong style={{ display: 'block', margin: '12px 0 4px' }}>{t}</Typography.Text>;

export function ResumenHornera() {
  const { token } = theme.useToken();
  const rojo = (x: number) => ({ content: { ...chico.content, color: x < 0 ? token.colorError : undefined } });
  const [meses, setMeses] = useState<{ mes: string; estado: string }[]>([]);
  const [mes, setMes] = useState<string>();
  mesVisto.valor = mes ?? ''; // para el asistente
  const [datos, setDatos] = useState<Datos>();
  const [historia, setHistoria] = useState<Mes[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<{ mes: string; estado: string }[]>('periodos').then((p) => {
      setMeses(p);
      const hoy = new Date().toLocaleDateString('sv').slice(0, 7);
      setMes((p.find((x) => x.mes === hoy) ?? p[0])?.mes); // el mes en curso: lo que falta pagar es de ahora
      if (!p.length) setError('No hay meses cargados: importá el Excel de un mes (Herramientas) o traelo de Stays.');
    }, (e) => setError(String(e)));
    get<Mes[]>('resumen/evolucion').then((h) => setHistoria(h.filter((m) => m.resultado_ars != null)), (e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (!mes) return;
    setDatos(undefined);
    get<Datos>(`resumen/hornera?mes=${mes}`).then(setDatos, (e) => setError(String(e)));
  }, [mes]);

  const r = datos?.resultado;
  const p = datos?.pendiente;
  const totalPersonales = datos?.personales.reduce((s, x) => s + x.importe, 0) ?? 0;
  const totalCuentas = (moneda: 'ARS' | 'USD') => datos?.cuentas.filter((c) => c.moneda === moneda).reduce((s, c) => s + c.saldo, 0) ?? 0;

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Space wrap>
        <Select style={{ width: 180 }} value={mes} onChange={setMes} placeholder="Mes"
          options={meses.map((x) => ({ value: x.mes, label: `${x.mes} · ${x.estado}` }))} />
        {datos?.estado === 'abierto' && <Tag color="blue">mes abierto: los números todavía cambian</Tag>}
      </Space>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      {datos?.avisos.length ? <Alert type="warning" showIcon title={datos.avisos.join(' ')} /> : null}

      {/* tarjetas-kpi (index.html): 6, 3 o 2 por fila según el ancho real, que se angosta con el panel del asistente */}
      <div className="tarjetas-kpi"><div>
        <Card size="small"><Statistic title="Resultado del mes" value={r ? pesos(r.total_ars) : '—'} styles={rojo(r?.total_ars ?? 0)} /></Card>
        <Card size="small"><Statistic styles={chico} title="Honorarios" value={r ? pesos(r.honorarios) : '—'} /></Card>
        <Card size="small"><Statistic styles={chico} title="Ingresos − gastos empresa" value={r ? pesos(r.empresa.ars) : '—'} /></Card>
        <Card size="small"><Statistic title="Disponible $" value={datos ? pesos(datos.disponible.ars) : '—'} styles={rojo(datos?.disponible.ars ?? 0)} /></Card>
        <Card size="small"><Statistic title="Disponible US$" value={datos ? pesos(datos.disponible.usd, 'USD') : '—'} styles={rojo(datos?.disponible.usd ?? 0)} /></Card>
        <Card size="small"><Statistic styles={chico} title="Gastos personales" value={datos ? pesos(totalPersonales) : '—'} /></Card>
      </div></div>

      <Row gutter={16}>
        <Col span={14}>
          <Card size="small" title="Resultado del mes">
            {r && (
              <>
                <Descriptions size="small" column={1} items={[
                  { label: 'Honorarios', children: pesos(r.honorarios) },
                  { label: 'Costos operativos cobrados', children: pesos(r.costos_operativos) },
                  { label: 'Ingresos y gastos de la empresa', children: <>{pesos(r.empresa.ars)}{r.empresa.usd ? ` · ${pesos(r.empresa.usd, 'USD')}` : ''}</> },
                  { label: <b>Resultado en pesos</b>, children: <b>{pesos(r.total_ars)}</b> },
                ]} />
                {subtitulo('Ingresos y gastos de la empresa, por concepto')}
                <Table rowKey="concepto" size="small" pagination={false} dataSource={datos.conceptos} columns={[
                  { title: 'Concepto', dataIndex: 'concepto' },
                  { title: 'Pesos', dataIndex: 'ars', ...derecha, render: (v: number) => (v ? pesos(v) : '') },
                  { title: 'Dólares', dataIndex: 'usd', ...derecha, render: (v: number) => (v ? pesos(v, 'USD') : '') },
                ]} />
              </>
            )}
          </Card>
        </Col>
        <Col span={10}>
          <Card size="small" title="Gastos personales del mes">
            <Typography.Paragraph type="secondary">No son de Hornera: no se restan del resultado.</Typography.Paragraph>
            <Table rowKey="codigo" size="small" pagination={false} dataSource={datos?.personales} columns={[
              { title: 'De', dataIndex: 'codigo', render: (c: string) => NOMBRES[c] ?? c },
              { title: 'Importe', dataIndex: 'importe', ...derecha, render: (v: number) => pesos(v) },
            ]} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={14}>
          <Card size="small" title="Lo que falta pagar">
            {p && (
              <>
                {subtitulo(`Vencimientos de ${datos.mes}`)}
                {p.vencimientos.length ? (
                  <Table rowKey="servicio_id" size="small" pagination={false} dataSource={p.vencimientos} columns={[
                    { title: 'Vence', dataIndex: 'vence', width: 70, render: ddmm },
                    { title: 'Depto', dataIndex: 'codigo', width: 70 },
                    { title: 'Qué', dataIndex: 'concepto' },
                    { title: '', dataIndex: 'estado', width: 90, render: (e: string) => (e === 'vencido' ? <Tag color="red">vencido</Tag> : null) },
                  ]} />
                ) : <Typography.Text type="secondary">Nada pendiente.</Typography.Text>}
                {subtitulo('Limpieza sin pagar')}
                {p.limpieza.length ? (
                  <Table rowKey="id" size="small" pagination={false} dataSource={p.limpieza} columns={[
                    { title: 'Período', key: 'periodo', render: (_, l) => `${ddmm(l.desde)} – ${ddmm(l.hasta)}` },
                    { title: 'Importe', dataIndex: 'total', ...derecha, render: (v: number) => pesos(v) },
                  ]} />
                ) : <Typography.Text type="secondary">Nada pendiente.</Typography.Text>}
                {subtitulo(`A propietarios${p.mes_propietarios ? ` (${p.mes_propietarios})` : ''}`)}
                {p.propietarios.length ? (
                  <Table rowKey="codigo" size="small" pagination={false} dataSource={p.propietarios} columns={[
                    { title: 'Depto', dataIndex: 'codigo', width: 70 },
                    { title: 'Propietario', dataIndex: 'propietario' },
                    { title: 'Falta pagar', dataIndex: 'pendiente', ...derecha, render: (v: number, x) => pesos(v, x.moneda) },
                  ]} />
                ) : <Typography.Text type="secondary">Nada pendiente.</Typography.Text>}
              </>
            )}
          </Card>
        </Col>
        <Col span={10}>
          <Card size="small" title="Saldos de cuentas (hoy)">
            <Table rowKey="nombre" size="small" pagination={false} dataSource={datos?.cuentas} columns={[
              { title: 'Cuenta', dataIndex: 'nombre' },
              { title: 'Saldo', dataIndex: 'saldo', ...derecha, render: (v: number, c) => <Typography.Text type={v < 0 ? 'danger' : undefined}>{pesos(v, c.moneda)}</Typography.Text> },
            ]} summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><b>Total</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right"><b>{pesos(totalCuentas('ARS'))} · {pesos(totalCuentas('USD'), 'USD')}</b></Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              Disponible = saldos − limpieza sin pagar − lo que falta pagar a propietarios. Los vencimientos no tienen importe cargado.
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Facturado por emisor">
        <Typography.Paragraph type="secondary">
          Lo emitido desde la app y lo importado de Mis Comprobantes, sin contar dos veces; las notas de crédito restan.
          Los 12 meses son hasta el mes elegido: es lo que mira el tope del monotributo.
        </Typography.Paragraph>
        {datos?.facturado.length === 0 ? <Empty description="Sin facturas en los últimos 12 meses" /> : (
          <Table rowKey="emisor" size="small" pagination={false} loading={!datos && !error} dataSource={datos?.facturado} columns={[
            { title: 'Emisor', dataIndex: 'emisor' },
            { title: `En ${mes ?? 'el mes'}`, dataIndex: 'mes', ...derecha, render: (v: number) => pesos(v) },
            { title: 'Últimos 12 meses', dataIndex: 'doce', ...derecha, render: (v: number) => pesos(v) },
          ]} />
        )}
      </Card>

      <Card size="small" title="Evolución mensual">
        <Typography.Paragraph type="secondary">Meses cerrados.</Typography.Paragraph>
        <Table<Mes> rowKey="mes" size="small" pagination={false} loading={!historia && !error} scroll={{ x: 'max-content', y: 480 }}
          dataSource={historia ? [...historia].reverse() : undefined} columns={[
            { title: 'Mes', dataIndex: 'mes', width: 90 },
            { title: 'Honorarios', dataIndex: 'honorarios', ...derecha, render: plata },
            { title: 'Costos operativos', dataIndex: 'costos_operativos', ...derecha, render: plata },
            { title: 'Ingresos − gastos empresa', dataIndex: 'empresa_ars', ...derecha, render: plata },
            { title: 'Resultado', dataIndex: 'resultado_ars', ...derecha, render: (v: number | null) => (v == null ? '' : <b>{pesos(v)}</b>) },
            { title: 'Gastos personales', dataIndex: 'personales', ...derecha, render: plata },
          ]} />
      </Card>
    </Space>
  );
}
