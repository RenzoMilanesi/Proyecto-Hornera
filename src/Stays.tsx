import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Space, Switch, Table, Tag, Typography } from 'antd';
import { mesVisto } from './Asistente.tsx';
import type { TableColumnsType } from 'antd';
import { enviar, get, pesos } from './api.ts';
import { AjustesReserva, type ReservaAjustable } from './AjustesReserva.tsx';

interface Reporte { mes: string; periodoCreado: boolean; reservas: number; pagos: number; medios: number; eliminadas: number; canceladas: number; deptosNuevos: string[]; avisos: string[] }
interface Reserva extends ReservaAjustable {
  llegada: string; salida: string; huespedes: number; plataforma: string | null; estado_stays: string | null;
  cobrado_ars: number; cobrado_usd: number; falta_comision: number | null;
  cancelada: number; hora_llegada: string | null; hora_salida: string | null; desglose_json: string | null;
}

// Desglose de precio tal como lo da Stays (importes en unidades, no centavos). Solo informativo.
interface Cargo { name?: string; _f_val?: number }
interface Parte { _f_nightPrice?: number; fees?: Cargo[]; extraServices?: Cargo[]; discounts?: Cargo[]; _f_total?: number }
interface Precio { currency?: string; _f_total?: number; hostingDetails?: Parte; extrasDetails?: Parte }

function Desglose({ json }: { json: string }) {
  const p = JSON.parse(json) as Precio;
  const plata = (v?: number) => (typeof v === 'number' ? pesos(Math.round(v * 100), p.currency === 'USD' ? 'USD' : 'ARS') : '');
  const filas = (titulo: string, x?: Parte) => x && [
    <tr key={titulo}><th colSpan={2} style={{ textAlign: 'left', paddingTop: 6 }}>{titulo}</th></tr>,
    ...(x._f_nightPrice != null ? [<tr key={`${titulo}-noche`}><td>Precio por noche</td><td align="right">{plata(x._f_nightPrice)}</td></tr>] : []),
    ...[...(x.fees ?? []), ...(x.extraServices ?? [])].map((c, i) => <tr key={`${titulo}-c${i}`}><td>{c.name ?? 'Cargo'}</td><td align="right">{plata(c._f_val)}</td></tr>),
    ...(x.discounts ?? []).map((c, i) => <tr key={`${titulo}-d${i}`}><td>{c.name ?? 'Descuento'}</td><td align="right">{plata(c._f_val)}</td></tr>),
    <tr key={`${titulo}-total`}><td><i>Subtotal</i></td><td align="right"><i>{plata(x._f_total)}</i></td></tr>,
  ];
  return (
    <table style={{ width: 'auto', minWidth: 320 }}><tbody>
      {filas('Hospedaje', p.hostingDetails)}
      {filas('Extras', p.extrasDetails)}
      <tr><th style={{ textAlign: 'left', paddingTop: 6 }}>Total</th><th style={{ textAlign: 'right', paddingTop: 6 }}>{plata(p._f_total)}</th></tr>
    </tbody></table>
  );
}

const enUnaLinea = { onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };

const columnas = (alEditar: (r: Reserva) => void): TableColumnsType<Reserva> => [
  { title: 'Depto', dataIndex: 'depto', width: 80, render: (v: string) => <b>{v}</b>, sorter: (a, b) => a.depto.localeCompare(b.depto) },
  { title: 'Reserva', dataIndex: 'codigo', width: 90 },
  { title: 'Llegada', dataIndex: 'llegada', ...enUnaLinea, render: (v: string, r) => `${v} ${r.hora_llegada ?? ''}` },
  { title: 'Salida', dataIndex: 'salida', ...enUnaLinea, render: (v: string, r) => `${v} ${r.hora_salida ?? ''}` },
  { title: 'Huésp.', dataIndex: 'huespedes', width: 70, align: 'right' },
  { title: 'Plataforma', dataIndex: 'plataforma', render: (v: string | null) => v ?? <Tag color="orange">sin plataforma</Tag> },
  { title: 'Cobrado ARS', dataIndex: 'cobrado_ars', align: 'right', ...enUnaLinea, render: (v: number) => (v ? pesos(v) : '') },
  { title: 'Cobrado USD', dataIndex: 'cobrado_usd', align: 'right', ...enUnaLinea, render: (v: number) => (v ? pesos(v, 'USD') : '') },
  {
    title: '', key: 'marcas', width: 150,
    render: (_: unknown, r) => <>
      {r.cancelada ? <Tag color="red">cancelada</Tag> : null}
      {r.falta_comision ? <Tag color="red">falta comisión</Tag> : null}
      {r.ajuste_ars || r.ajuste_usd ? <Tag color="blue">ajuste</Tag> : null}
      {r.ajuste_comision_ars || r.ajuste_comision_usd ? <Tag color="purple">comisión</Tag> : null}
      {r.excluida ? <Tag>excluida</Tag> : null}
    </>,
  },
  // Una cancelada no se liquida: sus ajustes no cambian nada.
  { title: '', key: 'editar', width: 90, render: (_: unknown, r) => !r.cancelada && <Button size="small" onClick={() => alEditar(r)}>Ajustes</Button> },
];

// En hora local: con toISOString (UTC) el último día del mes después de las 21 h daría el mes siguiente.
const mesActual = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
};

