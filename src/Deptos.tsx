// Deptos: buscador, filtro por estado y tabla con fotos (vienen de Stays, "traer mes").
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Drawer, Form, Image, Input, InputNumber, Modal, Row, Segmented, Space, Table, Tag, Typography, theme } from 'antd';
import type { TableColumnsType } from 'antd';
import { entradaPlata, enviar, get, pesos } from './api.ts';
import { Historial } from './Historial.tsx';

interface Depto { id: number; codigo: string; nombre: string; direccion: string | null; estado: string; comision_pct: number; propietario: string; fotos: string[];
  tarifa_base_override: number | null; adicional_huesped_override: number | null; cm_fee_usd_override: number | null }

// Orden de la tabla y del filtro: lo operativo primero.
const estados: Record<string, { label: string; color: string }> = {
  activo: { label: 'Activo', color: 'green' },
  proximo: { label: 'Próximo', color: 'blue' },
  potencial: { label: 'Potencial', color: 'purple' },
  pausado: { label: 'Pausado', color: 'orange' },
  finalizado: { label: 'Finalizado', color: 'default' },
};
const rango = (e: string) => Object.keys(estados).indexOf(e);

// ponytail: todos los deptos son de Rosario; si aparece otra ciudad se ve completa.
const sinCiudad = (d: string | null) => d?.replace(/,\s*Rosario,?\s*(Santa|Sta\.?)\s*Fe\.?\s*$/i, '') ?? '';

function SinFoto() {
  const { token } = theme.useToken();
  return (
    <div style={{ width: 64, height: 48, borderRadius: 4, background: token.colorFillTertiary, display: 'grid', placeItems: 'center' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={token.colorTextQuaternary} strokeWidth="1.8" aria-hidden="true">
        <path d="M3 11 12 4l9 7M5 10v10h14V10" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

const columnas = (verHistorial: (d: Depto) => void, editar: (d: Depto) => void): TableColumnsType<Depto> => [
  { title: 'Fotos', dataIndex: 'fotos', width: 88, render: (fotos: string[]) => fotos.length > 0 ? (
    <Image.PreviewGroup items={fotos}>
      <Image src={fotos[0]} width={64} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} alt="" />
    </Image.PreviewGroup>
  ) : <SinFoto /> },
  { title: 'Código', dataIndex: 'codigo', width: 90, render: (v: string) => <b>{v}</b>, sorter: (a, b) => a.codigo.localeCompare(b.codigo) },
  { title: 'Nombre', dataIndex: 'nombre', width: 200, ellipsis: true, sorter: (a, b) => a.nombre.localeCompare(b.nombre) },
  { title: 'Dirección', dataIndex: 'direccion', ellipsis: { showTitle: false }, render: (v: string | null) => <span title={v ?? ''}>{sinCiudad(v)}</span> },
  { title: 'Propietario', dataIndex: 'propietario', ellipsis: true, sorter: (a, b) => a.propietario.localeCompare(b.propietario) },
  { title: 'Comisión', dataIndex: 'comision_pct', width: 150, align: 'right', render: (v: number, d) => <>{`${Math.round(v * 100)} %`}{d.tarifa_base_override != null && <div><Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>tarifa {pesos(d.tarifa_base_override)}</Typography.Text></div>}</> },
  { title: 'Estado', dataIndex: 'estado', width: 120, render: (v: string) => <Tag color={estados[v]?.color}>{estados[v]?.label ?? v}</Tag>,
    sorter: (a, b) => rango(a.estado) - rango(b.estado) },
  { title: '', key: 'acciones', width: 170, render: (_: unknown, d) => <Space size="small">
    <Button size="small" onClick={() => editar(d)}>Variables</Button>
    <Button size="small" onClick={() => verHistorial(d)}>Historial</Button>
  </Space> },
];

export function Deptos() {
  const [deptos, setDeptos] = useState<Depto[]>();
  const [error, setError] = useState<string>();
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState('todos');
  const [historial, setHistorial] = useState<Depto>();
  const [editando, setEditando] = useState<Depto>();
  const cargar = () => get<Depto[]>('deptos').then(setDeptos, (e) => setError(String(e)));
  useEffect(() => { cargar(); }, []);

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (deptos ?? [])
      .filter((d) => estado === 'todos' || d.estado === estado)
      .filter((d) => !t || [d.codigo, d.nombre, d.direccion, d.propietario].some((c) => c?.toLowerCase().includes(t)))
      .sort((a, b) => rango(a.estado) - rango(b.estado) || a.codigo.localeCompare(b.codigo));
  }, [deptos, texto, estado]);

  const cuenta = (e: string) => (deptos ?? []).filter((d) => d.estado === e).length;
  const opciones = [
    { value: 'todos', label: `Todos (${deptos?.length ?? 0})` },
    ...Object.entries(estados).filter(([e]) => cuenta(e) > 0).map(([e, s]) => ({ value: e, label: `${s.label} (${cuenta(e)})` })),
  ];

  if (error) return <Alert type="error" title={error} />;
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size="middle">
        <Input.Search allowClear placeholder="Buscar por código, nombre, dirección o propietario" style={{ width: 380 }}
          value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Segmented value={estado} onChange={setEstado} options={opciones} />
        <Typography.Text type="secondary">{visibles.length} {visibles.length === 1 ? 'depto' : 'deptos'}</Typography.Text>
      </Space>
      <Table<Depto> rowKey="id" size="small" pagination={false} sticky loading={!deptos} dataSource={visibles} columns={columnas(setHistorial, setEditando)} />
      <VariablesDepto depto={editando} alCerrar={(guardado) => { setEditando(undefined); if (guardado) cargar(); }} />
      <Drawer open={!!historial} onClose={() => setHistorial(undefined)} size={900} destroyOnHidden
        title={historial && `Historial de ${historial.codigo} · ${historial.nombre}`}>
        {historial && <Historial deptoId={historial.id} />}
      </Drawer>
    </Space>
  );
}

