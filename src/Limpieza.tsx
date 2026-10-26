// Limpieza (plan 057): horas que las chicas cargan en el Google Form, liquidaciones a la coordinadora por período
// (fechas libres) con lo que le toca a cada chica, y las reglas del plus por tipo de tarea. Control interno de Hornera.
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tabs, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import { entradaPlata, enviar, get, hoy, pesos, subirArchivo, useUnaVez } from './api.ts';
import type { Cuenta } from './Movimientos.tsx';

type Plus = Record<string, { modo: 'horas' | 'pesos'; valor: number }>;
interface PorOperaria { operaria: string; tareas: number; minutos: number; importe: number }
interface Liquidacion {
  id: number; desde: string; hasta: string; precio_hora: number; plus: Plus; ajuste: number; ajuste_nota: string | null;
  pagada: boolean; fecha_pago: string | null; tareas: number; minutos: number; importe: number; total: number; difiere: boolean;
  porOperaria?: PorOperaria[]; porDepto?: { depto: string; tareas: number; minutos: number }[];
}
interface Fila { clave: string; tareas: number; minutos: number }
interface Horas { porOperaria: Fila[]; porDepto: Fila[]; porMes: Fila[] }
interface ReporteHoras { importadas: number; duplicadas: number; anteriores: number; pagadas: number; avisos: string[] }

const hs = (min: number) => `${(min / 60).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`;
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const periodo = (l: { desde: string; hasta: string }) => `${ddmm(l.desde)}–${ddmm(l.hasta)}/${l.hasta.slice(0, 4)}`;
const diaSiguiente = (f: string) => new Date(Date.parse(f) + 86_400_000).toISOString().slice(0, 10);
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

function FormLiquidacion({ abierto, editando, sugerida, alCerrar }: {
  abierto: boolean; editando?: Liquidacion; sugerida?: { desde: string; precio_hora: number }; alCerrar: (guardado: boolean) => void;
}) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!abierto) return;
    setError(undefined);
    const l = editando;
    form.setFieldsValue(l
      ? { desde: l.desde, hasta: l.hasta, precio_hora: l.precio_hora / 100, ajuste: l.ajuste / 100, ajuste_nota: l.ajuste_nota ?? '' }
      : { desde: sugerida?.desde ?? hoy(), hasta: hoy(), precio_hora: sugerida ? sugerida.precio_hora / 100 : null, ajuste: 0, ajuste_nota: '' });
  }, [abierto, editando, sugerida, form]);

  const guardar = async () => {
    const v = await form.validateFields();
    const datos = { desde: v.desde, hasta: v.hasta, precio_hora: Math.round(v.precio_hora * 100), ajuste: Math.round((v.ajuste ?? 0) * 100), ajuste_nota: v.ajuste_nota || null };
    try {
      if (editando) await enviar(`limpieza/liquidaciones/${editando.id}`, 'PUT', datos);
      else await enviar('limpieza/liquidaciones', 'POST', datos);
      alCerrar(true);
    } catch (e) {
      setError(mensaje(e));
    }
  };
  const [guardarUnaVez, guardando] = useUnaVez(guardar);

  return (
    <Modal open={abierto} title={editando ? `Editar la liquidación de limpieza ${periodo(editando)}` : 'Nueva liquidación de limpieza'}
      okText="Guardar" cancelText="Cancelar" onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} width={560} destroyOnHidden>
      {editando && (
        <dl className="ficha">
          <dt>Período</dt><dd><b>{periodo(editando)}</b> · {editando.tareas} tareas, {hs(editando.minutos)}</dd>
          <dt>Total</dt><dd><b>{pesos(editando.total)}</b> <Tag color="orange">pendiente</Tag></dd>
        </dl>
      )}
      <Form form={form} layout="vertical">
        <Typography.Text strong>Período</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
          Entran las tareas con fecha entre desde y hasta, inclusive. No se puede pisar con otro período.
        </Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Desde" name="desde" rules={[{ required: true, message: 'Falta la fecha' }]}><Input type="date" style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Hasta" name="hasta" rules={[{ required: true, message: 'Falta la fecha' }]}><Input type="date" style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Precio por hora" name="precio_hora" extra="El mismo para todas las chicas."
              rules={[{ required: true, message: 'Falta el precio' }, { type: 'number', min: 0.01, message: 'Mayor que 0' }]}>
              <InputNumber {...entradaPlata} prefix="$" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text strong>Ajuste</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
          Corrección a mano del total (negativo para descontar). No se reparte entre las chicas y lleva una nota.
        </Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Importe" name="ajuste"><InputNumber {...entradaPlata} prefix="$" style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Nota" name="ajuste_nota"><Input /></Form.Item></Col>
        </Row>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

