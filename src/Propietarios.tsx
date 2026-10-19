// Propietarios: buscador, filtro de los que no tienen CBU, sus deptos y los datos para facturarles.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Drawer, Form, Input, Modal, Radio, Row, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import { enviar, get } from './api.ts';
import { Historial } from './Historial.tsx';

interface Propietario { id: number; nombre: string; moneda_liquidacion: string; tiene_cbu: number; deptos: string | null }
interface Fiscal {
  razon_social: string | null; doc_tipo: 80 | 96 | null; doc_nro: string | null; condicion_iva: string | null; domicilio: string | null;
  propuesto: boolean; excel: { documento: string | null; cuit: string | null; categoria_fiscal: string | null };
}
interface Padron { razon_social: string | null; doc_tipo: 80; doc_nro: string; condicion_iva: string | null; domicilio: string | null; estado_clave: string | null; dni: string | null }

const CONDICIONES = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto' },
  { value: 'monotributista', label: 'Monotributista' },
  { value: 'exento', label: 'Exento' },
  { value: 'consumidor_final', label: 'Consumidor final' },
];
const textoError = (e: unknown) => (e instanceof Error ? e.message : String(e));

function FormFiscal({ p, alCerrar }: { p?: Propietario; alCerrar: () => void }) {
  const [form] = Form.useForm();
  const [datos, setDatos] = useState<Fiscal>();
  const [error, setError] = useState<string>();
  const [padron, setPadron] = useState<{ cargando?: boolean; ok?: string; error?: string }>({});
  const docTipo = Form.useWatch('doc_tipo', form);
  useEffect(() => {
    if (!p) return;
    setDatos(undefined); setError(undefined); setPadron({});
    get<Fiscal>(`propietarios/${p.id}/fiscal`).then((d) => { setDatos(d); form.setFieldsValue(d); }, (e) => setError(textoError(e)));
  }, [p, form]);

  const guardar = async () => {
    const v = await form.validateFields();
    try {
      await enviar(`propietarios/${p!.id}/fiscal`, 'PUT', v);
      alCerrar();
    } catch (e) {
      setError(textoError(e));
    }
  };
  // Completa el formulario con lo que tiene ARCA; no se guarda hasta "Guardar".
  const consultar = async () => {
    setPadron({ cargando: true });
    try {
      const r = await enviar<Padron>(`propietarios/${p!.id}/padron`, 'POST', { cuit: form.getFieldValue('doc_nro') });
      const { estado_clave, dni, ...campos } = r;
      form.setFieldsValue({ ...campos, condicion_iva: campos.condicion_iva ?? form.getFieldValue('condicion_iva') });
      setPadron({ ok: `Completado con ARCA (clave ${estado_clave?.toLowerCase() ?? 'sin estado'}${dni ? `, DNI ${dni}` : ''}). Revisá y guardá.` });
    } catch (e) {
      setPadron({ error: textoError(e) });
    }
  };

  const x = datos?.excel;
  return (
    <Modal open={!!p} title={p && `Datos fiscales de ${p.nombre}`} okText="Guardar" cancelText="Cancelar" onOk={guardar} width={560}
      okButtonProps={{ disabled: !datos }} onCancel={alCerrar} destroyOnHidden>
      {p && (
        <dl className="ficha">
          <dt>Propietario</dt><dd><b>{p.nombre}</b>{p.deptos && ` · ${p.deptos}`}</dd>
          <dt>En el Excel</dt><dd>{[x?.cuit && `CUIT ${x.cuit}`, x?.documento, x?.categoria_fiscal].filter(Boolean).join(' · ') || '—'}</dd>
          {datos?.propuesto && <><dt>Estado</dt><dd><Tag color="orange">sin guardar: propuesto desde el Excel</Tag></dd></>}
        </dl>
      )}
      <Form form={form} layout="vertical">
        <Typography.Text strong>Receptor de la factura</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>A quién se le facturan los honorarios ante ARCA. Sin estos datos completos no se factura.</Typography.Paragraph>
        <Form.Item label="Razón social" name="razon_social" rules={[{ required: true, message: 'Falta la razón social' }]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Tipo de documento" name="doc_tipo">
              <Radio.Group optionType="button" options={[{ value: 80, label: 'CUIT' }, { value: 96, label: 'DNI' }]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Número" name="doc_nro"
              extra={padron.error ? <Typography.Text type="danger">{padron.error}</Typography.Text>
                : padron.ok ? <Typography.Text type="success">{padron.ok}</Typography.Text> : undefined}>
              <Input placeholder={docTipo === 96 ? '12345678' : '20-12345678-9'} />
            </Form.Item>
          </Col>
        </Row>
        {docTipo === 80 && (
          <Form.Item extra="Trae razón social, condición y domicilio de la constancia de inscripción. Solo con un emisor en producción.">
            <Button loading={padron.cargando} onClick={consultar}>Consultar padrón de ARCA</Button>
          </Form.Item>
        )}
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Condición frente al IVA" name="condicion_iva"><Select allowClear options={CONDICIONES} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Domicilio" name="domicilio"><Input /></Form.Item></Col>
        </Row>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function Propietarios() {
  const [filas, setFilas] = useState<Propietario[]>();
  const [error, setError] = useState<string>();
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [historial, setHistorial] = useState<Propietario>();
  const [fiscal, setFiscal] = useState<Propietario>();
  useEffect(() => {
    get<Propietario[]>('propietarios').then(setFilas, (e) => setError(String(e)));
  }, []);

  const sinCbu = (filas ?? []).filter((p) => !p.tiene_cbu).length;
  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (filas ?? [])
      .filter((p) => filtro === 'todos' || !p.tiene_cbu)
      .filter((p) => !t || [p.nombre, p.deptos].some((c) => c?.toLowerCase().includes(t)));
  }, [filas, texto, filtro]);

  if (error) return <Alert type="error" title={error} />;
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size="middle">
        <Input.Search allowClear placeholder="Buscar por nombre o depto" style={{ width: 320 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Segmented value={filtro} onChange={setFiltro} options={[
          { value: 'todos', label: `Todos (${filas?.length ?? 0})` },
          { value: 'sin_cbu', label: `Falta CBU (${sinCbu})`, disabled: !sinCbu },
        ]} />
        <Typography.Text type="secondary">{visibles.length} {visibles.length === 1 ? 'propietario' : 'propietarios'}</Typography.Text>
      </Space>
      <Table<Propietario> rowKey="id" size="small" pagination={false} sticky loading={!filas} dataSource={visibles} columns={[
        { title: 'Nombre', dataIndex: 'nombre', sorter: (a, b) => a.nombre.localeCompare(b.nombre), defaultSortOrder: 'ascend' },
        { title: 'Deptos', dataIndex: 'deptos', render: (v: string | null) => v?.split(',').map((d) => <Tag key={d}>{d.trim()}</Tag>) },
        { title: 'Liquida en', dataIndex: 'moneda_liquidacion', width: 110, render: (v: string) => <Tag color={v === 'USD' ? 'green' : 'default'}>{v}</Tag> },
        { title: 'CBU', dataIndex: 'tiene_cbu', width: 90, render: (v: number) => (v ? 'Cargado' : <Tag color="orange">Falta</Tag>) },
        { title: '', key: 'acciones', width: 220, render: (_: unknown, p) => (
          <Space>
            <Button size="small" onClick={() => setFiscal(p)}>Datos fiscales</Button>
            <Button size="small" onClick={() => setHistorial(p)}>Historial</Button>
          </Space>
        ) },
      ]} />
      <FormFiscal p={fiscal} alCerrar={() => setFiscal(undefined)} />
      <Drawer open={!!historial} onClose={() => setHistorial(undefined)} size={900} destroyOnHidden
        title={historial && `Historial de ${historial.nombre}`}>
        {historial && <Historial propietarioId={historial.id} />}
      </Drawer>
    </Space>
  );
}
