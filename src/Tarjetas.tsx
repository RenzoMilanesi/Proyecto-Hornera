// Tarjetas: el resumen de Galicia (Visa o Mastercard, PDF) contra los gastos. Es un control: cada consumo queda con el
// gasto que lo incluye (varios pueden ir a uno, como "Uber" del Excel), con un gasto personal o ignorado con motivo.
// Los que faltan se cargan desde acá ya vinculados, así no se cuentan dos veces.
import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Switch, Table, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import { entradaPlata, enviar, fecha, get, pesos, subirArchivo, useUnaVez } from './api.ts';
import { NOMBRES } from './GastosAjenos.tsx';

interface Resumen { id: number; tarjeta: string; numero: string; cierre: string; consumos: number; pendientes: number }
interface Consumo {
  id: number; fecha: string; detalle: string; cuota: string | null; titular: string | null; importe_ars: number; importe_usd: number;
  estado: 'gasto' | 'personal' | 'ignorado' | 'pendiente'; ignorado: string | null; destino: string | null; destino_importe: number | null;
  movimiento_id: number | null; gasto_ajeno_id: number | null;
}
interface Gasto { tipo: 'mov' | 'ajeno'; id: number; fecha: string; codigo: string; descripcion: string; importe: number; vinculado: number }
interface Detalle { id: number; tarjeta: string; numero: string; cierre: string; consumos: Consumo[]; gastos: Gasto[] }
interface Reporte { resumen_id: number; consumos: number; vinculados: number; yaEstaba: boolean; aviso: string | null }

const ESTADOS: Record<Consumo['estado'], { texto: string; color: string }> = {
  gasto: { texto: 'con gasto', color: 'green' }, personal: { texto: 'personal', color: 'purple' },
  ignorado: { texto: 'ignorado', color: 'default' }, pendiente: { texto: 'pendiente', color: 'orange' },
};
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const importe = (c: { importe_ars: number; importe_usd: number }) =>
  [c.importe_ars ? pesos(c.importe_ars) : '', c.importe_usd ? pesos(c.importe_usd, 'USD') : ''].filter(Boolean).join(' + ');
const suma = (cs: Consumo[]) => ({ importe_ars: cs.reduce((s, c) => s + c.importe_ars, 0), importe_usd: cs.reduce((s, c) => s + c.importe_usd, 0) });

type Accion = 'vincular' | 'cargar' | 'ignorar';

