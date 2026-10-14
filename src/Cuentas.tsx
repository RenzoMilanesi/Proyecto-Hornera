// Cuentas de la empresa con su saldo, y a qué cuenta entra cada medio de pago de Stays.
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Radio, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { enviar, get, pesos } from './api.ts';

interface Cuenta { id: number; nombre: string; moneda: 'ARS' | 'USD'; activo: number; saldo: number; saldo_desde: string | null }
const total = (cs: readonly Cuenta[], moneda: 'ARS' | 'USD') => cs.filter((c) => c.moneda === moneda).reduce((s, c) => s + c.saldo, 0);
interface Medio { id: number; nombre: string; tipo_stays: string; moneda: 'ARS' | 'USD'; descuenta_comision: number; cuenta_id: number | null; activo: number; pagos: number }

export function Cuentas() {
  const [cuentas, setCuentas] = useState<Cuenta[]>();
  const [medios, setMedios] = useState<Medio[]>();
  const [editando, setEditando] = useState<Cuenta>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const [nueva] = Form.useForm();
  const [edicion] = Form.useForm();

  useEffect(() => {
    get<Cuenta[]>('cuentas').then(setCuentas, (e) => setError(String(e)));
    get<Medio[]>('medios-pago').then(setMedios, (e) => setError(String(e)));
  }, [version]);
  useEffect(() => { if (editando) edicion.setFieldsValue({ nombre: editando.nombre, activo: !!editando.activo }); }, [editando, edicion]);

  const accion = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const cambiarMedio = (m: Medio, cambios: Partial<Medio>) => {
    const x = { ...m, ...cambios };
    // Si cambia la moneda, la cuenta anterior (de la otra moneda) deja de valer.
    if (cambios.moneda && cambios.moneda !== m.moneda) x.cuenta_id = null;
    accion(() => enviar(`medios-pago/${m.id}`, 'PUT', { cuenta_id: x.cuenta_id, moneda: x.moneda, descuenta_comision: x.descuenta_comision }));
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Card size="small" title="Cuentas">
        <Form form={nueva} layout="inline" style={{ marginBottom: 12 }} initialValues={{ moneda: 'ARS' }}
          onFinish={async (v) => { if (await accion(() => enviar('cuentas', 'POST', v))) nueva.resetFields(); }}>
          <Form.Item name="nombre" rules={[{ required: true, message: 'Falta el nombre' }]}><Input placeholder="Nueva cuenta" /></Form.Item>
          <Form.Item name="moneda"><Radio.Group optionType="button" options={['ARS', 'USD']} /></Form.Item>
          <Form.Item><Button htmlType="submit">Agregar</Button></Form.Item>
        </Form>
        <Table<Cuenta> rowKey="id" size="small" pagination={false} loading={!cuentas} dataSource={cuentas} columns={[
          { title: 'Cuenta', dataIndex: 'nombre', render: (v: string, c) => <>{v} {!c.activo && <Tag>de baja</Tag>}</> },
          { title: 'Moneda', dataIndex: 'moneda', width: 90, render: (v: string) => <Tag color={v === 'USD' ? 'green' : 'default'}>{v}</Tag> },
          { title: 'Saldo', dataIndex: 'saldo', align: 'right', render: (v: number, c) => <Typography.Text type={v < 0 ? 'danger' : undefined}>{pesos(v, c.moneda)}</Typography.Text> },
          { title: 'Desde', dataIndex: 'saldo_desde', render: (v: string | null) => (v ? v.split('-').reverse().join('/') : <Typography.Text type="secondary">sin saldo inicial</Typography.Text>) },
          { title: '', key: 'editar', width: 90, render: (_: unknown, c) => <Button size="small" onClick={() => setEditando(c)}>Editar</Button> },
        ]} summary={(filas) => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2}><b>Total</b></Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <b>{pesos(total(filas, 'ARS'))} · {pesos(total(filas, 'USD'), 'USD')}</b>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} colSpan={2} />
          </Table.Summary.Row>
        )} />
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          El saldo suma los movimientos con esa cuenta y lo cobrado en Stays por los medios de pago asociados (neto de comisión).
          El saldo de arranque se carga en Movimientos como "Saldo inicial", con la cuenta y sin depto (Empresa): desde esa fecha se suma todo lo demás (lo anterior ya está incluido en ese saldo).
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="Medios de pago de Stays">
        <Table<Medio> rowKey="id" size="small" pagination={false} loading={!medios} dataSource={medios} scroll={{ x: 'max-content' }} columns={[
          { title: 'Medio de pago', dataIndex: 'nombre', render: (v: string, m) => <>{v} {!m.activo && <Tag>inactivo</Tag>}</> },
          { title: 'Tipo en Stays', dataIndex: 'tipo_stays' },
          { title: 'Pagos', dataIndex: 'pagos', align: 'right' },
          {
            title: 'Moneda', dataIndex: 'moneda', render: (v: string, m) =>
              <Radio.Group size="small" optionType="button" value={v} options={['ARS', 'USD']} onChange={(e) => cambiarMedio(m, { moneda: e.target.value })} />,
          },
          {
            title: 'Descuenta comisión', dataIndex: 'descuenta_comision',
            render: (v: number, m) => <Switch size="small" checked={!!v} onChange={(x) => cambiarMedio(m, { descuenta_comision: x ? 1 : 0 })} />,
          },
          {
            title: 'Entra a la cuenta', dataIndex: 'cuenta_id', render: (v: number | null, m) => (
              <Select size="small" style={{ width: 200 }} allowClear placeholder="Sin cuenta" value={v ?? undefined}
                status={v == null && m.pagos ? 'warning' : undefined} onChange={(x) => cambiarMedio(m, { cuenta_id: x ?? null })}
                options={(cuentas ?? []).filter((c) => c.activo && c.moneda === m.moneda).map((c) => ({ value: c.id, label: c.nombre }))} />
            ),
          },
        ]} />
      </Card>

      <Modal open={!!editando} title={`Editar cuenta ${editando?.nombre ?? ''}`} okText="Guardar" cancelText="Cancelar" destroyOnHidden
        onCancel={() => setEditando(undefined)}
        onOk={async () => {
          const v = await edicion.validateFields();
          if (await accion(() => enviar(`cuentas/${editando!.id}`, 'PUT', { nombre: v.nombre, activo: v.activo ? 1 : 0 }))) setEditando(undefined);
        }}>
        <Form form={edicion} layout="vertical">
          <Form.Item label="Nombre" name="nombre" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Activa" name="activo" valuePropName="checked" extra="Una cuenta de baja no se ofrece para movimientos nuevos."><Switch /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
