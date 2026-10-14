import { useEffect, useState } from 'react';
import { Layout, Menu, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Importar } from './Importar.tsx';
import { Stays } from './Stays.tsx';
import { Liquidacion } from './Liquidacion.tsx';
import { Movimientos } from './Movimientos.tsx';
import { Cuentas } from './Cuentas.tsx';
import { Transferencias } from './Transferencias.tsx';
import { Terminales } from './Terminales.tsx';
import { Resumen } from './Resumen.tsx';
import { Deptos } from './Deptos.tsx';
import { Propietarios } from './Propietarios.tsx';
import { Historial } from './Historial.tsx';
import { Emparejar } from './Emparejar.tsx';

const secciones = {
  resumen: { grupo: '', titulo: 'Resumen', ayuda: 'Cómo viene el mes: ocupación, plata y resultado de Hornera.', vista: <Resumen /> },
  liquidacion: { grupo: 'Mes', titulo: 'Liquidación', ayuda: 'Lo que le corresponde a cada propietario. Al cerrar el mes queda guardado.', vista: <Liquidacion /> },
  transferencias: { grupo: 'Mes', titulo: 'Transferencias', ayuda: 'Qué se le paga a cada propietario de un mes cerrado y la lista para el banco.', vista: <Transferencias /> },
  historial: { grupo: 'Mes', titulo: 'Historial', ayuda: 'Pagos a cada propietario mes a mes: lo liquidado, lo pagado y lo pendiente.', vista: <Historial /> },
  movimientos: { grupo: 'Mes', titulo: 'Movimientos', ayuda: 'Gastos, ingresos, adelantos y transferencias entre cuentas. No se borran: se anulan.', vista: <Movimientos /> },
  deptos: { grupo: 'Datos', titulo: 'Deptos', ayuda: 'Los deptos que administra Hornera, con su dueño y estado.', vista: <Deptos /> },
  propietarios: { grupo: 'Datos', titulo: 'Propietarios', ayuda: 'Dueños de los deptos y en qué moneda se les liquida.', vista: <Propietarios /> },
  cuentas: { grupo: 'Datos', titulo: 'Cuentas', ayuda: 'Cuentas de la empresa con su saldo y a qué cuenta entra cada medio de pago.', vista: <Cuentas /> },
  stays: { grupo: 'Herramientas', titulo: 'Stays', ayuda: 'Trae reservas y pagos del mes desde Stays.', vista: <Stays /> },
  importar: { grupo: 'Herramientas', titulo: 'Importar Excel', ayuda: 'Carga un mes desde el Google Sheet de liquidaciones.', vista: <Importar /> },
  terminales: { grupo: 'Herramientas', titulo: 'Terminales', ayuda: 'Otras PCs de la oficina conectadas a esta.', vista: <Terminales /> }, // solo en la PC servidor
};
type Seccion = keyof typeof secciones;

export function App() {
  const [seccion, setSeccion] = useState<Seccion>('resumen');
  const [version, setVersion] = useState('');
  const [local, setLocal] = useState(false);
  const [emparejar, setEmparejar] = useState(false);
  useEffect(() => {
    // fetch directo: el 401 de una terminal sin emparejar se distingue de cualquier otro error.
    fetch('/api/estado').then(async (r) => {
      if (r.status === 401) return setEmparejar(true);
      const e = await r.json();
      setVersion(e.version);
      setLocal(e.local);
    }, () => {});
  }, []);
  if (emparejar) return <Emparejar />;

  const visibles = Object.entries(secciones).filter(([key]) => local || key !== 'terminales');
  const grupos = [...new Set(visibles.map(([, s]) => s.grupo))];
  const items = grupos.flatMap((g): MenuProps['items'] & object => {
    const hijos = visibles.filter(([, s]) => s.grupo === g).map(([key, s]) => ({ key, label: s.titulo }));
    return g ? [{ type: 'group' as const, key: g, label: <span style={{ fontWeight: 600, letterSpacing: 0.5 }}>{g.toUpperCase()}</span>, children: hijos }] : hijos;
  });
  const actual = secciones[seccion];
  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* sticky: el menú queda a mano al bajar por tablas largas */}
      <Layout.Sider width={200} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
        <Typography.Title level={4} style={{ padding: '16px 24px', margin: 0, color: '#fff' }}>Hornera</Typography.Title>
        <Menu theme="dark" selectedKeys={[seccion]} onClick={(e) => setSeccion(e.key as Seccion)} items={items} />
        <Typography.Text style={{ display: 'block', padding: '16px 24px', color: '#B3A698' }}>v{version}</Typography.Text>
      </Layout.Sider>
      <Layout.Content style={{ padding: '24px 28px', minWidth: 0 }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>{actual.titulo}</Typography.Title>
        <Typography.Paragraph style={{ marginBottom: 20, color: '#4A3F37' }}>{actual.ayuda}</Typography.Paragraph>
        <div key={seccion}>{actual.vista}</div>{/* key: estado nuevo por sección */}
      </Layout.Content>
    </Layout>
  );
}
