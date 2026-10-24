// Facturas y notas de crédito emitidas desde Hornera, por mes de emisión (plan 035): las aprobadas y los
// rechazos pendientes. Los de homologación solo llegan con la app sin instalar (lo filtra el servidor).
// La vista "En ARCA" muestra lo importado de Mis Comprobantes, también lo hecho por fuera (plan 036).
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Input, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import { mesVisto } from './Asistente.tsx';
import type { TableColumnsType } from 'antd';
import type { FilaComprobante } from '../server/facturacion.ts';
import { descargarPdfComprobante, get, pesos } from './api.ts';
import { EnArca } from './EnArca.tsx';
import { FormFactura, FormNotaCredito, type AFacturar, type FacturaNC } from './Transferencias.tsx';

interface Lista { filas: FilaComprobante[]; totales: { emisor_id: number; emisor: string; neto: number; cantidad: number }[] }
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const json = (s: string | null) => {
  if (!s) return '—';
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }  // el XML de ARCA va tal cual
};

export function Comprobantes() {
  const [mes, setMes] = useState(() => new Date().toLocaleDateString('sv').slice(0, 7));
  mesVisto.valor = mes ?? ''; // para el asistente
  const [vista, setVista] = useState<'hornera' | 'arca'>('hornera');
  const [lista, setLista] = useState<Lista>();
  const [emisor, setEmisor] = useState<number>();
  const [tipo, setTipo] = useState<'facturas' | 'nc' | 'rechazados'>();
  const [texto, setTexto] = useState('');
  const [facturando, setFacturando] = useState<AFacturar>();
  const [nc, setNc] = useState<{ factura: FacturaNC; codigo: string }>();
  const [detalle, setDetalle] = useState<any>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setLista(undefined);
    get<Lista>(`comprobantes?mes=${mes}`).then(setLista, (e) => setError(String(e)));
  }, [mes, version]);

  const verDetalle = (id: number) => get(`comprobantes/${id}/detalle`).then(setDetalle, (e) => setError(String(e)));
  const recargar = (cambio: boolean) => { if (cambio) setVersion((v) => v + 1); };

  const t = texto.trim().toLowerCase();
  const visibles = (lista?.filas ?? []).filter((f) => (!emisor || f.emisor_id === emisor)
    && (!tipo || (tipo === 'rechazados' ? f.estado === 'rechazado' : f.estado === 'aprobado' && f.es_nc === (tipo === 'nc')))
    && (!t || [f.codigo, f.propietario, f.numero].some((x) => x?.toLowerCase().includes(t))));
  const emisores = [...new Map((lista?.filas ?? []).map((f) => [f.emisor_id, f.emisor])).entries()];

  const columnas: TableColumnsType<FilaComprobante> = [
    { title: 'Fecha', dataIndex: 'fecha', width: 100 },
    {
      title: 'Comprobante', key: 'cbte', render: (_: unknown, f) => (f.estado === 'rechazado'
        ? <Typography.Text type="danger" ellipsis={{ tooltip: f.motivo }} style={{ maxWidth: 320 }}><Tag color="red">rechazada</Tag>{f.tipo} · {f.motivo}</Typography.Text>
        : <span style={{ whiteSpace: 'nowrap' }}>{f.tipo} <b>{f.numero}</b></span>),
    },
    { title: 'Depto', dataIndex: 'codigo', width: 70, render: (v: string) => <b>{v}</b> },
    { title: 'Propietario', dataIndex: 'propietario', ellipsis: true },
    { title: 'Emisor', dataIndex: 'emisor' },
    { title: 'Importe', dataIndex: 'importe', ...derecha, render: (v: number, f) => (f.es_nc ? `− ${pesos(v)}` : pesos(v)) },
    { title: 'CAE', dataIndex: 'cae' },
    {
      title: '', key: 'marcas', render: (_: unknown, f) => (
        <Space size={4} wrap>
          {f.anulada_por && <Tag color="orange">anulada por NC {f.anulada_por}</Tag>}
          {f.anula && <Tag>anula FC {f.anula}</Tag>}
          {f.pago_anulado && !f.es_nc && <Tag>pago anulado</Tag>}
          {f.ambiente === 'homologacion' && <Tag title="Emitida en homologación: no vale fiscalmente">prueba</Tag>}
        </Space>
      ),
    },
    {
      title: '', key: 'acciones', ...derecha, render: (_: unknown, f) => (
        <Space size="small">
          {f.nc_pendiente && <Button size="small" onClick={() => setNc({ factura: { id: f.id, punto_venta: f.punto_venta, numero: f.numero_n!, importe: f.importe, ambiente: f.ambiente, emisor: f.emisor }, codigo: f.codigo })}>Emitir nota de crédito</Button>}
          {f.estado === 'rechazado' && !f.es_nc && <Button size="small" onClick={() => setFacturando({ pagoId: f.movimiento_id, codigo: f.codigo, moneda: f.moneda })}>Reintentar</Button>}
          {f.estado === 'aprobado' && <Button size="small" onClick={async () => setError(await descargarPdfComprobante(f.id))}>PDF</Button>}
          <Button size="small" onClick={() => verDetalle(f.id)}>Ver detalle</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Segmented value={vista} onChange={setVista} options={[{ value: 'hornera', label: 'Desde Hornera' }, { value: 'arca', label: 'En ARCA' }]} />
          <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
          {vista === 'hornera' && <>
          <Select allowClear placeholder="Todos los emisores" style={{ width: 180 }} value={emisor} onChange={setEmisor}
            options={emisores.map(([id, nombre]) => ({ value: id, label: nombre }))} />
          <Select allowClear placeholder="Todos los tipos" style={{ width: 180 }} value={tipo} onChange={setTipo}
            options={[{ value: 'facturas', label: 'Facturas' }, { value: 'nc', label: 'Notas de crédito' }, { value: 'rechazados', label: 'Rechazados' }]} />
          <Input.Search allowClear placeholder="Buscar depto, propietario o número" style={{ width: 280 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </>}
        </Space>
      </Card>
      {vista === 'arca' && <EnArca mes={mes} />}
      {vista === 'hornera' && <>
      {lista && lista.totales.length > 0 && (
        <Space wrap size="large">
          {lista.totales.map((x) => <Typography.Text key={x.emisor_id}><b>{x.emisor}</b>: {pesos(x.neto)} · {x.cantidad} comprobante{x.cantidad === 1 ? '' : 's'}</Typography.Text>)}
        </Space>
      )}
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<FilaComprobante> rowKey="id" size="small" pagination={false} sticky scroll={{ x: 'max-content' }} loading={!lista && !error}
        dataSource={visibles} columns={columnas} locale={{ emptyText: 'No hay comprobantes emitidos en este mes.' }} />
      </>}
      <FormFactura a={facturando} alCerrar={(cambio) => { setFacturando(undefined); recargar(cambio); }} />
      <FormNotaCredito nc={nc} alCerrar={(cambio) => { setNc(undefined); recargar(cambio); }} />
      <Drawer open={!!detalle} onClose={() => setDetalle(undefined)} size={900} destroyOnHidden
        title={detalle && `${detalle.tipo} ${detalle.numero ?? '(rechazada)'} · ${detalle.codigo}`}>
        {detalle && (
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions size="small" column={2} bordered items={[
              { label: 'Estado', children: <Tag color={detalle.estado === 'aprobado' ? 'green' : 'red'}>{detalle.estado}</Tag> },
              { label: 'Ambiente', children: detalle.ambiente },
              { label: 'Fecha', children: detalle.fecha },
              { label: 'Servicio', children: `${detalle.serv_desde} a ${detalle.serv_hasta}` },
              { label: 'Emisor', children: detalle.emisor },
              { label: 'Importe', children: pesos(detalle.importe) },
              { label: 'Receptor', children: `${detalle.receptor.razon_social} · ${detalle.receptor.doc_nro}` },
              { label: 'Condición IVA', children: detalle.receptor.condicion_iva },
              { label: 'CAE', children: detalle.cae ?? '—' },
              { label: 'Vence CAE', children: detalle.cae_vencimiento ?? '—' },
              { label: 'Motivo', children: detalle.motivo ?? '—', span: 2 },
              { label: 'Observaciones', children: detalle.observaciones ?? '—', span: 2 },
              { label: 'Registrado', children: new Date(detalle.creado_en).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }), span: 2 },
            ]} />
            <Typography.Text strong>Pedido a ARCA</Typography.Text>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{json(detalle.request_json)}</pre>
            <Typography.Text strong>Respuesta de ARCA</Typography.Text>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{json(detalle.response_json)}</pre>
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