function FormPagar({ liquidacion, cuentas, alCerrar }: { liquidacion?: Liquidacion; cuentas: Cuenta[]; alCerrar: (guardado: boolean) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (liquidacion) { setError(undefined); form.setFieldsValue({ fecha: hoy(), cuenta_id: null }); }
  }, [liquidacion, form]);
  const guardar = async () => {
    const v = await form.validateFields();
    try {
      await enviar(`limpieza/liquidaciones/${liquidacion!.id}/pagar`, 'POST', { fecha: v.fecha, cuenta_id: v.cuenta_id ?? null });
      alCerrar(true);
    } catch (e) {
      setError(mensaje(e));
    }
  };
  const [guardarUnaVez, guardando] = useUnaVez(guardar);
  return (
    <Modal open={!!liquidacion} title={liquidacion && `Pago de la limpieza ${periodo(liquidacion)}`} okText="Marcar pagada" cancelText="Cancelar"
      onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} width={560} destroyOnHidden>
      {liquidacion && (
        <dl className="ficha">
          <dt>Período</dt><dd><b>{periodo(liquidacion)}</b> · {liquidacion.tareas} tareas, {hs(liquidacion.minutos)}</dd>
          <dt>Total</dt><dd><b>{pesos(liquidacion.total)}</b>{liquidacion.ajuste !== 0 && ` (con ajuste de ${pesos(liquidacion.ajuste)})`}</dd>
        </dl>
      )}
      <Form form={form} layout="vertical">
        <Typography.Text strong>Pago a la coordinadora</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
          Queda como gasto de Hornera (concepto Limpieza) en el mes de la fecha, que tiene que estar abierto. Lo de cada chica queda guardado como está hoy.
        </Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Fecha de pago" name="fecha" rules={[{ required: true, message: 'Falta la fecha' }]}><Input type="date" style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}>
            <Form.Item label="Sale de la cuenta" name="cuenta_id">
              <Select allowClear placeholder="Sin cuenta" options={cuentas.filter((c) => c.activo && c.moneda === 'ARS').map((c) => ({ value: c.id, label: c.nombre }))} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