export function Tarjetas() {
  const [resumenes, setResumenes] = useState<Resumen[]>([]);
  const [id, setId] = useState<number>();
  const [detalle, setDetalle] = useState<Detalle>();
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [buscar, setBuscar] = useState('');
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'success' | 'warning'; texto: string }>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    get<Resumen[]>('tarjeta').then((rs) => { setResumenes(rs); setId((v) => v ?? rs[0]?.id); }, (e) => setError(String(e)));
  }, [version]);
  useEffect(() => { if (id) get<Detalle>(`tarjeta/${id}`).then(setDetalle, (e) => setError(String(e))); }, [id, version]);
  useEffect(() => setElegidos([]), [id, version, soloPendientes, buscar]);

  const recargar = () => setVersion((v) => v + 1);
  const fallar = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const importar = async (archivo: File) => {
    setSubiendo(true);
    setError(undefined);
    setAviso(undefined);
    try {
      const r = await subirArchivo<Reporte>('tarjeta/importar', archivo);
      setId(r.resumen_id);
      setAviso(r.yaEstaba
        ? { tipo: 'warning', texto: 'Ese resumen ya estaba importado: no se cambió nada.' }
        : { tipo: r.aviso ? 'warning' : 'success', texto: `${r.consumos} consumos leídos; ${r.vinculados} vinculados solos a su gasto.${r.aviso ? ` ${r.aviso}` : ''}` });
      recargar();
    } catch (e) {
      fallar(e);
    } finally {
      setSubiendo(false);
    }
  };
  const cruzar = async () => {
    try {
      const r = await enviar<{ vinculados: number }>(`tarjeta/${id}/cruzar`, 'POST', {});
      setAviso({ tipo: 'success', texto: r.vinculados ? `${r.vinculados} consumos vinculados a su gasto.` : 'No apareció ningún gasto nuevo para vincular solo.' });
      recargar();
    } catch (e) { fallar(e); }
  };
  const desvincular = async (ids: number[]) => {
    try { await enviar('tarjeta/desvincular', 'POST', { consumos: ids }); recargar(); } catch (e) { fallar(e); }
  };

  const consumos = detalle?.consumos ?? [];
  const visibles = useMemo(() => consumos.filter((c) => (!soloPendientes || c.estado === 'pendiente')
    && (!buscar || `${c.detalle} ${c.titular ?? ''}`.toLowerCase().includes(buscar.toLowerCase()))), [consumos, soloPendientes, buscar]);
  const seleccion = consumos.filter((c) => elegidos.includes(c.id));
  const total = (estado?: Consumo['estado']) => suma(consumos.filter((c) => !estado || c.estado === estado));

  const columnas: TableColumnsType<Consumo> = [
    { title: 'Fecha', dataIndex: 'fecha', render: fecha, ...derecha, align: 'left' },
    { title: 'Estado', dataIndex: 'estado', render: (e: Consumo['estado']) => <Tag color={ESTADOS[e].color}>{ESTADOS[e].texto}</Tag> },
    { title: 'Consumo', dataIndex: 'detalle', render: (d: string, c) => <>{d}{c.cuota && <Typography.Text type="secondary"> · cuota {c.cuota}</Typography.Text>}</> },
    { title: 'Importe', key: 'importe', ...derecha, render: (_: unknown, c) => importe(c) },
    { title: 'Tarjeta de', dataIndex: 'titular', render: (t: string | null) => t ?? <Typography.Text type="secondary">—</Typography.Text> },
    {
      title: 'Va en', key: 'destino', ellipsis: true,
      render: (_: unknown, c) => c.estado === 'ignorado' ? <Typography.Text type="secondary">{c.ignorado}</Typography.Text>
        : c.destino && <>{c.destino} · {pesos(c.destino_importe ?? 0)}</>,
    },
    {
      title: '', key: 'acciones', ...derecha,
      render: (_: unknown, c) => c.estado !== 'pendiente' && <Button size="small" onClick={() => desvincular([c.id])}>Desvincular</Button>,
    },
  ];

  const tarjetaStat = (titulo: string, estado?: Consumo['estado']) => {
    const t = total(estado);
    const n = consumos.filter((c) => !estado || c.estado === estado).length;
    return (
      <Col flex={1}><Card size="small"><Statistic title={`${titulo} (${n})`} value={detalle ? pesos(t.importe_ars) : '—'} />
        {t.importe_usd !== 0 && <Typography.Text type="secondary">+ {pesos(t.importe_usd, 'USD')}</Typography.Text>}</Card></Col>
    );
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Select style={{ width: 340 }} value={id} onChange={setId} placeholder="Todavía no hay resúmenes importados"
            options={resumenes.map((r) => ({ value: r.id, label: `${r.tarjeta} · cierre ${fecha(r.cierre)} · ${r.pendientes} pendientes` }))} />
          <Upload accept=".pdf" showUploadList={false} disabled={subiendo} beforeUpload={(a) => { importar(a); return false; }}>
            <Button type="primary" loading={subiendo}>Importar resumen (PDF)</Button>
          </Upload>
          <Button disabled={!id} onClick={cruzar}>Cruzar de nuevo</Button>
          <Input.Search allowClear placeholder="Buscar consumo (ej. UBER)" style={{ width: 240 }} onSearch={setBuscar} onChange={(e) => !e.target.value && setBuscar('')} />
          <Space><Switch size="small" checked={soloPendientes} onChange={setSoloPendientes} /> Solo pendientes</Space>
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          El resumen no carga gastos: se cruza con los del Excel. Cada consumo en pesos se vincula solo con un gasto del mismo importe;
          los sumados en el Excel (Uber, viandas) y los de dólares se eligen y se vinculan a mano. Después de importar el Excel de gastos, "Cruzar de nuevo".
        </Typography.Paragraph>
      </Card>
      {aviso && <Alert type={aviso.tipo} showIcon closable title={aviso.texto} onClose={() => setAviso(undefined)} />}
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      {detalle && (
        <Row gutter={16}>
          {tarjetaStat('Total del resumen')}
          {tarjetaStat('Con gasto', 'gasto')}
          {tarjetaStat('Personales', 'personal')}
          {tarjetaStat('Ignorados', 'ignorado')}
          {tarjetaStat('Pendientes', 'pendiente')}
        </Row>
      )}
      {seleccion.length > 0 && (
        <Card size="small">
          <Space wrap>
            <Typography.Text strong>{seleccion.length} elegidos · {importe(suma(seleccion))}</Typography.Text>
            <Button onClick={() => setAccion('vincular')}>Vincular a un gasto</Button>
            <Button onClick={() => setAccion('cargar')}>Cargar como gasto</Button>
            <Button onClick={() => setAccion('ignorar')}>Ignorar</Button>
            {seleccion.some((c) => c.estado !== 'pendiente') && <Button onClick={() => desvincular(elegidos)}>Desvincular</Button>}
          </Space>
        </Card>
      )}
      {id && (
        <Table<Consumo> rowKey="id" size="small" pagination={false} sticky scroll={{ x: 'max-content' }} loading={!detalle && !error}
          dataSource={visibles} columns={columnas}
          rowSelection={{ selectedRowKeys: elegidos, onChange: (ks) => setElegidos(ks as number[]) }} />
      )}
      {detalle && (
        <AccionConsumos accion={accion} consumos={seleccion} detalle={detalle}
          alCerrar={(hecho) => { setAccion(null); if (hecho) recargar(); }} />
      )}
    </Space>
  );
}

