import { useEffect, useState } from 'react';
import { Layout, Menu, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Importar } from './Importar.tsx';
import { Stays } from './Stays.tsx';
import { Liquidacion } from './Liquidacion.tsx';
import { Movimientos } from './Movimientos.tsx';
import { GastosAjenos } from './GastosAjenos.tsx';
import { Limpieza } from './Limpieza.tsx';
import { Cuentas } from './Cuentas.tsx';
import { Transferencias } from './Transferencias.tsx';
import { Terminales } from './Terminales.tsx';
import { Copias } from './Copias.tsx';
import { Resumen } from './Resumen.tsx';
import { ResumenHornera } from './ResumenHornera.tsx';
import { Deptos } from './Deptos.tsx';
import { Propietarios } from './Propietarios.tsx';
import { Historial } from './Historial.tsx';
import { Comprobantes } from './Comprobantes.tsx';
import { Emparejar } from './Emparejar.tsx';
import { Emisores } from './Emisores.tsx';
import { Auditoria } from './Auditoria.tsx';
import { Vencimientos } from './Vencimientos.tsx';
import { ConfigAsistente, mesVisto, PanelAsistente } from './Asistente.tsx';

const secciones = {
  resumen: { grupo: '', titulo: 'Resumen', ayuda: 'Cómo viene el mes en los deptos: ocupación, tarifas y lo cobrado.', vista: <Resumen /> },
  resumenHornera: { grupo: 'Hornera', titulo: 'Resumen Hornera', ayuda: 'Cuánto ganó Hornera en el mes, qué falta pagar y cuánto queda disponible.', vista: <ResumenHornera /> },
  movimientos: { grupo: 'Hornera', titulo: 'Movimientos', ayuda: 'Gastos, ingresos, adelantos y transferencias entre cuentas. No se borran: se anulan.', vista: <Movimientos /> },
  cuentas: { grupo: 'Hornera', titulo: 'Cuentas', ayuda: 'Cuentas de la empresa con su saldo y a qué cuenta entra cada medio de pago.', vista: <Cuentas /> },
  vencimientos: { grupo: 'Hornera', titulo: 'Vencimientos', ayuda: 'Impuestos y servicios que paga Hornera y vencen en el mes: qué falta pagar.', vista: <Vencimientos /> },
  limpieza: { grupo: 'Hornera', titulo: 'Limpieza', ayuda: 'Horas que cargan las chicas en el Form y lo que se le paga a la coordinadora por período, con lo de cada una. Es un gasto de Hornera.', vista: <Limpieza /> },
  comprobantes: { grupo: 'Hornera', titulo: 'Comprobantes', ayuda: 'Facturas y notas de crédito emitidas en ARCA, por mes de emisión.', vista: <Comprobantes /> },
  emisores: { grupo: 'Hornera', titulo: 'Emisores', ayuda: 'Quién factura los honorarios en ARCA y su certificado.', vista: <Emisores /> },
  gastosAjenos: { grupo: 'Hornera', titulo: 'Gastos personales', ayuda: 'Gastos de Amancay, Lautaro, la Casa del Estudiante y la casa. No son de Hornera: no entran en liquidaciones ni en el resultado.', vista: <GastosAjenos /> },
  deptos: { grupo: 'Datos', titulo: 'Deptos', ayuda: 'Los deptos que administra Hornera, con su dueño y estado. En Ficha: servicios, claves, contactos y notas.', vista: <Deptos /> },
  liquidacion: { grupo: 'Datos/Propiedades', titulo: 'Liquidación', ayuda: 'Lo que le corresponde a cada propietario. Al cerrar el mes queda guardado.', vista: <Liquidacion /> },
  transferencias: { grupo: 'Datos/Propiedades', titulo: 'Transferencias', ayuda: 'Qué se le paga a cada propietario de un mes cerrado y la lista para el banco.', vista: <Transferencias /> },
  historial: { grupo: 'Datos/Propiedades', titulo: 'Historial', ayuda: 'Pagos a cada propietario mes a mes: lo liquidado, lo pagado y lo pendiente.', vista: <Historial /> },
  propietarios: { grupo: 'Datos/Propiedades', titulo: 'Propietarios', ayuda: 'Dueños de los deptos y en qué moneda se les liquida.', vista: <Propietarios /> },
  stays: { grupo: 'Herramientas', titulo: 'Stays', ayuda: 'Trae reservas y pagos del mes desde Stays.', vista: <Stays /> },
  importar: { grupo: 'Herramientas', titulo: 'Importar Excel', ayuda: 'Carga un mes desde el Google Sheet de liquidaciones, o los gastos varios del mes abierto.', vista: <Importar /> },
  auditoria: { grupo: 'Herramientas', titulo: 'Auditoría', ayuda: 'Quién cambió qué en el mes: cada PC, con lo que cambió.', vista: <Auditoria /> },
  terminales: { grupo: 'Herramientas', titulo: 'Terminales', ayuda: 'Otras PCs de la oficina conectadas a esta.', vista: <Terminales /> }, // solo en la PC servidor
  asistente: { grupo: 'Herramientas', titulo: 'Asistente', ayuda: 'API key de Anthropic y modelo del asistente con IA.', vista: <ConfigAsistente /> }, // solo en la PC servidor
  copias: { grupo: 'Herramientas', titulo: 'Copias de seguridad', ayuda: 'Dónde se guardan las copias de la base y las últimas que se hicieron.', vista: <Copias /> }, // solo en la PC servidor
};
type Seccion = keyof typeof secciones;
const SOLO_SERVIDOR = ['terminales', 'copias', 'asistente'];