function DetalleLiquidacion({ id, alCerrar }: { id?: number; alCerrar: () => void }) {
  const [l, setL] = useState<Liquidacion>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!id) return; // al cerrar queda lo último, para que no se vacíe mientras se va
    setL(undefined);
    setError(undefined);
    get<Liquidacion>(`limpieza/liquidaciones/${id}`).then(setL, (e) => setError(mensaje(e)));
  }, [id]);
  const columnas: TableColumnsType<PorOperaria> = [
    { title: 'Chica', dataIndex: 'operaria' },
    { title: 'Tareas', dataIndex: 'tareas', ...derecha },
    { title: 'Horas', dataIndex: 'minutos', ...derecha, render: hs },
    { title: 'Le toca', dataIndex: 'importe', ...derecha, render: (v: number) => pesos(v) },
  ];
  return (
    <Drawer open={!!id} onClose={alCerrar} size={900} destroyOnHidden title={l && `Limpieza ${periodo(l)}`}>
      {error && <Alert type="error" showIcon title={error} />}
      {l && (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <dl className="ficha">
            <dt>Estado</dt><dd>{l.pagada ? <Tag color="green">pagada el {ddmm(l.fecha_pago!)}</Tag> : <Tag color="orange">pendiente</Tag>}</dd>
            <dt>Precio por hora</dt><dd>{pesos(l.precio_hora)}</dd>
            <dt>Plus</dt><dd>{Object.entries(l.plus).map(([t, p]) => `${t} +${p.modo === 'horas' ? hs(p.valor) : pesos(p.valor)}`).join(' · ') || 'sin plus'}</dd>
          </dl>
          {l.difiere && <Alert type="warning" showIcon title="El Excel cambió después de pagar: lo de abajo es lo que se pagó." />}
          <Table<PorOperaria> rowKey="operaria" size="small" pagination={false} dataSource={l.porOperaria} columns={columnas}
            summary={() => (
              <>
                {l.ajuste !== 0 && (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}>Ajuste · {l.ajuste_nota}</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">{pesos(l.ajuste)}</Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}><b>Total a la coordinadora</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><b>{l.porOperaria?.reduce((s, o) => s + o.tareas, 0)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><b>{hs(l.minutos)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><b>{pesos(l.total)}</b></Table.Summary.Cell>
                </Table.Summary.Row>
              </>
            )} />
          <Typography.Text strong>Por depto</Typography.Text>
          <Table rowKey="depto" size="small" pagination={false} dataSource={l.porDepto} columns={[
            { title: 'Depto', dataIndex: 'depto' },
            { title: 'Tareas', dataIndex: 'tareas', ...derecha },
            { title: 'Horas', dataIndex: 'minutos', ...derecha, render: hs },
          ]} />
        </Space>
      )}
    </Drawer>
  );
}

function Liquidaciones({ version, recargar }: { version: number; recargar: () => void }) {
  const [lista, setLista] = useState<Liquidacion[]>();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [form, setForm] = useState<{ editando?: Liquidacion } | null>(null);
  const [pagando, setPagando] = useState<Liquidacion>();
  const [viendo, setViendo] = useState<number>();
  const [error, setError] = useState<string>();
  useEffect(() => { get<Liquidacion[]>('limpieza/liquidaciones').then(setLista, (e) => setError(mensaje(e))); }, [version]);
  useEffect(() => { get<Cuenta[]>('cuentas').then(setCuentas, () => {}); }, []);
  const ultima = lista?.[0];
  const sugerida = ultima && { desde: diaSiguiente(ultima.hasta), precio_hora: ultima.precio_hora };
  const alCerrar = (guardado: boolean) => { setForm(null); setPagando(undefined); if (guardado) recargar(); };

  const columnas: TableColumnsType<Liquidacion> = [
    { title: 'Período', key: 'periodo', render: (_: unknown, l) => periodo(l) },
    { title: 'Tareas', dataIndex: 'tareas', ...derecha },
    { title: 'Horas', dataIndex: 'minutos', ...derecha, render: hs },
    { title: 'Precio hora', dataIndex: 'precio_hora', ...derecha, render: (v: number) => pesos(v) },
    { title: 'Total', dataIndex: 'total', ...derecha, render: (v: number) => <b>{pesos(v)}</b> },
    {
      title: 'Estado', key: 'estado',
      render: (_: unknown, l) => (
        <Space size={4}>
          {l.pagada ? <Tag color="green">pagada el {ddmm(l.fecha_pago!)}</Tag> : <Tag color="orange">pendiente</Tag>}
          {l.difiere && <Tag color="red">el Excel cambió</Tag>}
        </Space>
      ),
    },
    {
      title: '', key: 'acciones', ...derecha,
      render: (_: unknown, l) => (
        <Space size="small">
          <Button size="small" onClick={() => setViendo(l.id)}>Ver</Button>
          {!l.pagada && <Button size="small" onClick={() => setForm({ editando: l })}>Editar</Button>}
          {!l.pagada && <Button size="small" type="primary" onClick={() => setPagando(l)}>Marcar pagada</Button>}
        </Space>
      ),
    },
  ];
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Button type="primary" onClick={() => setForm({})}>Nueva liquidación</Button>
        <Typography.Text type="secondary">Para cambiar una pagada, anulá su pago en Movimientos: vuelve a quedar pendiente.</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<Liquidacion> rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} loading={!lista && !error} dataSource={lista} columns={columnas} />
      <FormLiquidacion abierto={!!form} editando={form?.editando} sugerida={sugerida} alCerrar={alCerrar} />
      <FormPagar liquidacion={pagando} cuentas={cuentas} alCerrar={alCerrar} />
      <DetalleLiquidacion id={viendo} alCerrar={() => setViendo(undefined)} />
    </Space>
  );
}