function Credenciales({ usuario, alGuardar }: { usuario: string | null; alGuardar: (u: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string>();
  if (usuario && !editando) {
    return (
      <Space>
        <Typography.Text>Conectado como <b>{usuario}</b>.</Typography.Text>
        <Button size="small" onClick={() => setEditando(true)}>Cambiar</Button>
      </Space>
    );
  }
  return (
    <Form layout="inline" onFinish={async (v: { usuario: string; clave: string }) => {
      try {
        const r = await enviar<{ usuario: string }>('stays/credenciales', 'PUT', v);
        setEditando(false);
        setError(undefined);
        alGuardar(r.usuario);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }}>
      <Form.Item name="usuario" rules={[{ required: true, message: 'Falta el usuario' }]}><Input placeholder="Usuario de la API" autoComplete="off" /></Form.Item>
      <Form.Item name="clave" rules={[{ required: true, message: 'Falta la clave' }]}><Input.Password placeholder="Clave" autoComplete="new-password" /></Form.Item>
      <Form.Item><Button type="primary" htmlType="submit">Guardar</Button></Form.Item>
      {usuario && <Form.Item><Button onClick={() => setEditando(false)}>Cancelar</Button></Form.Item>}
      {error && <Alert type="error" showIcon title={error} />}
    </Form>
  );
}

export function Stays() {
  const [usuario, setUsuario] = useState<string | null>(null);
  const [mes, setMes] = useState(mesActual());
  mesVisto.valor = mes ?? ''; // para el asistente
  const [trayendo, setTrayendo] = useState(false);
  const [reporte, setReporte] = useState<Reporte>();
  const [error, setError] = useState<string>();
  const [reservas, setReservas] = useState<Reserva[]>();
  const [editando, setEditando] = useState<Reserva>();
  const [version, setVersion] = useState(0); // fuerza recargar la tabla después de guardar ajustes
  const [texto, setTexto] = useState('');
  const [verCanceladas, setVerCanceladas] = useState(true);

  useEffect(() => { get<{ usuario: string | null }>('stays').then((r) => setUsuario(r.usuario), () => {}); }, []);
  useEffect(() => { get<Reserva[]>(`reservas?mes=${mes}`).then(setReservas, (e) => { setReservas([]); setError(String(e)); }); }, [mes, reporte, version]);

  const t = texto.trim().toLowerCase();
  const visibles = (reservas ?? []).filter((r) => (verCanceladas || !r.cancelada)
    && (!t || [r.depto, r.codigo, r.plataforma].some((c) => c?.toLowerCase().includes(t))));

  const traer = async (crear: string[] = []) => {
    setTrayendo(true);
    setError(undefined);
    setReporte(undefined);
    try {
      setReporte(await enviar<Reporte>('stays/sincronizar', 'POST', { mes, crear }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrayendo(false);
    }
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small" title="Credenciales de la API de Stays">
        <Credenciales usuario={usuario} alGuardar={setUsuario} />
      </Card>

      <Card size="small" title="Traer mes">
        <Space>
          <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
          <Button type="primary" onClick={() => traer()} loading={trayendo} disabled={!usuario}>Traer mes de Stays</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Trae reservas (también las canceladas, que no se liquidan), pagos y medios de pago. Se puede repetir: los ajustes manuales se conservan.
        </Typography.Paragraph>
        {error && <Alert style={{ marginTop: 12 }} type="error" showIcon title={error} />}
        {reporte && (
          <>
            <Descriptions style={{ marginTop: 12 }} size="small" bordered column={5} items={[
              { label: 'Reservas', children: reporte.reservas },
              { label: 'Pagos', children: reporte.pagos },
              { label: 'Medios de pago', children: reporte.medios },
              { label: 'Borradas', children: reporte.eliminadas },
              { label: 'Canceladas', children: reporte.canceladas },
            ]} />
            {reporte.deptosNuevos.length > 0 && (
              <Alert style={{ marginTop: 12 }} type="info" showIcon
                title={`En Stays hay ${reporte.deptosNuevos.length > 1 ? 'deptos' : 'un depto'} que no ${reporte.deptosNuevos.length > 1 ? 'están' : 'está'} en la app: ${reporte.deptosNuevos.join(', ')}`}
                description="¿Crearlos con los datos de Stays (dueño, dirección y fotos; 20% de comisión) y traer sus reservas?"
                action={<Button type="primary" size="small" loading={trayendo} onClick={() => traer(reporte.deptosNuevos)}>Crear y traer</Button>} />
            )}
            {reporte.avisos.length > 0 && (
              <Alert style={{ marginTop: 12 }} type="warning" showIcon title={`Avisos (${reporte.avisos.length})`}
                description={<ul style={{ margin: 0, paddingLeft: 20 }}>{reporte.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>} />
            )}
          </>
        )}
      </Card>

      <Card size="small" title={`Reservas de ${mes}${reservas ? ` (${visibles.length})` : ''}`} extra={
        <Space wrap>
          <Input.Search allowClear size="small" placeholder="Depto, reserva o plataforma" style={{ width: 240 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <Space><Switch size="small" checked={verCanceladas} onChange={setVerCanceladas} /> Ver canceladas</Space>
        </Space>
      }>
        <Table<Reserva> rowKey="id" size="small" pagination={false} sticky scroll={{ x: "max-content" }} loading={!reservas} dataSource={visibles} columns={columnas(setEditando)}
          onRow={(r) => (r.cancelada ? { style: { opacity: 0.5 } } : {})}
          expandable={{ rowExpandable: (r) => !!r.desglose_json, expandedRowRender: (r) => <Desglose json={r.desglose_json!} /> }} />
        <AjustesReserva reserva={editando} alCerrar={(guardado) => { setEditando(undefined); if (guardado) setVersion((v) => v + 1); }} />
      </Card>
    </Space>
  );
}