// Comisión de Hornera y tarifas propias del depto; una tarifa vacía usa la del mes (Liquidación → Variables del mes).
const OVERRIDES = ['tarifa_base_override', 'adicional_huesped_override', 'cm_fee_usd_override'] as const;

function VariablesDepto({ depto, alCerrar }: { depto?: Depto; alCerrar: (guardado: boolean) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!depto) return;
    setError(undefined);
    form.setFieldsValue({
      comision_pct: Math.round(depto.comision_pct * 10000) / 100,
      ...Object.fromEntries(OVERRIDES.map((c) => [c, depto[c] == null ? null : depto[c]! / 100])),
    });
  }, [depto, form]);

  const guardar = async () => {
    const v = await form.validateFields();
    try {
      await enviar(`deptos/${depto!.id}`, 'PUT', {
        comision_pct: v.comision_pct / 100,
        ...Object.fromEntries(OVERRIDES.map((c) => [c, v[c] == null ? null : Math.round(v[c] * 100)])),
      });
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const tarifa = (name: string, label: string, prefix = '$') => (
    <Form.Item name={name} label={label}>
      <InputNumber {...entradaPlata} prefix={prefix} min={0} placeholder="La del mes" style={{ width: '100%' }} />
    </Form.Item>
  );
  return (
    <Modal open={!!depto} title={depto && `Variables de ${depto.codigo} · ${depto.nombre}`} width={560} okText="Guardar" cancelText="Cancelar"
      onOk={guardar} onCancel={() => alCerrar(false)} destroyOnHidden>
      {depto && (
        <dl className="ficha">
          <dt>Depto</dt><dd><b>{depto.codigo}</b> · {depto.nombre} <Tag color={estados[depto.estado]?.color}>{estados[depto.estado]?.label ?? depto.estado}</Tag></dd>
          <dt>Propietario</dt><dd>{depto.propietario}</dd>
          <dt>Se aplica</dt><dd>A los meses abiertos; los cerrados quedan como se liquidaron.</dd>
        </dl>
      )}
      <Form form={form} layout="vertical">
        <Typography.Text strong>Comisión</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>Lo que cobra Hornera sobre el ingreso bruto del depto.</Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="comision_pct" label="Comisión de Hornera" rules={[{ required: true, message: 'Falta la comisión' }]}>
              <InputNumber min={0} max={100} suffix="%" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text strong>Tarifas propias</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>Vacías usan las del mes (Liquidación → Variables del mes).</Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}>{tarifa('tarifa_base_override', 'Tarifa base por reserva')}</Col>
          <Col span={12}>{tarifa('adicional_huesped_override', 'Por cada par de huéspedes extra')}</Col>
          <Col span={12}>{tarifa('cm_fee_usd_override', 'Channel manager por mes', 'US$')}</Col>
        </Row>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}
