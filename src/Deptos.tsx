// Deptos: buscador, filtro por estado y tabla con fotos (vienen de Stays, "traer mes").
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Image, Input, Segmented, Space, Table, Tag, Typography, theme } from 'antd';
import type { TableColumnsType } from 'antd';
import { get } from './api.ts';
import { Historial } from './Historial.tsx';

interface Depto { id: number; codigo: string; nombre: string; direccion: string | null; estado: string; comision_pct: number; propietario: string; fotos: string[] }

// Orden de la tabla y del filtro: lo operativo primero.
const estados: Record<string, { label: string; color: string }> = {
  activo: { label: 'Activo', color: 'green' },
  proximo: { label: 'Próximo', color: 'blue' },
  potencial: { label: 'Potencial', color: 'purple' },
  pausado: { label: 'Pausado', color: 'orange' },
  finalizado: { label: 'Finalizado', color: 'default' },
};
const rango = (e: string) => Object.keys(estados).indexOf(e);

// ponytail: todos los deptos son de Rosario; si aparece otra ciudad se ve completa.
const sinCiudad = (d: string | null) => d?.replace(/,\s*Rosario,?\s*(Santa|Sta\.?)\s*Fe\.?\s*$/i, '') ?? '';

function SinFoto() {
  const { token } = theme.useToken();
  return (
    <div style={{ width: 64, height: 48, borderRadius: 4, background: token.colorFillTertiary, display: 'grid', placeItems: 'center' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={token.colorTextQuaternary} strokeWidth="1.8" aria-hidden="true">
        <path d="M3 11 12 4l9 7M5 10v10h14V10" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

const columnas = (verHistorial: (d: Depto) => void): TableColumnsType<Depto> => [
  { title: 'Fotos', dataIndex: 'fotos', width: 88, render: (fotos: string[]) => fotos.length > 0 ? (
    <Image.PreviewGroup items={fotos}>
      <Image src={fotos[0]} width={64} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} alt="" />
    </Image.PreviewGroup>
  ) : <SinFoto /> },
  { title: 'Código', dataIndex: 'codigo', width: 90, render: (v: string) => <b>{v}</b>, sorter: (a, b) => a.codigo.localeCompare(b.codigo) },
  { title: 'Nombre', dataIndex: 'nombre', width: 200, ellipsis: true, sorter: (a, b) => a.nombre.localeCompare(b.nombre) },
  { title: 'Dirección', dataIndex: 'direccion', ellipsis: { showTitle: false }, render: (v: string | null) => <span title={v ?? ''}>{sinCiudad(v)}</span> },
  { title: 'Propietario', dataIndex: 'propietario', ellipsis: true, sorter: (a, b) => a.propietario.localeCompare(b.propietario) },
  { title: 'Comisión', dataIndex: 'comision_pct', width: 100, align: 'right', render: (v: number) => `${Math.round(v * 100)} %` },
  { title: 'Estado', dataIndex: 'estado', width: 120, render: (v: string) => <Tag color={estados[v]?.color}>{estados[v]?.label ?? v}</Tag>,
    sorter: (a, b) => rango(a.estado) - rango(b.estado) },
  { title: '', key: 'historial', width: 100, render: (_: unknown, d) => <Button size="small" onClick={() => verHistorial(d)}>Historial</Button> },
];

export function Deptos() {
  const [deptos, setDeptos] = useState<Depto[]>();
  const [error, setError] = useState<string>();
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState('todos');
  const [historial, setHistorial] = useState<Depto>();
  useEffect(() => {
    get<Depto[]>('deptos').then(setDeptos, (e) => setError(String(e)));
  }, []);

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (deptos ?? [])
      .filter((d) => estado === 'todos' || d.estado === estado)
      .filter((d) => !t || [d.codigo, d.nombre, d.direccion, d.propietario].some((c) => c?.toLowerCase().includes(t)))
      .sort((a, b) => rango(a.estado) - rango(b.estado) || a.codigo.localeCompare(b.codigo));
  }, [deptos, texto, estado]);

  const cuenta = (e: string) => (deptos ?? []).filter((d) => d.estado === e).length;
  const opciones = [
    { value: 'todos', label: `Todos (${deptos?.length ?? 0})` },
    ...Object.entries(estados).filter(([e]) => cuenta(e) > 0).map(([e, s]) => ({ value: e, label: `${s.label} (${cuenta(e)})` })),
  ];

  if (error) return <Alert type="error" title={error} />;
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size="middle">
        <Input.Search allowClear placeholder="Buscar por código, nombre, dirección o propietario" style={{ width: 380 }}
          value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Segmented value={estado} onChange={setEstado} options={opciones} />
        <Typography.Text type="secondary">{visibles.length} {visibles.length === 1 ? 'depto' : 'deptos'}</Typography.Text>
      </Space>
      <Table<Depto> rowKey="id" size="small" pagination={false} sticky loading={!deptos} dataSource={visibles} columns={columnas(setHistorial)} />
      <Drawer open={!!historial} onClose={() => setHistorial(undefined)} size={900} destroyOnHidden
        title={historial && `Historial de ${historial.codigo} · ${historial.nombre}`}>
        {historial && <Historial deptoId={historial.id} />}
      </Drawer>
    </Space>
  );
}
