import { useEffect, useState } from 'react';
import { Alert, Layout, Menu, Table, Tag, Typography } from 'antd';
import type { TableColumnsType as ColumnsType } from 'antd';
import { get } from './api.ts';
import { Importar } from './Importar.tsx';
import { Stays } from './Stays.tsx';
import { Liquidacion } from './Liquidacion.tsx';

interface Depto { id: number; codigo: string; nombre: string; estado: string; comision_pct: number; propietario: string }
interface Propietario { id: number; nombre: string; moneda_liquidacion: string; tiene_cbu: number; deptos: string | null }

const columnasDeptos: ColumnsType<Depto> = [
  { title: 'Código', dataIndex: 'codigo', width: 90 },
  { title: 'Nombre', dataIndex: 'nombre' },
  { title: 'Propietario', dataIndex: 'propietario' },
  { title: 'Comisión', dataIndex: 'comision_pct', width: 100, align: 'right', render: (v: number) => `${Math.round(v * 100)} %` },
  { title: 'Estado', dataIndex: 'estado', width: 110, render: (v: string) => <Tag color={v === 'activo' ? 'green' : 'default'}>{v}</Tag> },
];

const columnasPropietarios: ColumnsType<Propietario> = [
  { title: 'Nombre', dataIndex: 'nombre' },
  { title: 'Deptos', dataIndex: 'deptos' },
  { title: 'Liquida en', dataIndex: 'moneda_liquidacion', width: 110 },
  { title: 'CBU', dataIndex: 'tiene_cbu', width: 80, render: (v: number) => (v ? 'Sí' : <Tag color="orange">Falta</Tag>) },
];

function Listado<T extends { id: number }>({ ruta, columnas }: { ruta: string; columnas: ColumnsType<T> }) {
  const [filas, setFilas] = useState<T[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    get<T[]>(ruta).then(setFilas, (e) => setError(String(e)));
  }, [ruta]);
  if (error) return <Alert type="error" title={error} />;
  return <Table<T> rowKey="id" size="small" pagination={false} loading={!filas} dataSource={filas} columns={columnas} />;
}

const secciones = {
  deptos: { titulo: 'Deptos', vista: <Listado<Depto> ruta="deptos" columnas={columnasDeptos} /> },
  propietarios: { titulo: 'Propietarios', vista: <Listado<Propietario> ruta="propietarios" columnas={columnasPropietarios} /> },
  liquidacion: { titulo: 'Liquidación', vista: <Liquidacion /> },
  stays: { titulo: 'Stays', vista: <Stays /> },
  importar: { titulo: 'Importar Excel', vista: <Importar /> },
};
type Seccion = keyof typeof secciones;

export function App() {
  const [seccion, setSeccion] = useState<Seccion>('deptos');
  const [version, setVersion] = useState('');
  useEffect(() => {
    get<{ version: string }>('estado').then((e) => setVersion(e.version), () => {});
  }, []);
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light" width={200}>
        <Typography.Title level={4} style={{ padding: '16px 24px', margin: 0 }}>Hornera</Typography.Title>
        <Menu
          selectedKeys={[seccion]}
          onClick={(e) => setSeccion(e.key as Seccion)}
          items={Object.entries(secciones).map(([key, s]) => ({ key, label: s.titulo }))}
        />
        <Typography.Text type="secondary" style={{ position: 'absolute', bottom: 12, left: 24 }}>v{version}</Typography.Text>
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        <Typography.Title level={3}>{secciones[seccion].titulo}</Typography.Title>
        <div key={seccion}>{secciones[seccion].vista}</div>{/* key: estado nuevo por sección */}
      </Layout.Content>
    </Layout>
  );
}
