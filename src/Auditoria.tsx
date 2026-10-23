// Herramientas → Auditoría: quién (qué PC) cambió qué en el mes, con lo que cambió (server/auditoria.ts).
import { useEffect, useState } from 'react';
import { Alert, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { mesVisto } from './Asistente.tsx';
import type { FilaAuditoria } from '../server/auditoria.ts';
import { get } from './api.ts';

const COLORES: Record<string, string> = { Alta: 'green', Modificación: 'blue', Anulación: 'red', Importación: 'purple', Cierre: 'gold', Reapertura: 'orange' };

// "Importe $: $ 10 → $ 12 · Depto: AAA": cada dato con su rótulo atenuado, uno al lado del otro.
function Cambios({ texto }: { texto: string }) {
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 2 }}>
      {texto.split(' · ').map((parte, i) => {
        const corte = parte.indexOf(': ');
        return corte < 0 ? <span key={i}>{parte}</span> : (
          <span key={i}><Typography.Text type="secondary">{parte.slice(0, corte)}</Typography.Text> {parte.slice(corte + 2)}</span>
        );
      })}
    </span>
  );
}

const fecha = (v: string) => new Date(v.replace(' ', 'T')).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');

const unicos = (filas: FilaAuditoria[], f: (x: FilaAuditoria) => string) => [...new Set(filas.map(f))].sort().map((v) => ({ value: v, label: v }));

export function Auditoria() {
  const [mes, setMes] = useState(() => new Date().toLocaleDateString('sv').slice(0, 7));
  mesVisto.valor = mes ?? ''; // para el asistente
  const [filas, setFilas] = useState<FilaAuditoria[]>();
  const [pc, setPc] = useState<string>();
  const [tipo, setTipo] = useState<string>();
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    setFilas(undefined);
    get<FilaAuditoria[]>(`auditoria?mes=${mes}`).then(setFilas, (e) => setError(String(e)));
  }, [mes]);

  const t = texto.trim().toLowerCase();
  const visibles = filas?.filter((f) => (!pc || f.pc === pc) && (!tipo || f.tipo === tipo)
    && (!t || [f.tipo, f.referencia, f.cambios].some((c) => c?.toLowerCase().includes(t))));
  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
          <Input.Search allowClear placeholder="Buscar depto, reserva o dato" style={{ width: 260 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <Select allowClear placeholder="Todas las PCs" style={{ width: 180 }} value={pc} onChange={setPc} options={unicos(filas ?? [], (f) => f.pc)} />
          <Select allowClear placeholder="Todos los tipos" style={{ width: 200 }} value={tipo} onChange={setTipo} options={unicos(filas ?? [], (f) => f.tipo)} />
        </Space>
      </Card>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<FilaAuditoria> rowKey="id" size="small" sticky tableLayout="fixed" loading={!filas && !error} dataSource={visibles}
        pagination={{ pageSize: 100, hideOnSinglePage: true }} locale={{ emptyText: 'No hubo cambios en este mes.' }} columns={[
          { title: 'Fecha', dataIndex: 'fecha', width: 105, render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{fecha(v)}</span> },
          { title: 'Quién', dataIndex: 'pc', width: 120 },
          { title: 'Qué', key: 'que', width: 210, render: (_: unknown, f) => <><b>{f.tipo}</b>{f.referencia && <><br /><Typography.Text type="secondary">{f.referencia}</Typography.Text></>}</> },
          { title: 'Acción', dataIndex: 'accion', width: 125, render: (v: string) => <Tag color={COLORES[v]}>{v}</Tag> },
          { title: 'Qué cambió', dataIndex: 'cambios', render: (v: string) => <Cambios texto={v} /> },
        ]} />
    </Space>
  );
}
