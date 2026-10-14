// Propietarios: buscador, filtro de los que no tienen CBU y sus deptos.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, Segmented, Space, Table, Tag, Typography } from 'antd';
import { get } from './api.ts';

interface Propietario { id: number; nombre: string; moneda_liquidacion: string; tiene_cbu: number; deptos: string | null }

export function Propietarios() {
  const [filas, setFilas] = useState<Propietario[]>();
  const [error, setError] = useState<string>();
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState('todos');
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
      ]} />
    </Space>
  );
}
