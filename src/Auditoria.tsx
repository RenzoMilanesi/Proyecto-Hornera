// Herramientas → Auditoría: quién (qué PC) cambió qué en el mes, con lo que cambió (server/auditoria.ts).
import { useEffect, useState } from 'react';
import { Alert, Card, Input, Select, Space, Table } from 'antd';
import type { FilaAuditoria } from '../server/auditoria.ts';
import { get } from './api.ts';

const unicos = (filas: FilaAuditoria[], f: (x: FilaAuditoria) => string) => [...new Set(filas.map(f))].sort().map((v) => ({ value: v, label: v }));

export function Auditoria() {
  const [mes, setMes] = useState(() => new Date().toLocaleDateString('sv').slice(0, 7));
  const [filas, setFilas] = useState<FilaAuditoria[]>();
  const [pc, setPc] = useState<string>();
  const [tipo, setTipo] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setFilas(undefined);
    get<FilaAuditoria[]>(`auditoria?mes=${mes}`).then(setFilas, (e) => setError(String(e)));
  }, [mes]);

  const visibles = filas?.filter((f) => (!pc || f.pc === pc) && (!tipo || f.tipo === tipo));
  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
          <Select allowClear placeholder="Todas las PCs" style={{ width: 180 }} value={pc} onChange={setPc} options={unicos(filas ?? [], (f) => f.pc)} />
          <Select allowClear placeholder="Todos los tipos" style={{ width: 200 }} value={tipo} onChange={setTipo} options={unicos(filas ?? [], (f) => f.tipo)} />
        </Space>
      </Card>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<FilaAuditoria> rowKey="id" size="small" sticky tableLayout="fixed" loading={!filas && !error} dataSource={visibles}
        pagination={{ pageSize: 100, hideOnSinglePage: true }} locale={{ emptyText: 'No hubo cambios en este mes.' }} columns={[
          { title: 'Fecha', dataIndex: 'fecha', width: 150, render: (v: string) => new Date(v.replace(' ', 'T')).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) },
          { title: 'Quién', dataIndex: 'pc', width: 130 },
          { title: 'Qué', key: 'que', width: 240, render: (_: unknown, f) => f.referencia ? <>{f.tipo}<br /><span style={{ opacity: 0.65 }}>{f.referencia}</span></> : f.tipo },
          { title: 'Acción', dataIndex: 'accion', width: 110 },
          { title: 'Qué cambió', dataIndex: 'cambios' },
        ]} />
    </Space>
  );
}
