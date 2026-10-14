// Movimientos del mes (reemplaza la hoja CORRIENTE): gastos, ingresos, adelantos, cobros
// directos, saldos iniciales y transferencias entre cuentas. No se borran: se anulan.
import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { entradaPlata, enviar, get, pesos, simbolo } from './api.ts';

interface Periodo { mes: string; estado: string }
interface Cuenta { id: number; nombre: string; moneda: 'ARS' | 'USD'; activo: number }
interface Movimiento {
  id: number; fecha: string; depto: string | null; tipo: string; concepto: string | null; detalle: string | null;
  importe_ars: number; importe_usd: number; cuenta_id: number | null; cuenta: string | null; estado: string; transferencia_grupo: number | null;
}

export const TIPOS: Record<string, string> = {
  gasto: 'Gasto', ingreso: 'Ingreso', pre_liquidacion: 'Adelanto al propietario', pago_directo: 'Cobro directo por plataforma',
  saldo_inicial: 'Saldo inicial', ajuste: 'Ajuste', liquidacion: 'Pago de liquidación', transferencia: 'Transferencia',
};
const CARGABLES = ['gasto', 'ingreso', 'pre_liquidacion', 'pago_directo', 'saldo_inicial', 'ajuste'];
const SIGNO_FIJO: Record<string, 1 | -1> = { gasto: -1, pre_liquidacion: -1, pago_directo: -1, ingreso: 1 };
const EMPRESA = '__empresa__'; // valor del select para "empresa (INT)"
// Hoy si es del mes elegido; si no, el día 1 de ese mes (no proponer una fecha de otro mes).
const fechaPorDefecto = (mes: string) => {
  const hoy = new Date().toLocaleDateString('sv-SE');
  return hoy.startsWith(mes) ? hoy : `${mes}-01`;
};
const aCentavos = (v: number | null | undefined) => Math.round((v ?? 0) * 100);
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const COLOR_TIPO: Record<string, string> = {
  gasto: 'orange', ingreso: 'green', pre_liquidacion: 'purple', pago_directo: 'cyan', saldo_inicial: 'default', ajuste: 'gold', liquidacion: 'blue', transferencia: 'geekblue',
};
const importe = (v: number, moneda?: 'USD') => (v ? <Typography.Text type={v < 0 ? 'danger' : undefined}>{pesos(v, moneda)}</Typography.Text> : '');

