import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import type { LiquidacionDepto, LiquidacionPeriodo } from '../server/liquidacion/servicio.ts';
import type { ComparacionDepto } from '../server/liquidacion/comparar.ts';
import { enviar, get, pesos, subirArchivo } from './api.ts';

interface Periodo { mes: string; estado: string; usd_cotizacion: number | null; usd_descuento_pct: number }

const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const ars = (c: number) => (c ? pesos(c) : '');
const usd = (c: number) => (c ? pesos(c, 'USD') : '');

function Comparacion({ c }: { c?: ComparacionDepto }) {
  if (!c) return null;
  if (c.estado === 'igual') return <Tag color="green">igual al Excel</Tag>;
  if (c.estado === 'solo_excel') return <Tag color="orange">solo en el Excel</Tag>;
  if (c.estado === 'solo_app') return <Tag color="orange">no está en el Excel</Tag>;
  return <Tag color="red">{c.diferencias.length} diferencia{c.diferencias.length > 1 ? 's' : ''}</Tag>;
}

function Detalle({ d, comparacion }: { d: LiquidacionDepto; comparacion?: ComparacionDepto }) {
  const r = d.resultado;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {comparacion?.estado === 'distinto' && (
        <Alert type="error" showIcon title="Diferencias con el Excel" description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>{comparacion.diferencias.map((x, i) => (
            <li key={i}>{x.campo}{x.unidad === 'noches' ? '' : ` ${x.unidad}`}: app {x.unidad === 'noches' ? x.app : pesos(x.app, x.unidad)} · Excel {x.unidad === 'noches' ? x.excel : pesos(x.excel, x.unidad)}</li>
          ))}</ul>} />
      )}
      <Descriptions size="small" bordered column={3} items={[
        { label: 'Saldo anterior', children: <>{ars(d.saldoAnterior.ars)} {usd(d.saldoAnterior.usd)}</> },
        { label: 'Costos operativos', children: pesos(-r.costosOperativos) },
        { label: 'Comisiones', children: <>{ars(-d.comisiones.ars)} {usd(-d.comisiones.usd)}</> },
        { label: 'Gastos directos', children: pesos(r.gastosDirectos) },
        { label: 'Saldo parcial', children: pesos(r.saldoParcial) },
        { label: 'Cambio de moneda', children: <>{ars(r.conversion.ars)} {usd(r.conversion.usd)}</> },
      ]} />
      <Table size="small" pagination={false} rowKey="codigoInterno" dataSource={r.reservas} columns={[
        { title: 'Reserva', dataIndex: 'codigoInterno', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
        { title: 'Noches (período / total)', key: 'n', render: (_: unknown, l) => `${l.nochesPeriodo} / ${l.nochesTotales}` },
        { title: 'Cobrado ARS', dataIndex: 'importePeriodoArs', ...derecha, render: ars },
        { title: 'Cobrado USD', dataIndex: 'importePeriodoUsd', ...derecha, render: usd },
        { title: 'Tarifa', dataIndex: 'tarifaPeriodo', ...derecha, render: ars },
      ]} />
    </Space>
  );
}

