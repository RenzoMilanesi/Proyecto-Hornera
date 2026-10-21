// Lo emitido en ARCA por cualquier medio (plan 036): el CSV de Mis Comprobantes → Emitidos de cada emisor.
// Muestra qué salió de Hornera, qué se hizo por fuera y a quién, para no facturar dos veces.
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import type { FilaMisComprobantes } from '../server/misComprobantes.ts';
import { enviar, get, pesos } from './api.ts';

interface Lista { filas: FilaMisComprobantes[]; importados: { emisor_id: number; emisor: string; ultima: string; hasta: string }[] }
interface EmisorLista { id: number; nombre: string; cuit: string }
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const numeroCbte = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`;
// Los tipos de ARCA más comunes; el resto, con su código.
const TIPOS: Record<number, string> = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C', 3: 'NC A', 8: 'NC B', 13: 'NC C', 2: 'ND A', 7: 'ND B', 12: 'ND C' };
const ESTADOS = {
  hornera: <Tag color="green">emitida desde Hornera</Tag>,
  sin_vincular: <Tag color="orange" title="Factura a un propietario hecha por fuera de Hornera: vinculala desde el pago, en Facturar">propietario, sin vincular</Tag>,
  propietario: <Tag>propietario</Tag>,
  ajena: <Tag title="El receptor no es un propietario cargado">otro receptor</Tag>,
};

function FormImportar({ abierto, alCerrar }: { abierto: boolean; alCerrar: (cambio: boolean) => void }) {
  const [form] = Form.useForm();
  const [emisores, setEmisores] = useState<EmisorLista[]>([]);
  const [archivo, setArchivo] = useState<File>();
  const [error, setError] = useState<string>();
  const [hecho, setHecho] = useState<string>();
  useEffect(() => {
    if (!abierto) return;
    setArchivo(undefined); setError(undefined); setHecho(undefined);
    form.resetFields();
    get<EmisorLista[]>('emisores').then(setEmisores);
  }, [abierto, form]);
  const importar = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v || !archivo) return;
    setError(undefined);
    // Texto aparte del JSON: un año de comprobantes pasa su límite.
    const r = await fetch(`/api/emisores/${v.emisor_id}/mis-comprobantes?nombre=${encodeURIComponent(archivo.name)}`,
      { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await archivo.text() }).catch(() => null);
    if (!r) return setError('No se pudo conectar con Hornera: revisá la conexión y probá de nuevo.');
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) return setError(cuerpo?.error ?? `${r.status} ${r.statusText}`);
    setHecho(`${cuerpo.leidos} comprobantes leídos, ${cuerpo.nuevos} nuevos.`);
  };
  return (
    <Modal open={abierto} title="Importar Mis Comprobantes de ARCA" okText={hecho ? 'Listo' : 'Importar'} cancelText="Cancelar" width={560}
      onOk={hecho ? () => alCerrar(true) : importar} onCancel={() => alCerrar(!!hecho)} okButtonProps={{ disabled: !hecho && !archivo }} destroyOnHidden>
      <Typography.Text strong>El archivo</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
        En ARCA, con la clave fiscal del emisor: Mis Comprobantes → Emitidos → elegir las fechas → exportar a CSV. Trae todo lo facturado,
        también lo de Comprobantes en Línea. Se puede importar las veces que haga falta: lo repetido no se duplica.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" disabled={!!hecho}>
        <Form.Item label="Emisor" name="emisor_id" rules={[{ required: true, message: 'Elegí de quién es el archivo' }]}
          extra="El nombre del archivo trae el CUIT: si es de otro emisor, se rechaza.">
          <Select placeholder="De quién es" options={emisores.map((e) => ({ value: e.id, label: e.nombre }))} />
        </Form.Item>
        <Form.Item label="CSV de Mis Comprobantes (Emitidos)">
          <Upload accept=".csv" maxCount={1} beforeUpload={(f) => { setArchivo(f); return false; }} onRemove={() => setArchivo(undefined)}>
            <Button>Elegir archivo</Button>
          </Upload>
        </Form.Item>
      </Form>
      {hecho && <Alert type="success" showIcon title={hecho} />}
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function EnArca({ mes }: { mes: string }) {
  const [lista, setLista] = useState<Lista>();
  const [importando, setImportando] = useState(false);
  const [estado, setEstado] = useState<FilaMisComprobantes['estado'] | 'vinculada'>();
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setLista(undefined);
    get<Lista>(`mis-comprobantes?mes=${mes}`).then(setLista, (e) => setError(String(e)));
  }, [mes, version]);

  const desvincular = async (id: number) => {
    try {
      await enviar(`mis-comprobantes/${id}/desvincular`, 'POST', {});
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const t = texto.trim().toLowerCase();
  const visibles = (lista?.filas ?? []).filter((f) => (!estado || f.estado === estado)
    && (!t || [f.receptor, f.propietario, f.doc_nro, numeroCbte(f.punto_venta, f.numero)].some((x) => x?.toLowerCase().includes(t))));
  const sinVincular = (lista?.filas ?? []).filter((f) => f.estado === 'sin_vincular').length;

  const columnas: TableColumnsType<FilaMisComprobantes> = [
    { title: 'Fecha', dataIndex: 'fecha', width: 100 },
    {
      title: 'Comprobante', key: 'cbte', render: (_: unknown, f) => (
        <span style={{ whiteSpace: 'nowrap' }}>{TIPOS[f.cbte_tipo] ?? `Tipo ${f.cbte_tipo}`} <b>{numeroCbte(f.punto_venta, f.numero)}</b>
          {f.numero_hasta !== f.numero && <> a {f.numero_hasta}</>}</span>
      ),
    },
    { title: 'Emisor', dataIndex: 'emisor' },
    {
      title: 'Receptor', key: 'receptor', ellipsis: true, render: (_: unknown, f) => (
        <>{f.propietario ? <b>{f.propietario}</b> : f.receptor}<br /><Typography.Text type="secondary">{f.receptor} · {f.doc_nro}</Typography.Text></>
      ),
    },
    { title: 'Importe', dataIndex: 'importe', ...derecha, render: (v: number, f) => ([3, 8, 13].includes(f.cbte_tipo) ? `− ${pesos(v)}` : pesos(v)) },
    {
      title: 'En Hornera', key: 'estado', render: (_: unknown, f) => (f.pago
        ? <Space size={4} wrap><Tag color="green">pago de {f.pago.depto} · {f.pago.mes}</Tag>{f.pago.anulado && <Tag color="orange">pago anulado</Tag>}</Space>
        : ESTADOS[f.estado as keyof typeof ESTADOS]),
    },
    {
      title: '', key: 'acciones', ...derecha, render: (_: unknown, f) => f.estado === 'vinculada' && (
        <Popconfirm title="El pago vuelve a quedar sin factura." okText="Desvincular" cancelText="No" onConfirm={() => desvincular(f.id)}>
          <Button size="small">Desvincular</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size="large">
        <Button type="primary" onClick={() => setImportando(true)}>Importar de ARCA</Button>
        <Select allowClear placeholder="Todos" style={{ width: 220 }} value={estado} onChange={setEstado} options={[
          { value: 'sin_vincular', label: 'Propietario, sin vincular' }, { value: 'vinculada', label: 'Vinculadas a un pago' },
          { value: 'hornera', label: 'Emitidas desde Hornera' }, { value: 'propietario', label: 'NC o ND a propietarios' }, { value: 'ajena', label: 'Otros receptores' },
        ]} />
        <Input.Search allowClear placeholder="Buscar receptor, documento o número" style={{ width: 280 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Space>
      {lista && (lista.importados.length
        ? <Typography.Text type="secondary">Importado: {lista.importados.map((x) => `${x.emisor}: comprobantes hasta el ${x.hasta}, importado el ${x.ultima.slice(0, 10)}`).join(' · ')}</Typography.Text>
        : <Alert type="info" showIcon title="Todavía no se importó nada: bajá el CSV de Mis Comprobantes → Emitidos de cada emisor y tocá Importar de ARCA." />)}
      {sinVincular > 0 && (
        <Alert type="warning" showIcon title={`${sinVincular} factura${sinVincular === 1 ? '' : 's'} a propietarios hecha${sinVincular === 1 ? '' : 's'} por fuera de Hornera`}
          description="Al facturar el pago de ese propietario, Hornera la muestra y pide vincularla o confirmar que es otra." />
      )}
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<FilaMisComprobantes> rowKey="id" size="small" pagination={false} sticky scroll={{ x: 'max-content' }} loading={!lista && !error}
        dataSource={visibles} columns={columnas} locale={{ emptyText: 'No hay comprobantes importados de ARCA en este mes.' }} />
      <FormImportar abierto={importando} alCerrar={(cambio) => { setImportando(false); if (cambio) setVersion((v) => v + 1); }} />
    </Space>
  );
}