function FormMovimiento({ abierto, mes, editando, deptos, cuentas, conceptos, alCerrar }: {
  abierto: boolean; mes: string; editando?: Movimiento; deptos: string[]; cuentas: Cuenta[]; conceptos: string[];
  alCerrar: (guardado: boolean) => void;
}) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  const tipo = Form.useWatch('tipo', form) as string | undefined;
  const moneda = Form.useWatch('moneda', form) as 'ARS' | 'USD' | undefined;

  useEffect(() => {
    if (!abierto) return;
    setError(undefined);
    const m = editando;
    const importe = m ? (m.importe_ars || m.importe_usd) : 0;
    form.setFieldsValue(m ? {
      fecha: m.fecha, depto: m.depto ?? EMPRESA, tipo: m.tipo, concepto: m.concepto ?? '', detalle: m.detalle ?? '',
      moneda: m.importe_usd ? 'USD' : 'ARS', importe: Math.abs(importe) / 100, signo: importe < 0 ? -1 : 1, cuenta_id: m.cuenta_id,
    } : { fecha: fechaPorDefecto(mes), depto: undefined, tipo: 'gasto', concepto: '', detalle: '', moneda: 'ARS', importe: null, signo: -1, cuenta_id: null });
  }, [abierto, editando, form, mes]);
  useEffect(() => { if (tipo && SIGNO_FIJO[tipo]) form.setFieldValue('signo', SIGNO_FIJO[tipo]); }, [tipo, form]);
  // La cuenta tiene que ser de la moneda del importe.
  useEffect(() => {
    const c = cuentas.find((x) => x.id === form.getFieldValue('cuenta_id'));
    if (c && c.moneda !== moneda) form.setFieldValue('cuenta_id', null);
  }, [moneda, cuentas, form]);

  const guardar = async () => {
    const v = await form.validateFields();
    const importe = aCentavos(v.importe) * v.signo;
    const datos = {
      mes, fecha: v.fecha, depto: v.depto === EMPRESA ? null : v.depto, tipo: v.tipo, concepto: v.concepto || null,
      detalle: v.detalle || null, importe_ars: v.moneda === 'ARS' ? importe : 0, importe_usd: v.moneda === 'USD' ? importe : 0,
      cuenta_id: v.cuenta_id ?? null,
    };
    try {
      if (editando) await enviar(`movimientos/${editando.id}`, 'PUT', datos);
      else await enviar('movimientos', 'POST', datos);
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal open={abierto} title={editando ? 'Editar movimiento' : `Nuevo movimiento · ${mes}`} okText="Guardar" cancelText="Cancelar"
      onOk={guardar} onCancel={() => alCerrar(false)} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Space wrap>
          <Form.Item label="Fecha" name="fecha" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item label="Tipo" name="tipo" rules={[{ required: true }]} style={{ minWidth: 220 }}>
            <Select options={CARGABLES.map((t) => ({ value: t, label: TIPOS[t] }))} />
          </Form.Item>
        </Space>
        <Form.Item label="Depto" name="depto" rules={[{ required: true, message: 'Elegí el depto o "Empresa"' }]}>
          <Select showSearch placeholder="Depto o empresa"
            options={[{ value: EMPRESA, label: 'Empresa (INT)' }, ...deptos.map((d) => ({ value: d, label: d }))]} />
        </Form.Item>
        <Form.Item label="Concepto" name="concepto">
          <AutoComplete options={conceptos.map((c) => ({ value: c }))} placeholder="EPE, Expensas, Cerrajería…"
            filterOption={(texto, op) => String(op?.value ?? '').toLowerCase().includes(texto.toLowerCase())} />
        </Form.Item>
        <Form.Item label="Detalle" name="detalle"><Input /></Form.Item>
        <Space wrap align="start">
          <Form.Item label="Moneda" name="moneda"><Radio.Group optionType="button" options={['ARS', 'USD']} /></Form.Item>
          <Form.Item label="Importe" name="importe" rules={[{ required: true, message: 'Falta el importe' }, { type: 'number', min: 0.01, message: 'Mayor que 0' }]}>
            <InputNumber {...entradaPlata} prefix={simbolo(moneda)} style={{ width: 180 }} />
          </Form.Item>
          <Form.Item label="Sentido" name="signo">
            <Radio.Group optionType="button" disabled={!!(tipo && SIGNO_FIJO[tipo])}
              options={[{ value: -1, label: 'Sale / resta' }, { value: 1, label: 'Entra / suma' }]} />
          </Form.Item>
        </Space>
        <Form.Item label="Cuenta" name="cuenta_id" extra="Vacío si no mueve plata de una cuenta (por ejemplo, un cobro directo del propietario).">
          <Select allowClear placeholder="Sin cuenta"
            options={cuentas.filter((c) => c.activo && c.moneda === moneda).map((c) => ({ value: c.id, label: c.nombre }))} />
        </Form.Item>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

function FormTransferencia({ abierto, mes, cuentas, alCerrar }: { abierto: boolean; mes: string; cuentas: Cuenta[]; alCerrar: (guardado: boolean) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  const desde = cuentas.find((c) => c.id === Form.useWatch('desde', form));
  const hacia = cuentas.find((c) => c.id === Form.useWatch('hacia', form));
  const mismaMoneda = !!desde && !!hacia && desde.moneda === hacia.moneda;
  useEffect(() => { if (abierto) { setError(undefined); form.setFieldsValue({ fecha: fechaPorDefecto(mes), desde: null, hacia: null, sale: null, entra: null, detalle: '' }); } }, [abierto, form, mes]);

  const guardar = async () => {
    const v = await form.validateFields();
    try {
      await enviar('transferencias', 'POST', {
        mes, fecha: v.fecha, detalle: v.detalle || null, desde_cuenta_id: v.desde, importe_desde: aCentavos(v.sale),
        hacia_cuenta_id: v.hacia, importe_hacia: aCentavos(mismaMoneda ? v.sale : v.entra),
      });
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const opciones = cuentas.filter((c) => c.activo).map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda})` }));
  return (
    <Modal open={abierto} title={`Transferencia entre cuentas · ${mes}`} okText="Guardar" cancelText="Cancelar"
      onOk={guardar} onCancel={() => alCerrar(false)} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="Fecha" name="fecha" rules={[{ required: true }]}><Input type="date" style={{ width: 180 }} /></Form.Item>
        <Space wrap align="start">
          <Form.Item label="Sale de" name="desde" rules={[{ required: true }]} style={{ minWidth: 220 }}><Select options={opciones} /></Form.Item>
          <Form.Item label={`Importe${desde ? ` ${desde.moneda}` : ''}`} name="sale" rules={[{ required: true }]}><InputNumber {...entradaPlata} min={0.01} prefix={simbolo(desde?.moneda)} style={{ width: 180 }} /></Form.Item>
        </Space>
        <Space wrap align="start">
          <Form.Item label="Entra a" name="hacia" rules={[{ required: true }]} style={{ minWidth: 220 }}><Select options={opciones} /></Form.Item>
          {!mismaMoneda && (
            <Form.Item label={`Importe${hacia ? ` ${hacia.moneda}` : ''}`} name="entra" rules={[{ required: true }]} extra="Compra o venta de dólares: lo que entra en la otra moneda.">
              <InputNumber {...entradaPlata} min={0.01} prefix={simbolo(hacia?.moneda)} style={{ width: 180 }} />
            </Form.Item>
          )}
        </Space>
        <Form.Item label="Detalle" name="detalle"><Input /></Form.Item>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function Movimientos() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [mes, setMes] = useState<string>();
  const [movimientos, setMovimientos] = useState<Movimiento[]>();
  const [deptos, setDeptos] = useState<string[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [conceptos, setConceptos] = useState<string[]>([]);
  const [filtroDepto, setFiltroDepto] = useState<string>();
  const [verAnulados, setVerAnulados] = useState(false);
  const [texto, setTexto] = useState('');
  const [form, setForm] = useState<{ editando?: Movimiento } | null>(null);
  const [transferencia, setTransferencia] = useState(false);
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    get<Periodo[]>('periodos').then((ps) => { setPeriodos(ps); setMes((ps.find((p) => p.estado === 'abierto') ?? ps[0])?.mes); });
    get<{ codigo: string }[]>('deptos').then((ds) => setDeptos(ds.map((d) => d.codigo)));
  }, []);
  useEffect(() => {
    get<Cuenta[]>('cuentas').then(setCuentas);
    get<{ nombre: string }[]>('conceptos').then((cs) => setConceptos(cs.map((c) => c.nombre)));
    if (mes) get<Movimiento[]>(`movimientos?mes=${mes}`).then(setMovimientos, (e) => setError(String(e)));
  }, [mes, version]);

  const abierto = periodos.find((p) => p.mes === mes)?.estado === 'abierto';
  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (movimientos ?? []).filter((m) =>
      (verAnulados || m.estado === 'vigente')
      && (!filtroDepto || (filtroDepto === EMPRESA ? m.depto === null : m.depto === filtroDepto))
      && (!t || [m.concepto, m.detalle, m.cuenta].some((c) => c?.toLowerCase().includes(t))));
  }, [movimientos, verAnulados, filtroDepto, texto]);
  const total = visibles.filter((m) => m.estado === 'vigente').reduce((s, m) => ({ ars: s.ars + m.importe_ars, usd: s.usd + m.importe_usd }), { ars: 0, usd: 0 });

  const anular = async (m: Movimiento) => {
    try {
      await enviar(`movimientos/${m.id}/anular`, 'POST', {});
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const alCerrar = (guardado: boolean) => { setForm(null); setTransferencia(false); if (guardado) setVersion((v) => v + 1); };

  const columnas: TableColumnsType<Movimiento> = [
    { title: 'Fecha', dataIndex: 'fecha', ...derecha, align: 'left' },
    { title: 'Depto', dataIndex: 'depto', render: (v: string | null) => v ?? <Typography.Text type="secondary">INT</Typography.Text> },
    { title: 'Tipo', dataIndex: 'tipo', render: (v: string) => <Tag color={COLOR_TIPO[v]}>{TIPOS[v] ?? v}</Tag> },
    { title: 'Concepto', dataIndex: 'concepto' },
    { title: 'Detalle', dataIndex: 'detalle', ellipsis: true },
    { title: 'ARS', dataIndex: 'importe_ars', ...derecha, render: (v: number) => importe(v) },
    { title: 'USD', dataIndex: 'importe_usd', ...derecha, render: (v: number) => importe(v, 'USD') },
    { title: 'Cuenta', dataIndex: 'cuenta' },
    {
      title: '', key: 'acciones', ...derecha,
      render: (_: unknown, m) => m.estado !== 'vigente' ? <Tag>anulado</Tag> : abierto && (
        <Space size="small">
          {m.tipo !== 'liquidacion' && m.tipo !== 'transferencia' && <Button size="small" onClick={() => setForm({ editando: m })}>Editar</Button>}
          <Popconfirm title={m.transferencia_grupo ? 'Se anulan las dos partes de la transferencia.' : 'El movimiento queda anulado (no se borra).'}
            okText="Anular" cancelText="No" onConfirm={() => anular(m)}>
            <Button size="small" danger>Anular</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Select style={{ width: 160 }} value={mes} onChange={setMes}
            options={periodos.map((p) => ({ value: p.mes, label: `${p.mes} · ${p.estado}` }))} />
          <Select style={{ width: 180 }} allowClear placeholder="Todos los deptos" value={filtroDepto} onChange={setFiltroDepto}
            options={[{ value: EMPRESA, label: 'Empresa (INT)' }, ...deptos.map((d) => ({ value: d, label: d }))]} />
          <Input.Search allowClear placeholder="Buscar concepto, detalle o cuenta" style={{ width: 260 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <Space><Switch size="small" checked={verAnulados} onChange={setVerAnulados} /> Ver anulados</Space>
          <Button type="primary" disabled={!abierto} onClick={() => setForm({})}>Nuevo movimiento</Button>
          <Button disabled={!abierto} onClick={() => setTransferencia(true)}>Transferencia entre cuentas</Button>
        </Space>
      </Card>
      {!abierto && mes && <Alert type="info" showIcon title={`El período ${mes} está cerrado: solo lectura.`} />}
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<Movimiento> rowKey="id" size="small" pagination={false} sticky scroll={{ x: 'max-content' }} loading={!movimientos}
        dataSource={visibles} columns={columnas}
        rowClassName={(m) => (m.estado === 'vigente' ? '' : 'ant-typography-secondary')}
        summary={() => visibles.length ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={5}><b>Total ({visibles.filter((m) => m.estado === 'vigente').length} movimientos)</b></Table.Summary.Cell>
            <Table.Summary.Cell index={5} align="right"><b>{pesos(total.ars)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={6} align="right"><b>{pesos(total.usd, 'USD')}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={7} colSpan={2} />
          </Table.Summary.Row>
        ) : null} />
      {mes && <FormMovimiento abierto={!!form} mes={mes} editando={form?.editando} deptos={deptos} cuentas={cuentas} conceptos={conceptos} alCerrar={alCerrar} />}
      {mes && <FormTransferencia abierto={transferencia} mes={mes} cuentas={cuentas} alCerrar={alCerrar} />}
    </Space>
  );
}
