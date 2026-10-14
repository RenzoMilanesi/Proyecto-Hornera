// Transferencias a propietarios de un mes cerrado: qué se le paga a cada uno, "marcar pagado"
// (genera el movimiento "Liquidacion periodo") y la lista para el banco en Excel.
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { Transferencia } from '../server/liquidacion/pagos.ts';
import { enviar, get, pesos } from './api.ts';

interface Periodo { mes: string; estado: string; fecha_pago: string }
interface Cuenta { id: number; nombre: string; moneda: 'ARS' | 'USD'; activo: number }
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };

function FormPago({ t, fecha, cuentas, alCerrar }: { t?: Transferencia; fecha: string; cuentas: Cuenta[]; alCerrar: (guardado: boolean) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (t) { setError(undefined); form.setFieldsValue({ cuenta_id: null, fecha, importe: t.pendiente / 100, detalle: 'Transferencia' }); }
  }, [t, fecha, form]);
  const guardar = async () => {
    const v = await form.validateFields();
    try {
      await enviar(`liquidaciones/${t!.liquidacionId}/pagar`, 'POST', { cuenta_id: v.cuenta_id ?? null, fecha: v.fecha, importe: Math.round(v.importe * 100), detalle: v.detalle });
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal open={!!t} title={t && `Pago de la liquidación de ${t.codigo}`} okText="Marcar pagado" cancelText="Cancelar" onOk={guardar}
      onCancel={() => alCerrar(false)} destroyOnHidden>
      {t && <Typography.Paragraph>{t.propietario} · CBU/CVU: {t.esHornera ? 'Nosotros' : (t.cbu ?? 'no informado')} · pendiente {pesos(t.pendiente, t.moneda)}</Typography.Paragraph>}
      <Form form={form} layout="vertical">
        <Space wrap align="start">
          <Form.Item label="Fecha" name="fecha" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item label={`Importe ${t?.moneda ?? ''}`} name="importe" rules={[{ required: true }, { type: 'number', min: 0.01, message: 'Mayor que 0' }]}
            extra="Menos que lo pendiente si se paga en partes."><InputNumber decimalSeparator="," style={{ width: 170 }} /></Form.Item>
        </Space>
        <Form.Item label="Sale de la cuenta" name="cuenta_id" extra="Vacío si no sale de una cuenta (por ejemplo, el depto propio).">
          <Select allowClear placeholder="Sin cuenta" options={cuentas.filter((c) => c.activo && c.moneda === t?.moneda).map((c) => ({ value: c.id, label: c.nombre }))} />
        </Form.Item>
        <Form.Item label="Detalle" name="detalle"><Input /></Form.Item>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function Transferencias() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [mes, setMes] = useState<string>();
  const [filas, setFilas] = useState<Transferencia[]>();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [pagando, setPagando] = useState<Transferencia>();
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    get<Periodo[]>('periodos').then((ps) => {
      const cerrados = ps.filter((p) => p.estado === 'cerrado');
      setPeriodos(cerrados);
      setMes(cerrados[0]?.mes);
    });
    get<Cuenta[]>('cuentas').then(setCuentas);
  }, []);
  useEffect(() => { if (mes) get<Transferencia[]>(`transferencias?mes=${mes}`).then(setFilas, (e) => setError(String(e))); }, [mes, version]);

  const anular = async (id: number) => {
    try {
      await enviar(`movimientos/${id}/anular`, 'POST', {});
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const exportar = async () => {
    const r = await fetch(`/api/transferencias/excel?mes=${mes}`);
    const enlace = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `transferencias-${mes}.xlsx` });
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  };

  const columnas: TableColumnsType<Transferencia> = [
    { title: 'Depto', dataIndex: 'codigo', width: 70, render: (v: string) => <b>{v}</b> },
    { title: 'Propietario', dataIndex: 'propietario', ellipsis: true },
    { title: 'CBU/CVU', key: 'cbu', render: (_: unknown, t) => (t.esHornera ? <Tag>Nosotros</Tag> : t.cbu ?? <Tag color="orange">no informado</Tag>) },
    { title: 'Saldo', key: 'saldo', ...derecha, render: (_: unknown, t) => <Typography.Text type={t.saldo < 0 ? 'danger' : undefined}>{pesos(t.saldo, t.moneda)}</Typography.Text> },
    { title: 'Pagado', key: 'pagado', ...derecha, render: (_: unknown, t) => (t.pagado ? pesos(t.pagado, t.moneda) : '') },
    {
      title: 'Pendiente', key: 'pendiente', ...derecha,
      render: (_: unknown, t) => (t.saldo < 0 ? <Tag color="red">debe</Tag> : t.pendiente === 0 ? <Tag color="green">pagado</Tag>
        : t.arrastradoA ? <Tag title="El saldo quedó como saldo anterior del mes siguiente, ya cerrado">pasó a {t.arrastradoA}</Tag> : <b>{pesos(t.pendiente, t.moneda)}</b>),
    },
    { title: '', key: 'pagar', ...derecha, render: (_: unknown, t) => t.pendiente > 0 && !t.arrastradoA && <Button size="small" type="primary" onClick={() => setPagando(t)}>Marcar pagado</Button> },
  ];
  const aPagar = (filas ?? []).filter((t) => t.pendiente > 0 && !t.arrastradoA);
  const totales = (moneda: 'ARS' | 'USD') => aPagar.filter((t) => t.moneda === moneda).reduce((s, t) => s + t.pendiente, 0);

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Select style={{ width: 160 }} value={mes} onChange={setMes} placeholder="Mes cerrado" options={periodos.map((p) => ({ value: p.mes, label: p.mes }))} />
          <Button disabled={!mes} onClick={exportar}>Exportar a Excel</Button>
          <Space><Switch size="small" checked={soloPendientes} onChange={setSoloPendientes} /> Solo pendientes</Space>
          {filas && <Typography.Text>Pendiente: <b>{pesos(totales('ARS'))}</b> · <b>{pesos(totales('USD'), 'USD')}</b> ({aPagar.length} deptos)</Typography.Text>}
        </Space>
      </Card>
      {!periodos.length && <Alert type="info" showIcon title="No hay meses cerrados: las transferencias salen al cerrar el mes en Liquidación." />}
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<Transferencia> rowKey="liquidacionId" size="small" pagination={false} sticky scroll={{ x: 'max-content' }} loading={!!mes && !filas}
        dataSource={soloPendientes ? aPagar : filas} columns={columnas}
        expandable={{
          rowExpandable: (t) => t.pagos.length > 0,
          expandedRowRender: (t) => (
            <Table size="small" pagination={false} rowKey="id" dataSource={t.pagos} columns={[
              { title: 'Fecha', dataIndex: 'fecha' },
              { title: 'Importe', dataIndex: 'importe', ...derecha, render: (v: number) => pesos(v, t.moneda) },
              { title: 'Cuenta', dataIndex: 'cuenta' },
              {
                title: '', key: 'anular', ...derecha, render: (_: unknown, p) => (
                  <Popconfirm title="El pago queda anulado (no se borra)." okText="Anular" cancelText="No" onConfirm={() => anular(p.id)}>
                    <Button size="small" danger>Anular</Button>
                  </Popconfirm>
                ),
              },
            ]} />
          ),
        }} />
      <FormPago t={pagando} fecha={periodos.find((p) => p.mes === mes)?.fecha_pago ?? ''} cuentas={cuentas}
        alCerrar={(guardado) => { setPagando(undefined); if (guardado) setVersion((v) => v + 1); }} />
    </Space>
  );
}
