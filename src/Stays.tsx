import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { enviar, get, pesos } from './api.ts';

interface Reporte { mes: string; periodoCreado: boolean; reservas: number; pagos: number; medios: number; eliminadas: number; avisos: string[] }
interface Reserva {
  id: number; codigo: string; depto: string; llegada: string; salida: string; huespedes: number; plataforma: string | null;
  estado_stays: string | null; ajuste_ars: number; ajuste_usd: number; excluida: number;
  cobrado_ars: number; cobrado_usd: number; falta_comision: number | null;
}

const enUnaLinea = { onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };

const columnas: TableColumnsType<Reserva> = [
  { title: 'Depto', dataIndex: 'depto', width: 80 },
  { title: 'Reserva', dataIndex: 'codigo', width: 90 },
  { title: 'Llegada', dataIndex: 'llegada', ...enUnaLinea },
  { title: 'Salida', dataIndex: 'salida', ...enUnaLinea },
  { title: 'Huésp.', dataIndex: 'huespedes', width: 70, align: 'right' },
  { title: 'Plataforma', dataIndex: 'plataforma', render: (v: string | null) => v ?? <Tag color="orange">sin plataforma</Tag> },
  { title: 'Cobrado ARS', dataIndex: 'cobrado_ars', align: 'right', ...enUnaLinea, render: (v: number) => (v ? pesos(v) : '') },
  { title: 'Cobrado USD', dataIndex: 'cobrado_usd', align: 'right', ...enUnaLinea, render: (v: number) => (v ? pesos(v, 'USD') : '') },
  {
    title: '', key: 'marcas', width: 150,
    render: (_: unknown, r) => <>
      {r.falta_comision ? <Tag color="red">falta comisión</Tag> : null}
      {r.ajuste_ars || r.ajuste_usd ? <Tag color="blue">ajuste</Tag> : null}
      {r.excluida ? <Tag>excluida</Tag> : null}
    </>,
  },
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
  const [trayendo, setTrayendo] = useState(false);
  const [reporte, setReporte] = useState<Reporte>();
  const [error, setError] = useState<string>();
  const [reservas, setReservas] = useState<Reserva[]>();

  useEffect(() => { get<{ usuario: string | null }>('stays').then((r) => setUsuario(r.usuario), () => {}); }, []);
  useEffect(() => { get<Reserva[]>(`reservas?mes=${mes}`).then(setReservas, () => setReservas([])); }, [mes, reporte]);

  const traer = async () => {
    setTrayendo(true);
    setError(undefined);
    setReporte(undefined);
    try {
      setReporte(await enviar<Reporte>('stays/sincronizar', 'POST', { mes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrayendo(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small" title="Credenciales de la API de Stays">
        <Credenciales usuario={usuario} alGuardar={setUsuario} />
      </Card>

      <Card size="small" title="Traer mes">
        <Space>
          <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
          <Button type="primary" onClick={traer} loading={trayendo} disabled={!usuario}>Traer mes de Stays</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Trae reservas, pagos y medios de pago. Se puede repetir: los ajustes manuales se conservan.
        </Typography.Paragraph>
        {error && <Alert style={{ marginTop: 12 }} type="error" showIcon title={error} />}
        {reporte && (
          <>
            <Descriptions style={{ marginTop: 12 }} size="small" bordered column={4} items={[
              { label: 'Reservas', children: reporte.reservas },
              { label: 'Pagos', children: reporte.pagos },
              { label: 'Medios de pago', children: reporte.medios },
              { label: 'Borradas', children: reporte.eliminadas },
            ]} />
            {reporte.avisos.length > 0 && (
              <Alert style={{ marginTop: 12 }} type="warning" showIcon title={`Avisos (${reporte.avisos.length})`}
                description={<ul style={{ margin: 0, paddingLeft: 20 }}>{reporte.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>} />
            )}
          </>
        )}
      </Card>

      <Card size="small" title={`Reservas de ${mes}${reservas ? ` (${reservas.length})` : ''}`}>
        <Table<Reserva> rowKey="id" size="small" pagination={false} loading={!reservas} dataSource={reservas} columns={columnas} />
      </Card>
    </Space>
  );
}
