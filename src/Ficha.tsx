// Ficha del depto (plan 049): servicios e impuestos con su vencimiento, claves, contactos y notas.
// Se ve en un Drawer desde Deptos; cada renglón se carga en un Modal.
import { useEffect, useState } from 'react';
import { Alert, AutoComplete, Button, Col, Form, Input, InputNumber, Modal, Popconfirm, Radio, Row, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { enviar, get, useUnaVez } from './api.ts';

export type Lista = 'servicios' | 'claves' | 'contactos';
interface Servicio { id: number; concepto: string; cuenta: string | null; titular: string | null; paga: 'hornera' | 'propietario';
  dia: number | null; cada_meses: number | null; mes_desde: number | null; nota: string | null }
interface Clave { id: number; nombre: string; usuario: string | null; clave: string | null; nota: string | null }
interface Contacto { id: number; nombre: string; rol: string | null; telefono: string | null; nota: string | null }
interface DatosFicha { notas: string | null; servicios: Servicio[]; claves: Clave[]; contactos: Contacto[] }
export type Renglon = Servicio | Clave | Contacto;

export const PERIODOS: Record<number, string> = { 1: 'Mensual', 2: 'Bimestral', 3: 'Trimestral', 4: 'Cuatrimestral', 6: 'Semestral', 12: 'Anual' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NOMBRE: Record<Lista, string> = { servicios: 'servicio', claves: 'clave', contactos: 'contacto' };

const vence = (s: Servicio) => s.dia == null ? <Typography.Text type="secondary">—</Typography.Text>
  : `Día ${s.dia} · ${PERIODOS[s.cada_meses!]}${s.cada_meses! > 1 ? ` desde ${MESES[s.mes_desde! - 1]}` : ''}`;

export function Ficha({ depto }: { depto: { id: number; codigo: string; nombre: string } }) {
  const [datos, setDatos] = useState<DatosFicha>();
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<{ lista: Lista; fila?: Renglon }>();
  const [notas, setNotas] = useState(false);
  const cargar = () => get<DatosFicha>(`deptos/${depto.id}/ficha`).then(setDatos, (e) => setError(String(e)));
  useEffect(() => { cargar(); }, [depto.id]);

  const borrar = (lista: Lista, id: number) => enviar(`ficha/${lista}/${id}`, 'DELETE', {}).then(cargar, (e) => setError(String(e)));
  const acciones = (lista: Lista) => ({
    title: '', key: 'acciones', width: 150, render: (_: unknown, f: Renglon) => <Space size="small">
      <Button size="small" onClick={() => setForm({ lista, fila: f })}>Editar</Button>
      <Popconfirm title={`¿Borrar este ${NOMBRE[lista]}?`} okText="Borrar" okButtonProps={{ danger: true }} cancelText="No" onConfirm={() => borrar(lista, f.id)}>
        <Button size="small" danger>Borrar</Button>
      </Popconfirm>
    </Space>,
  });
  const nota = { title: 'Nota', dataIndex: 'nota', ellipsis: true };

  const servicios: TableColumnsType<Servicio> = [
    { title: 'Concepto', dataIndex: 'concepto', render: (v: string) => <b>{v}</b> },
    { title: 'N° de cuenta', dataIndex: 'cuenta', render: (v: string | null) => v && <Typography.Text copyable>{v}</Typography.Text> },
    { title: 'Titular', dataIndex: 'titular', ellipsis: true },
    { title: 'Paga', dataIndex: 'paga', width: 110, render: (v: string) => v === 'hornera' ? <Tag color="blue">Hornera</Tag> : <Tag>Propietario</Tag> },
    { title: 'Vence', key: 'vence', render: (_: unknown, s) => vence(s) },
    nota, acciones('servicios'),
  ];
  const claves: TableColumnsType<Clave> = [
    { title: 'Qué es', dataIndex: 'nombre', render: (v: string) => <b>{v}</b> },
    { title: 'Usuario o red', dataIndex: 'usuario', render: (v: string | null) => v && <Typography.Text copyable>{v}</Typography.Text> },
    { title: 'Clave', dataIndex: 'clave', width: 220, render: (v: string | null) => v && <Space size={4}>
      <Input.Password readOnly variant="borderless" value={v} style={{ width: 160 }} />
      <Typography.Text copyable={{ text: v, tooltips: ['Copiar', 'Copiada'] }} />
    </Space> },
    nota, acciones('claves'),
  ];
  const contactos: TableColumnsType<Contacto> = [
    { title: 'Nombre', dataIndex: 'nombre', render: (v: string) => <b>{v}</b> },
    { title: 'Rol', dataIndex: 'rol' },
    { title: 'Teléfono', dataIndex: 'telefono', render: (v: string | null) => v && <Typography.Text copyable>{v}</Typography.Text> },
    nota, acciones('contactos'),
  ];

  if (error) return <Alert type="error" showIcon title={error} />;
  const tabla = <T extends Renglon>(lista: Lista, columnas: TableColumnsType<T>, filas: T[] | undefined) => (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Button type="primary" onClick={() => setForm({ lista })}>Agregar {NOMBRE[lista]}</Button>
      <Table<T> rowKey="id" size="small" pagination={false} loading={!datos} dataSource={filas} columns={columnas} />
    </Space>
  );
  return (
    <>
      <Tabs items={[
        { key: 'servicios', label: `Servicios e impuestos (${datos?.servicios.length ?? 0})`, children: tabla('servicios', servicios, datos?.servicios) },
        { key: 'claves', label: `Claves (${datos?.claves.length ?? 0})`, children: tabla('claves', claves, datos?.claves) },
        { key: 'contactos', label: `Contactos (${datos?.contactos.length ?? 0})`, children: tabla('contactos', contactos, datos?.contactos) },
        { key: 'notas', label: 'Notas', children: <Space orientation="vertical" style={{ width: '100%' }}>
          <Button onClick={() => setNotas(true)}>Editar notas</Button>
          {datos?.notas ? <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{datos.notas}</Typography.Paragraph>
            : <Typography.Text type="secondary">Sin notas: cómo entrar, dónde están los medidores, mañas del depto…</Typography.Text>}
        </Space> },
      ]} />
      <FormRenglon depto={depto} abierto={form} alCerrar={(g) => { setForm(undefined); if (g) cargar(); }} />
      <FormNotas depto={depto} abierto={notas} notas={datos?.notas ?? null} alCerrar={(g) => { setNotas(false); if (g) cargar(); }} />
    </>
  );
}

// abierto.inicial: un renglón nuevo ya completo (tarjeta del asistente, plan 068).
export function FormRenglon({ depto, abierto, alCerrar }: {
  depto: { id: number; codigo: string; nombre: string }; abierto?: { lista: Lista; fila?: Renglon; inicial?: Record<string, unknown> }; alCerrar: (guardado: boolean) => void;
}) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  const [conceptos, setConceptos] = useState<string[]>([]);
  const cada = Form.useWatch('cada_meses', form) as number | undefined;
  const conVence = cada != null;
  useEffect(() => {
    if (!abierto) return;
    setError(undefined);
    form.resetFields();
    const f = (abierto.fila ?? abierto.inicial) as Servicio | undefined;
    form.setFieldsValue(f ? { ...f, mes_desde: f.cada_meses === 1 ? undefined : f.mes_desde } : abierto.lista === 'servicios' ? { paga: 'hornera' } : {});
    if (abierto.lista === 'servicios') get<{ nombre: string }[]>('conceptos').then((cs) => setConceptos(cs.map((c) => c.nombre)), () => {});
  }, [abierto, form]);

  const guardar = async () => {
    const v = await form.validateFields();
    // Sin periodicidad no hay vencimiento; uno mensual vence todos los meses.
    if (v.cada_meses == null) Object.assign(v, { dia: null, mes_desde: null });
    else if (v.cada_meses === 1) v.mes_desde = 1;
    try {
      const { lista, fila } = abierto!;
      if (fila) await enviar(`ficha/${lista}/${fila.id}`, 'PUT', v);
      else await enviar(`deptos/${depto.id}/ficha/${lista}`, 'POST', v);
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [guardarUnaVez, guardando] = useUnaVez(guardar);
  const lista = abierto?.lista;
  const texto = (name: string, label: string, requerido?: string) => (
    <Form.Item name={name} label={label} rules={requerido ? [{ required: true, whitespace: true, message: requerido }] : []}><Input /></Form.Item>
  );
  return (
    <Modal open={!!abierto} title={lista && `${abierto?.fila ? 'Editar' : 'Agregar'} ${NOMBRE[lista]} de ${depto.codigo} · ${depto.nombre}`}
      width={560} okText="Guardar" cancelText="Cancelar" onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} destroyOnHidden>
      <dl className="ficha"><dt>Depto</dt><dd><b>{depto.codigo}</b> · {depto.nombre}</dd></dl>
      <Form form={form} layout="vertical">
        {lista === 'servicios' && <>
          <Typography.Text strong>Servicio</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>El concepto es el mismo que se usa al cargar el gasto en Movimientos.</Typography.Paragraph>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="concepto" label="Concepto" rules={[{ required: true, whitespace: true, message: 'Falta el concepto' }]}>
                <AutoComplete options={conceptos.map((c) => ({ value: c }))} placeholder="EPE, API, TGI, Expensas…"
                  filterOption={(t, o) => String(o?.value).toLowerCase().includes(t.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col span={12}>{texto('cuenta', 'N° de cuenta o partida')}</Col>
            <Col span={12}>{texto('titular', 'Titular')}</Col>
            <Col span={12}>
              <Form.Item name="paga" label="Lo paga">
                <Radio.Group optionType="button" options={[{ value: 'hornera', label: 'Hornera' }, { value: 'propietario', label: 'Propietario' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Text strong>Vencimiento</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>Si lo paga Hornera, aparece en Vencimientos. Vacío: sin vencimiento.</Typography.Paragraph>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="cada_meses" label="Periodicidad">
                <Select allowClear placeholder="Sin vencimiento" options={Object.entries(PERIODOS).map(([v, l]) => ({ value: Number(v), label: l }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dia" label="Día del mes" rules={conVence ? [{ required: true, message: 'Falta el día' }] : []}>
                <InputNumber min={1} max={31} precision={0} disabled={!conVence} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="mes_desde" label="Vence en" extra="Un mes en que vence." rules={conVence && cada !== 1 ? [{ required: true, message: 'Falta el mes' }] : []}>
                <Select disabled={!conVence || cada === 1} placeholder={cada === 1 ? 'Todos' : undefined} options={MESES.map((m, i) => ({ value: i + 1, label: m }))} />
              </Form.Item>
            </Col>
          </Row>
        </>}
        {lista === 'claves' && <Row gutter={12}>
          <Col span={12}>{texto('nombre', 'Qué es', 'Poné qué es (por ejemplo, "Wifi")')}</Col>
          <Col span={12}>{texto('usuario', 'Usuario o red')}</Col>
          <Col span={12}><Form.Item name="clave" label="Clave"><Input.Password autoComplete="off" /></Form.Item></Col>
        </Row>}
        {lista === 'contactos' && <Row gutter={12}>
          <Col span={12}>{texto('nombre', 'Nombre', 'Falta el nombre')}</Col>
          <Col span={12}>{texto('rol', 'Rol', undefined)}</Col>
          <Col span={12}>{texto('telefono', 'Teléfono')}</Col>
        </Row>}
        <Form.Item name="nota" label="Nota"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function FormNotas({ depto, abierto, notas, alCerrar }: {
  depto: { id: number; codigo: string; nombre: string }; abierto: boolean; notas: string | null; alCerrar: (guardado: boolean) => void;
}) {
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => { if (abierto) { setValor(notas ?? ''); setError(undefined); } }, [abierto, notas]);
  const guardar = async () => {
    try {
      await enviar(`deptos/${depto.id}/notas`, 'PUT', { notas: valor });
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [guardarUnaVez, guardando] = useUnaVez(guardar);
  return (
    <Modal open={abierto} title={`Notas de ${depto.codigo} · ${depto.nombre}`} width={560} okText="Guardar" cancelText="Cancelar"
      onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} destroyOnHidden>
      <Input.TextArea value={valor} onChange={(e) => setValor(e.target.value)} autoSize={{ minRows: 8, maxRows: 20 }}
        placeholder="Cómo entrar, dónde están los medidores, mañas del depto…" />
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}