function AccionConsumos({ accion, consumos, detalle, alCerrar }: {
  accion: Accion | null; consumos: Consumo[]; detalle: Detalle; alCerrar: (hecho: boolean) => void;
}) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  const [codigos, setCodigos] = useState<{ value: string; label: string }[]>([]);
  const [conceptos, setConceptos] = useState<string[]>([]);
  const t = suma(consumos);
  const gastoElegido: string | undefined = Form.useWatch('gasto', form);

  useEffect(() => {
    if (!accion) return;
    setError(undefined);
    form.resetFields();
    form.setFieldsValue({ importe: t.importe_usd ? null : t.importe_ars / 100, concepto: 'Gastos varios', codigo: 'INT' });
    if (accion === 'cargar') {
      Promise.all([get<{ codigo: string; nombre: string }[]>('deptos'), get<{ nombre: string }[]>('conceptos')]).then(([ds, cs]) => {
        setCodigos([
          { value: 'INT', label: 'INT · Hornera' },
          ...Object.entries(NOMBRES).map(([c, n]) => ({ value: c, label: `${c} · ${n} (personal)` })),
          ...ds.map((d) => ({ value: d.codigo, label: `${d.codigo} · ${d.nombre}` })),
        ]);
        setConceptos(cs.map((c) => c.nombre));
      }, (e) => setError(String(e)));
    }
  }, [accion]); // eslint-disable-line react-hooks/exhaustive-deps

  const gasto = detalle.gastos.find((g) => `${g.tipo}:${g.id}` === gastoElegido);
  const guardar = async () => {
    const v = await form.validateFields();
    const ids = consumos.map((c) => c.id);
    try {
      if (accion === 'vincular') {
        const [tipo, gid] = String(v.gasto).split(':');
        await enviar('tarjeta/vincular', 'POST', { consumos: ids, [tipo === 'mov' ? 'movimiento_id' : 'gasto_ajeno_id']: Number(gid) });
      } else if (accion === 'cargar') {
        await enviar('tarjeta/cargar', 'POST', { consumos: ids, codigo: v.codigo, concepto: v.concepto, detalle: v.detalle || null, importe: Math.round(v.importe * 100) });
      } else {
        await enviar('tarjeta/ignorar', 'POST', { consumos: ids, motivo: v.motivo });
      }
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [guardarUnaVez, guardando] = useUnaVez(guardar);
  const titulos: Record<Accion, [string, string]> = {
    vincular: ['Vincular consumos a un gasto', 'Vincular'], cargar: ['Cargar consumos como gasto', 'Cargar'], ignorar: ['Ignorar consumos', 'Ignorar'],
  };

  return (
    <Modal open={!!accion} title={accion && `${titulos[accion][0]} · ${detalle.tarjeta}`} okText={accion ? titulos[accion][1] : ''} cancelText="Cancelar"
      onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} width={560} destroyOnHidden>
      <dl className="ficha">
        <dt>Consumos</dt><dd><b>{consumos.length}</b> · {consumos.slice(0, 3).map((c) => c.detalle).join(', ')}{consumos.length > 3 ? '…' : ''}</dd>
        <dt>Suman</dt><dd><b>{importe(t)}</b></dd>
      </dl>
      <Form form={form} layout="vertical">
        {accion === 'vincular' && (
          <>
            <Typography.Text strong>Gasto que los incluye</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
              Gastos y gastos personales cerca del cierre. Si el gasto suma varios consumos (Uber), se pueden vincular en varias vueltas: se suman a los que ya tiene.
            </Typography.Paragraph>
            <Form.Item name="gasto" rules={[{ required: true, message: 'Elegí el gasto' }]}
              extra={gasto && !t.importe_usd && gasto.importe !== gasto.vinculado + t.importe_ars
                ? `Diferencia: ${pesos(gasto.importe - gasto.vinculado - t.importe_ars)} (el gasto contra sus consumos, contando estos).` : undefined}>
              <Select showSearch optionFilterProp="label" placeholder="Buscar por depto, descripción o importe" style={{ width: '100%' }}
                options={detalle.gastos.map((g) => ({ value: `${g.tipo}:${g.id}`, label: `${fecha(g.fecha)} · ${g.codigo} · ${g.descripcion} · ${pesos(g.importe)}${g.vinculado ? ` (ya tiene ${pesos(g.vinculado)})` : ''}` }))} />
            </Form.Item>
          </>
        )}
        {accion === 'cargar' && (
          <>
            <Typography.Text strong>Gasto nuevo</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
              Con depto se le descuenta al propietario; INT es de Hornera; CAY, LAU y los demás van a Gastos personales. Entra en el mes abierto.
            </Typography.Paragraph>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="De quién" name="codigo" rules={[{ required: true, message: 'Elegí a quién va' }]}>
                  <Select showSearch optionFilterProp="label" options={codigos} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Importe" name="importe" extra={t.importe_usd ? 'Hay consumos en dólares: el importe en pesos que se pagó.' : undefined}
                  rules={[{ required: true, message: 'Falta el importe' }, { type: 'number', min: 0.01, message: 'Mayor que 0' }]}>
                  <InputNumber {...entradaPlata} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Concepto" name="concepto"><AutoComplete options={conceptos.map((c) => ({ value: c }))} style={{ width: '100%' }} /></Form.Item>
            <Form.Item label="Detalle" name="detalle" extra="Vacío: el nombre de los consumos."><Input /></Form.Item>
          </>
        )}
        {accion === 'ignorar' && (
          <Form.Item label="Por qué no va como gasto" name="motivo" rules={[{ required: true, whitespace: true, message: 'Escribí el motivo' }]}
            extra="Ej.: devolución, comisión de Booking que ya descuenta la plataforma, intereses que van en otro gasto.">
            <Input />
          </Form.Item>
        )}
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}
