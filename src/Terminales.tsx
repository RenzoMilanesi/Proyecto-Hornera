// Solo en la PC servidor: dirección para las terminales, código de emparejamiento y terminales emparejadas.
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Table, Typography } from 'antd';
import { enviar, get } from './api.ts';

interface Terminal { id: number; nombre: string; creada_en: string }
interface Estado { direcciones: string[]; codigo: { valor: string; vence: string } | null; terminales: Terminal[] }

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export function Terminales() {
  const [estado, setEstado] = useState<Estado>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  useEffect(() => { get<Estado>('terminales').then(setEstado, (e) => setError(String(e))); }, [version]);

  const accion = (fn: () => Promise<unknown>) => fn().then(() => setVersion((v) => v + 1), (e) => setError(String(e)));

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Card size="small" title="Conectar otra PC">
        <Typography.Paragraph>
          En la otra PC instalá Hornera, elegí <b>Terminal</b> y escribí la dirección de esta PC:
        </Typography.Paragraph>
        {estado?.direcciones.map((d) => <Typography.Paragraph key={d} copyable code style={{ marginLeft: 16 }}>{d}</Typography.Paragraph>)}
        <Typography.Paragraph type="secondary">
          Conviene el nombre del equipo (el primero): la IP puede cambiar. Si Windows pregunta por el firewall, permití el acceso en redes privadas.
        </Typography.Paragraph>
        <Space>
          <Button onClick={() => accion(() => enviar('terminales/codigo', 'POST', {}))}>Generar código</Button>
          {estado?.codigo && (
            <Typography.Text>
              Código: <Typography.Text strong style={{ fontSize: 20, letterSpacing: 4 }}>{estado.codigo.valor}</Typography.Text>{' '}
              <Typography.Text type="secondary">(vale hasta las {hora(estado.codigo.vence)}, una sola vez)</Typography.Text>
            </Typography.Text>
          )}
        </Space>
      </Card>
      <Card size="small" title="Terminales emparejadas">
        <Table<Terminal> rowKey="id" size="small" pagination={false} loading={!estado} dataSource={estado?.terminales} columns={[
          { title: 'Nombre', dataIndex: 'nombre' },
          { title: 'Desde', dataIndex: 'creada_en' },
          { title: '', key: 'revocar', width: 100, render: (_: unknown, t) => (
            <Button size="small" danger onClick={() => accion(() => enviar(`terminales/${t.id}/revocar`, 'POST', {}))}>Revocar</Button>
          ) },
        ]} />
      </Card>
    </Space>
  );
}
