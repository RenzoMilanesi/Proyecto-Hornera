// Hornera → Vencimientos (plan 049): lo que vence en el mes de los servicios que paga Hornera (server/ficha.ts).
// Pagado = ya hay un gasto del depto con ese concepto en el mes, cargado en Movimientos.
import { useEffect, useState } from 'react';
import { Alert, Input, Segmented, Space, Table, Tag, Typography } from 'antd';
import { get } from './api.ts';

interface Vencimiento { servicio_id: number; codigo: string; depto: string; concepto: string; cuenta: string | null; vence: string; estado: 'pagado' | 'pendiente' | 'vencido' }

const ESTADOS = { vencido: { label: 'Vencido', color: 'red' }, pendiente: { label: 'Pendiente', color: 'orange' }, pagado: { label: 'Pagado', color: 'green' } };

export function Vencimientos() {
  const [mes, setMes] = useState(() => new Date().toLocaleDateString('sv').slice(0, 7));
  const [filas, setFilas] = useState<Vencimiento[]>();
  const [error, setError] = useState<string>();
  const [ver, setVer] = useState<'faltan' | 'todos'>('faltan');
  useEffect(() => {
    setFilas(undefined);
    get<Vencimiento[]>(`vencimientos?mes=${mes}`).then(setFilas, (e) => setError(String(e)));
  }, [mes]);

  if (error) return <Alert type="error" showIcon title={error} />;
  const faltan = (filas ?? []).filter((f) => f.estado !== 'pagado');
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size="middle">
        <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
        <Segmented value={ver} onChange={setVer} options={[{ value: 'faltan', label: `Por pagar (${faltan.length})` }, { value: 'todos', label: `Todos (${filas?.length ?? 0})` }]} />
        <Typography.Text type="secondary">Se cargan en Deptos → Ficha. Se dan por pagados al cargar el gasto en Movimientos.</Typography.Text>
      </Space>
      <Table<Vencimiento> rowKey="servicio_id" size="small" pagination={false} sticky loading={!filas} dataSource={ver === 'faltan' ? faltan : filas}
        locale={{ emptyText: ver === 'faltan' ? 'No falta pagar nada este mes.' : 'No vence nada este mes.' }} columns={[
          { title: 'Vence', dataIndex: 'vence', width: 110, render: (v: string) => v.split('-').reverse().join('/') },
          { title: 'Depto', dataIndex: 'codigo', width: 220, render: (v: string, f) => <><b>{v}</b> · {f.depto}</> },
          { title: 'Concepto', dataIndex: 'concepto' },
          { title: 'N° de cuenta', dataIndex: 'cuenta', render: (v: string | null) => v && <Typography.Text copyable>{v}</Typography.Text> },
          { title: 'Estado', dataIndex: 'estado', width: 120, render: (v: Vencimiento['estado']) => <Tag color={ESTADOS[v].color}>{ESTADOS[v].label}</Tag> },
        ]} />
    </Space>
  );
}