function TablaHoras({ titulo, filas, rotulo }: { titulo: string; filas?: Fila[]; rotulo: string }) {
  return (
    <Card size="small" title={titulo}>
      <Table<Fila> rowKey="clave" size="small" pagination={false} dataSource={filas} columns={[
        { title: rotulo, dataIndex: 'clave' },
        { title: 'Tareas', dataIndex: 'tareas', ...derecha },
        { title: 'Horas', dataIndex: 'minutos', ...derecha, render: hs },
      ]} summary={(datos) => datos.length ? (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0}><b>Total</b></Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right"><b>{datos.reduce((s, f) => s + f.tareas, 0)}</b></Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right"><b>{hs(datos.reduce((s, f) => s + f.minutos, 0))}</b></Table.Summary.Cell>
        </Table.Summary.Row>
      ) : null} />
    </Card>
  );
}

function VistaHoras({ version }: { version: number }) {
  const [desde, setDesde] = useState(`${hoy().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState<Horas>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setError(undefined);
    get<Horas>(`limpieza/horas?desde=${desde}&hasta=${hasta}`).then(setDatos, (e) => setError(mensaje(e)));
  }, [desde, hasta, version]);
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        Desde <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: 160 }} />
        hasta <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ width: 160 }} />
        <Typography.Text type="secondary">Horas con el plus en horas de las reglas actuales. Solo información.</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon title={error} />}
      <Row gutter={16}>
        <Col span={8}><TablaHoras titulo="Por chica" rotulo="Chica" filas={datos?.porOperaria} /></Col>
        <Col span={8}><TablaHoras titulo="Por depto" rotulo="Depto" filas={datos?.porDepto} /></Col>
        <Col span={8}><TablaHoras titulo="Por mes" rotulo="Mes" filas={datos?.porMes} /></Col>
      </Row>
    </Space>
  );
}

function Reglas({ recargar }: { recargar: () => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  const [guardado, setGuardado] = useState(false);
  useEffect(() => {
    get<Plus>('limpieza/plus').then((p) => form.setFieldsValue({
      reglas: Object.entries(p).map(([tipo, r]) => ({ tipo, modo: r.modo, valor: r.modo === 'horas' ? r.valor / 60 : r.valor / 100 })),
    }), (e) => setError(mensaje(e)));
  }, [form]);
  const guardar = async () => {
    const v = await form.validateFields();
    const plus = Object.fromEntries((v.reglas ?? []).map((r: { tipo: string; modo: 'horas' | 'pesos'; valor: number }) =>
      [r.tipo.trim(), { modo: r.modo, valor: Math.round(r.valor * (r.modo === 'horas' ? 60 : 100)) }]));
    try {
      await enviar('limpieza/plus', 'PUT', plus);
      setError(undefined);
      setGuardado(true);
      recargar();
    } catch (e) {
      setError(mensaje(e));
    }
  };
  return (
    <Card size="small" style={{ maxWidth: 720 }}>
      <Typography.Paragraph type="secondary">
        Lo que se suma por cada tarea de ese tipo: horas (que se pagan al precio del período) o un monto fijo en pesos. Vale para las
        liquidaciones que se creen desde ahora; las ya creadas conservan sus reglas. Un tipo que no está acá no lleva plus.
      </Typography.Paragraph>
      <Form form={form} onValuesChange={() => setGuardado(false)}>
        <Form.List name="reglas">
          {(campos, { add, remove }) => (
            <>
              {campos.map((c) => (
                <Row gutter={12} key={c.key}>
                  <Col span={9}><Form.Item name={[c.name, 'tipo']} rules={[{ required: true, message: 'Falta el tipo' }]}><Input placeholder="Tipo de tarea (como en el Form)" /></Form.Item></Col>
                  <Col span={5}><Form.Item name={[c.name, 'modo']} initialValue="horas"><Select options={[{ value: 'horas', label: 'Horas' }, { value: 'pesos', label: 'Pesos' }]} /></Form.Item></Col>
                  <Col span={7}>
                    <Form.Item noStyle shouldUpdate>
                      {() => form.getFieldValue(['reglas', c.name, 'modo']) === 'pesos'
                        ? <Form.Item name={[c.name, 'valor']} rules={[{ required: true, message: 'Falta el valor' }]}><InputNumber {...entradaPlata} prefix="$" min={0} style={{ width: '100%' }} /></Form.Item>
                        : <Form.Item name={[c.name, 'valor']} rules={[{ required: true, message: 'Falta el valor' }]}><InputNumber min={0} step={0.5} suffix="h" style={{ width: '100%' }} /></Form.Item>}
                    </Form.Item>
                  </Col>
                  <Col span={3}><Button onClick={() => remove(c.name)}>Quitar</Button></Col>
                </Row>
              ))}
              <Space>
                <Button onClick={() => add({ modo: 'horas', valor: 0 })}>Agregar tipo</Button>
                <Button type="primary" onClick={guardar}>Guardar reglas</Button>
                {guardado && <Typography.Text type="success">Guardadas</Typography.Text>}
              </Space>
            </>
          )}
        </Form.List>
      </Form>
      {error && <Alert style={{ marginTop: 12 }} type="error" showIcon title={error} />}
    </Card>
  );
}

export function Limpieza() {
  const [version, setVersion] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [reporte, setReporte] = useState<ReporteHoras>();
  const [error, setError] = useState<string>();
  const recargar = () => setVersion((v) => v + 1);

  const importar = async (archivo: File) => {
    setCargando(true);
    setError(undefined);
    setReporte(undefined);
    try {
      setReporte(await subirArchivo<ReporteHoras>('importar/limpieza', archivo));
      recargar();
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Upload accept=".xlsx" showUploadList={false} disabled={cargando} beforeUpload={(a) => { importar(a); return false; }}>
            <Button loading={cargando}>Importar horas (Excel del Form)</Button>
          </Upload>
          <Typography.Text type="secondary">
            Bajá "HORAS LIMPIEZA" como .xlsx. Se reemplazan las tareas desde el 10/09/2026 que no están en un período pagado.
          </Typography.Text>
        </Space>
        {error && <Alert style={{ marginTop: 12 }} type="error" showIcon title={error} />}
        {reporte && (
          <Alert style={{ marginTop: 12 }} type={reporte.avisos.length ? 'warning' : 'success'} showIcon closable onClose={() => setReporte(undefined)}
            title={`${reporte.importadas} tareas importadas · ${reporte.pagadas} en períodos pagados (sin tocar) · ${reporte.duplicadas} repetidas · ${reporte.anteriores} anteriores al corte`}
            description={reporte.avisos.length > 0 && <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 200, overflow: 'auto' }}>{reporte.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>} />
        )}
      </Card>
      <Tabs items={[
        { key: 'horas', label: 'Horas', children: <VistaHoras version={version} /> },
        { key: 'liquidaciones', label: 'Liquidaciones', children: <Liquidaciones version={version} recargar={recargar} /> },
        { key: 'reglas', label: 'Reglas del plus', children: <Reglas recargar={recargar} /> },
      ]} />
    </Space>
  );
}
