// Gastos personales (plan 047): lo del Excel de gastos varios que no es de Hornera. No entra en liquidaciones,
// cuentas ni en el resultado. Los compartidos (CAY/LAU) se parten mitad y mitad entre Amancay y Lautaro.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Switch, Table, Tag, Typography } from 'antd';
import { mesVisto } from './Asistente.tsx';
import type { TableColumnsType } from 'antd';
import { entradaPlata, enviar, get, pesos, useUnaVez } from './api.ts';

interface Periodo { mes: string; estado: string }
export interface GastoAjeno { id: number; fecha: string; codigo: string; descripcion: string | null; importe: number; estado: string }
interface Listado { gastos: GastoAjeno[]; totales: { porCodigo: Record<string, number>; amancay: number; lautaro: number } }

export const NOMBRES: Record<string, string> = {
  CAY: 'Amancay', LAU: 'Lautaro', 'CAY/LAU': 'Compartidos', CASEST: 'Casa del Estudiante', CASA: 'Casa',
};
const COLOR: Record<string, string> = { CAY: 'magenta', LAU: 'blue', 'CAY/LAU': 'purple', CASEST: 'gold', CASA: 'green' };
const opciones = Object.entries(NOMBRES).map(([c, n]) => ({ value: c, label: `${c} · ${n}` }));
const fechaPorDefecto = (mes: string) => {
  const hoy = new Date().toLocaleDateString('sv-SE');
  return hoy.startsWith(mes) ? hoy : `${mes}-01`;
};
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };

// `inicial`: uno nuevo ya completo (tarjeta del asistente, plan 068).
export function FormGastoAjeno({ abierto, mes, editando, inicial, alCerrar }: {
  abierto: boolean; mes: string; editando?: GastoAjeno; inicial?: Partial<GastoAjeno>; alCerrar: (guardado: boolean) => void;
}) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!abierto) return;
    setError(undefined);
    const g = editando ?? (inicial as GastoAjeno | undefined);
    form.setFieldsValue(g
      ? { fecha: g.fecha, codigo: g.codigo, descripcion: g.descripcion ?? '', importe: g.importe / 100 }
      : { fecha: fechaPorDefecto(mes), codigo: undefined, descripcion: '', importe: null });
  }, [abierto, editando, inicial, form, mes]);

  const guardar = async () => {
    const v = await form.validateFields();
    const datos = { fecha: v.fecha, codigo: v.codigo, descripcion: v.descripcion || null, importe: Math.round(v.importe * 100) };
    try {
      if (editando) await enviar(`gastos-ajenos/${editando.id}`, 'PUT', datos);
      else await enviar('gastos-ajenos', 'POST', datos);
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [guardarUnaVez, guardando] = useUnaVez(guardar);

  return (
    <Modal open={abierto} title={editando ? `Editar gasto de ${NOMBRES[editando.codigo]}` : `Nuevo gasto personal · ${mes}`}
      okText="Guardar" cancelText="Cancelar" onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} width={560} destroyOnHidden>
      {editando && (
        <dl className="ficha">
          <dt>Mes</dt><dd><b>{mes}</b></dd>
          <dt>Gasto</dt><dd><Tag color={COLOR[editando.codigo]}>{editando.codigo}</Tag> {pesos(editando.importe)}</dd>
        </dl>
      )}
      <Form form={form} layout="vertical">
        <Typography.Text strong>De quién es</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
          No es de Hornera: no entra en liquidaciones ni en el resultado. CAY/LAU se parte mitad y mitad.
        </Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Código" name="codigo" rules={[{ required: true, message: 'Elegí de quién es' }]}>
              <Select options={opciones} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Fecha" name="fecha" rules={[{ required: true, message: 'Falta la fecha' }]}><Input type="date" style={{ width: '100%' }} /></Form.Item>
          </Col>
        </Row>
        <Form.Item label="Descripción" name="descripcion"><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Importe" name="importe" rules={[{ required: true, message: 'Falta el importe' }, { type: 'number', min: 0.01, message: 'Mayor que 0' }]}>
              <InputNumber {...entradaPlata} prefix="$" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function GastosAjenos() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [mes, setMes] = useState<string>();
  mesVisto.valor = mes ?? ''; // para el asistente
  const [listado, setListado] = useState<Listado>();
  const [codigo, setCodigo] = useState<string>();
  const [verAnulados, setVerAnulados] = useState(false);
  const [form, setForm] = useState<{ editando?: GastoAjeno } | null>(null);
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    get<Periodo[]>('periodos').then((ps) => {
      setPeriodos(ps);
      setMes((ps.find((p) => p.estado === 'abierto') ?? ps[0])?.mes);
    }, (e) => setError(String(e)));
  }, []);
  useEffect(() => { if (mes) get<Listado>(`gastos-ajenos?mes=${mes}`).then(setListado, (e) => setError(String(e))); }, [mes, version]);

  const abierto = periodos.find((p) => p.mes === mes)?.estado === 'abierto';
  const visibles = useMemo(() => (listado?.gastos ?? []).filter((g) => (verAnulados || g.estado === 'vigente') && (!codigo || g.codigo === codigo)),
    [listado, verAnulados, codigo]);
  const total = visibles.filter((g) => g.estado === 'vigente').reduce((s, g) => s + g.importe, 0);
  const t = listado?.totales;

  const anular = async (g: GastoAjeno) => {
    try {
      await enviar(`gastos-ajenos/${g.id}/anular`, 'POST', {});
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const alCerrar = (guardado: boolean) => { setForm(null); if (guardado) setVersion((v) => v + 1); };

  const columnas: TableColumnsType<GastoAjeno> = [
    { title: 'Fecha', dataIndex: 'fecha', ...derecha, align: 'left' },
    { title: 'Código', dataIndex: 'codigo', render: (c: string) => <Tag color={COLOR[c]}>{c} · {NOMBRES[c]}</Tag> },
    { title: 'Descripción', dataIndex: 'descripcion', ellipsis: true },
    { title: 'Importe', dataIndex: 'importe', ...derecha, render: (v: number) => pesos(v) },
    {
      title: '', key: 'acciones', ...derecha,
      render: (_: unknown, g) => g.estado !== 'vigente' ? <Tag>anulado</Tag> : abierto && (
        <Space size="small">
          <Button size="small" onClick={() => setForm({ editando: g })}>Editar</Button>
          <Popconfirm title="El gasto queda anulado (no se borra)." okText="Anular" cancelText="No" onConfirm={() => anular(g)}>
            <Button size="small" danger>Anular</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col span={6}><Card size="small"><Statistic title="Amancay" value={t ? pesos(t.amancay) : '—'} />
          {t && <Typography.Text type="secondary">propios {pesos(t.porCodigo.CAY)} + mitad de compartidos {pesos(t.amancay - t.porCodigo.CAY)}</Typography.Text>}</Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Lautaro" value={t ? pesos(t.lautaro) : '—'} />
          {t && <Typography.Text type="secondary">propios {pesos(t.porCodigo.LAU)} + mitad de compartidos {pesos(t.lautaro - t.porCodigo.LAU)}</Typography.Text>}</Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Casa del Estudiante" value={t ? pesos(t.porCodigo.CASEST) : '—'} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Casa" value={t ? pesos(t.porCodigo.CASA) : '—'} /></Card></Col>
      </Row>
      <Card size="small">
        <Space wrap size="large">
          <Select style={{ width: 160 }} value={mes} onChange={setMes}
            options={periodos.map((p) => ({ value: p.mes, label: `${p.mes} · ${p.estado}` }))} />
          <Select style={{ width: 220 }} allowClear placeholder="Todos los códigos" value={codigo} onChange={setCodigo} options={opciones} />
          <Space><Switch size="small" checked={verAnulados} onChange={setVerAnulados} /> Ver anulados</Space>
          <Button type="primary" disabled={!abierto} onClick={() => setForm({})}>Nuevo gasto</Button>
        </Space>
      </Card>
      {!abierto && mes && <Alert type="info" showIcon title={`El período ${mes} está cerrado: solo lectura.`} />}
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<GastoAjeno> rowKey="id" size="small" pagination={false} sticky loading={!!mes && !listado && !error}
        dataSource={visibles} columns={columnas}
        rowClassName={(g) => (g.estado === 'vigente' ? '' : 'ant-typography-secondary')}
        summary={() => visibles.length ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}><b>Total ({visibles.filter((g) => g.estado === 'vigente').length} gastos)</b></Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right"><b>{pesos(total)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={4} />
          </Table.Summary.Row>
        ) : null} />
      {mes && <FormGastoAjeno abierto={!!form} mes={mes} editando={form?.editando} alCerrar={alCerrar} />}
    </Space>
  );
}