export function App() {
  const [seccion, setSeccion] = useState<Seccion>('resumen');
  const [version, setVersion] = useState('');
  const [local, setLocal] = useState(false);
  const [emparejar, setEmparejar] = useState(false);
  const [asistente, setAsistente] = useState(false);
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

  const visibles = Object.entries(secciones).filter(([key]) => local || !SOLO_SERVIDOR.includes(key));
  // grupo 'Datos/Propiedades': submenú Propiedades dentro del grupo DATOS.
  const grupos = [...new Set(visibles.map(([, s]) => s.grupo.split('/')[0]))];
  const items = grupos.flatMap((g): MenuProps['items'] & object => {
    const hijos: { key: string; label: string; children?: { key: string; label: string }[] }[] = [];
    for (const [key, s] of visibles) {
      const [grupo, sub] = s.grupo.split('/');
      if (grupo !== g) continue;
      if (!sub) { hijos.push({ key, label: s.titulo }); continue; }
      let menu = hijos.find((h) => h.key === `sub-${sub}`);
      if (!menu) hijos.push(menu = { key: `sub-${sub}`, label: sub, children: [] });
      menu.children!.push({ key, label: s.titulo });
    }
    return g ? [{ type: 'group' as const, key: g, label: <span style={{ fontWeight: 600, letterSpacing: 0.5 }}>{g.toUpperCase()}</span>, children: hijos }] : hijos;
  });
  const actual = secciones[seccion];
  mesVisto.valor = ''; // la pantalla con selector de mes lo vuelve a escribir al dibujarse
  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* sticky: el menú queda a mano al bajar por tablas largas */}
      <Layout.Sider width={200} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
        <Typography.Title level={4} style={{ padding: '16px 24px', margin: 0, color: '#fff' }}>Hornera</Typography.Title>
        <Menu theme="dark" mode="inline" defaultOpenKeys={['sub-Propiedades']} selectedKeys={[seccion]} onClick={(e) => setSeccion(e.key as Seccion)} items={items} />
        {/* Lo abre electron/main.ts (setWindowOpenHandler) con la copia del manual de esta PC. */}
        <Typography.Link onClick={() => setAsistente(true)} style={{ display: 'block', padding: '16px 24px 0', color: '#E8C9A8' }}>Asistente con IA</Typography.Link>
        <Typography.Link href="/manual.pdf" target="_blank" style={{ display: 'block', padding: '16px 24px 0', color: '#E8C9A8' }}>Manual de usuario</Typography.Link>
        <Typography.Text style={{ display: 'block', padding: '8px 24px 16px', color: '#B3A698' }}>v{version}</Typography.Text>
      </Layout.Sider>
      <Layout.Content style={{ padding: '24px 28px', minWidth: 0 }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>{actual.titulo}</Typography.Title>
        <Typography.Paragraph style={{ marginBottom: 20, color: '#4A3F37' }}>{actual.ayuda}</Typography.Paragraph>
        <div key={seccion}>{actual.vista}</div>{/* key: estado nuevo por sección */}
      </Layout.Content>
      <PanelAsistente abierto={asistente} alCerrar={() => setAsistente(false)} pantalla={actual.titulo} />
    </Layout>
  );
}
