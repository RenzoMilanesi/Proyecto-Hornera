// Solo en la PC servidor: dónde se guardan las copias de la base y las últimas que se hicieron.
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Space, Table, Typography } from 'antd';
import { enviar, get } from './api.ts';

interface Copia { archivo: string; fecha: string; bytes: number }
interface Estado { carpeta: string; porDefecto: string; configurada: boolean; copias: Copia[] }

const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Copias() {
  const [estado, setEstado] = useState<Estado>();
  const [error, setError] = useState<string>();
  const [aviso, setAviso] = useState<string>();
  const [version, setVersion] = useState(0);
  const [carpeta, setCarpeta] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // El campo se llena solo al abrir: si guardar falla, lo escrito queda para corregirlo.
  useEffect(() => {
    get<Estado>('backup').then((e) => { setEstado(e); if (version === 0) setCarpeta(e.configurada ? e.carpeta : ''); }, (e) => setError(texto(e)));
  }, [version]);

  const accion = (fn: () => Promise<string>) => {
    setOcupado(true);
    setError(undefined);
    setAviso(undefined);
    fn().then(setAviso, (e) => setError(texto(e))).finally(() => { setOcupado(false); setVersion((v) => v + 1); });
  };
  const guardar = (valor: string) => accion(() => enviar<{ copia?: string }>('backup/carpeta', 'PUT', { carpeta: valor })
    .then((r) => (setCarpeta(valor.trim()), r.copia ? `Listo: la copia de prueba quedó en ${r.copia}` : 'Listo: las copias vuelven a la carpeta de siempre.')));

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      {aviso && <Alert type="success" showIcon closable title={aviso} onClose={() => setAviso(undefined)} />}
      <Card size="small" title="Carpeta de las copias">
        <Typography.Paragraph type="secondary">
          Hornera hace una copia de la base al cerrar y cada 6 horas. Conviene una carpeta de Google Drive u OneDrive:
          así la copia queda también fuera de esta PC. Al guardar se hace una copia de prueba; si no se puede, la carpeta no cambia.
          Las copias que ya existen no se mueven.
        </Typography.Paragraph>
        <Typography.Paragraph>
          En uso: <Typography.Text code copyable>{estado?.carpeta}</Typography.Text>
          {estado && !estado.configurada && <Typography.Text type="secondary"> (la de siempre)</Typography.Text>}
        </Typography.Paragraph>
        <Space wrap>
          <Space.Compact>
            <Input value={carpeta} placeholder={estado?.porDefecto} onChange={(e) => setCarpeta(e.target.value)} style={{ width: 420 }} />
            <Button type="primary" loading={ocupado} disabled={!carpeta.trim() || carpeta.trim() === (estado?.configurada ? estado.carpeta : '')}
              onClick={() => guardar(carpeta)}>Guardar</Button>
          </Space.Compact>
          {estado?.configurada && <Button disabled={ocupado} onClick={() => guardar('')}>Volver a la de siempre</Button>}
        </Space>
      </Card>
      <Card size="small" title="Últimas copias" extra={
        <Button loading={ocupado} onClick={() => accion(() => enviar<{ copia: string }>('backup', 'POST', {}).then((r) => `Copia hecha: ${r.copia}`))}>Hacer una copia ahora</Button>
      }>
        <Table<Copia> rowKey="archivo" size="small" pagination={false} loading={!estado} dataSource={estado?.copias}
          locale={{ emptyText: 'Todavía no hay copias en esta carpeta.' }} columns={[
            { title: 'Fecha', dataIndex: 'fecha', render: (v: string) => new Date(v).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) },
            { title: 'Archivo', dataIndex: 'archivo' },
            { title: 'Tamaño', dataIndex: 'bytes', align: 'right', render: (b: number) => `${(b / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB` },
          ]} />
      </Card>
    </Space>
  );
}