export function Liquidacion() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [mes, setMes] = useState<string>();
  const [datos, setDatos] = useState<LiquidacionPeriodo>();
  const [error, setError] = useState<string>();
  const [cotizacion, setCotizacion] = useState<number | null>(null);
  const [comparacion, setComparacion] = useState<Map<string, ComparacionDepto>>();
  const [comparando, setComparando] = useState(false);
  const [texto, setTexto] = useState('');

  const cargarPeriodos = () => get<Periodo[]>('periodos').then((ps) => {
    setPeriodos(ps);
    setMes((m) => m ?? (ps.find((p) => p.estado === 'abierto') ?? ps[0])?.mes);
  });
  useEffect(() => { cargarPeriodos().catch((e) => setError(String(e))); }, []);

  const calcular = (m: string) => {
    setError(undefined);
    setComparacion(undefined); // una comparación vieja no vale para el cálculo nuevo
    get<LiquidacionPeriodo>(`liquidacion?mes=${m}`).then((d) => { setDatos(d); setCotizacion(d.cotizacion); }, (e) => setError(String(e)));
  };
  useEffect(() => { if (mes) calcular(mes); }, [mes]);

  const periodo = periodos.find((p) => p.mes === mes);
  const guardarCotizacion = async () => {
    if (!mes || !cotizacion) return;
    try {
      await enviar(`periodos/${mes}/cotizacion`, 'PUT', { cotizacion });
      await cargarPeriodos();
      calcular(mes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [ocupado, setOcupado] = useState<string>(); // acción en curso: 'cerrar', 'reabrir', 'pdf', 'pdf:OVL'…
  const [aviso, setAviso] = useState<string>();
  const accion = async (cual: string, fn: () => Promise<unknown>, exito?: string) => {
    setOcupado(cual);
    setError(undefined);
    setAviso(undefined);
    try {
      await fn();
      if (exito) setAviso(exito);
      await cargarPeriodos();
      if (mes) calcular(mes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(undefined);
    }
  };
  const pdf = (depto?: string) => accion(depto ? `pdf:${depto}` : 'pdf', async () => {
    const r = await enviar<{ carpeta: string; archivos: string[]; en_servidor: boolean }>('liquidacion/pdf', 'POST', { mes, depto });
    setAviso(`${r.archivos.length === 1 ? 'PDF guardado' : `${r.archivos.length} PDF guardados`} en ${r.carpeta}${r.en_servidor ? ' de la PC servidor' : ''}`);
  });

  const comparar = async (archivo: File) => {
    setComparando(true);
    setError(undefined);
    try {
      const r = await subirArchivo<{ deptos: ComparacionDepto[] }>(`liquidacion/comparar?mes=${mes}`, archivo);
      setComparacion(new Map(r.deptos.map((d) => [d.codigo, d])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComparando(false);
    }
  };

  const columnas: TableColumnsType<LiquidacionDepto> = [
    { title: 'Depto', dataIndex: 'codigo', width: 80, render: (v: string) => <b>{v}</b>, sorter: (a, b) => a.codigo.localeCompare(b.codigo) },
    { title: 'Propietario', dataIndex: 'propietario', ellipsis: true, sorter: (a, b) => a.propietario.localeCompare(b.propietario) },
    { title: 'Noches', key: 'noches', width: 90, render: (_: unknown, d) => `${d.resultado.nochesOcupadas} / ${d.resultado.nochesDisponibles}` },
    { title: 'Bruto', key: 'bruto', ...derecha, render: (_: unknown, d) => pesos(d.resultado.bruto) },
    { title: 'Honorarios', key: 'hon', ...derecha, render: (_: unknown, d) => pesos(d.resultado.honorarios) },
    {
      title: 'Saldo', key: 'saldo', ...derecha,
      render: (_: unknown, d) => {
        const valor = d.moneda === 'USD' ? d.resultado.saldo.usd : d.resultado.saldo.ars;
        return <Typography.Text type={valor < 0 ? 'danger' : undefined} strong>{pesos(valor, d.moneda)}</Typography.Text>;
      },
    },
    ...(comparacion ? [{ title: 'Excel', key: 'excel', width: 150, render: (_: unknown, d: LiquidacionDepto) => <Comparacion c={comparacion.get(d.codigo)} /> }] : []),
    {
      title: '', key: 'pdf', width: 70,
      render: (_: unknown, d: LiquidacionDepto) => (
        <Button size="small" loading={ocupado === `pdf:${d.codigo}`} disabled={!!ocupado} onClick={() => pdf(d.codigo)}
          title={periodo?.estado === 'abierto' ? 'Vista previa: el mes todavía está abierto' : undefined}>PDF</Button>
      ),
    },
  ];
  const t = texto.trim().toLowerCase();
  const visibles = (datos?.deptos ?? []).filter((d) => !t || d.codigo.toLowerCase().includes(t) || d.propietario.toLowerCase().includes(t));
  const suma = (f: (d: LiquidacionDepto) => number) => visibles.reduce((s, d) => s + f(d), 0);
  // Saldos a favor de los propietarios; lo que falta transferir (descontando pagos) está en Transferencias.
  const saldos = (m: 'ARS' | 'USD') => suma((d) => (d.moneda === m ? Math.max(0, m === 'USD' ? d.resultado.saldo.usd : d.resultado.saldo.ars) : 0));
  const resumen = comparacion && [...comparacion.values()].reduce((s, c) => ({ ...s, [c.estado]: (s[c.estado] ?? 0) + 1 }), {} as Record<string, number>);
  const soloExcel = comparacion && [...comparacion.values()].filter((c) => c.estado === 'solo_excel').map((c) => c.codigo);

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Select style={{ width: 160 }} value={mes} onChange={setMes} placeholder="Mes"
            options={periodos.map((p) => ({ value: p.mes, label: `${p.mes} · ${p.estado}` }))} />
          {periodo && <Tag color={periodo.estado === 'abierto' ? 'blue' : 'green'}>{periodo.estado === 'abierto' ? 'abierto: los números todavía cambian' : 'cerrado'}</Tag>}
          <Space>
            <span>Dólar cripto al cierre</span>
            <InputNumber min={1} value={cotizacion} onChange={setCotizacion} disabled={periodo?.estado !== 'abierto'} style={{ width: 120 }} />
            {periodo?.estado === 'abierto' && <Button onClick={guardarCotizacion} disabled={!cotizacion || cotizacion === datos?.cotizacion}>Guardar</Button>}
            {datos?.cambio != null && <Typography.Text type="secondary">cambio: {datos.cambio.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</Typography.Text>}
          </Space>
          <Upload accept=".xlsx" showUploadList={false} disabled={!datos?.cambio || comparando}
            beforeUpload={(archivo) => { comparar(archivo); return false; }}>
            <Button loading={comparando} disabled={!datos?.cambio}>Comparar con el Excel del mes</Button>
          </Upload>
          {periodo?.estado === 'abierto' && (
            <Popconfirm title={`¿Cerrar ${mes}?`} description="La liquidación queda guardada y el mes congelado. Se puede reabrir mientras no haya pagos."
              okText="Cerrar mes" cancelText="No" disabled={!datos?.cambio}
              onConfirm={() => accion('cerrar', () => enviar(`periodos/${mes}/cerrar`, 'POST', {}), `${mes} cerrado.`)}>
              <Button type="primary" disabled={!datos?.cambio || !!ocupado} loading={ocupado === 'cerrar'}>Cerrar mes</Button>
            </Popconfirm>
          )}
          {periodo?.estado === 'cerrado' && (
            <>
              <Button disabled={!!ocupado} loading={ocupado === 'pdf'} onClick={() => pdf()}>PDF de todos los deptos</Button>
              <Popconfirm title={`¿Reabrir ${mes}?`} description="Se borra la liquidación guardada y se vuelve a calcular. No se puede si ya hay pagos."
                okText="Reabrir" cancelText="No"
                onConfirm={() => accion('reabrir', () => enviar(`periodos/${mes}/reabrir`, 'POST', {}), `${mes} reabierto.`)}>
                <Button danger disabled={!!ocupado} loading={ocupado === 'reabrir'}>Reabrir mes</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </Card>

      {error && <Alert type="error" showIcon title={error} />}
      {aviso && <Alert type="success" showIcon closable title={aviso} onClose={() => setAviso(undefined)} />}
      {datos?.avisos.length ? <Alert type="warning" showIcon title="Avisos" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{datos.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>} /> : null}
      {resumen && (
        <Alert type={resumen.distinto || resumen.solo_excel || resumen.solo_app ? 'warning' : 'success'} showIcon
          title={`Comparación con el Excel: ${resumen.igual ?? 0} iguales, ${resumen.distinto ?? 0} con diferencias`
            + (resumen.solo_app ? `, ${resumen.solo_app} solo en la app` : '')}
          description={soloExcel?.length ? `Hojas del Excel sin liquidación en la app: ${soloExcel.join(', ')}` : undefined} />
      )}

      <Space wrap size="middle">
        <Input.Search allowClear placeholder="Buscar depto o propietario" style={{ width: 280 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
        {datos && (
          <Typography.Text type="secondary">
            {visibles.length} deptos · Bruto <b>{pesos(suma((d) => d.resultado.bruto))}</b> · Honorarios <b>{pesos(suma((d) => d.resultado.honorarios))}</b>
            {' '}· Saldos <b>{pesos(saldos('ARS'))}</b> · <b>{pesos(saldos('USD'), 'USD')}</b>
          </Typography.Text>
        )}
      </Space>
      <Table<LiquidacionDepto> rowKey="deptoId" size="small" pagination={false} sticky scroll={{ x: "max-content" }} loading={!datos && !error}
        dataSource={visibles} columns={columnas}
        expandable={{ expandedRowRender: (d) => <Detalle d={d} comparacion={comparacion?.get(d.codigo)} /> }} />
    </Space>
  );
}
