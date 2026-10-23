import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Typography } from 'antd';
import { enviar, get } from './api.ts';

interface Config { modelo: string; esfuerzo: string }

const MODELOS = [
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5 (el más barato)' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5 (el mejor para análisis, el más caro)' },
];
const ESFUERZOS = [
  { value: 'low', label: 'Bajo (más rápido)' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto (piensa más)' },
];

// Configuración del asistente (plan 061): key, modelo y esfuerzo. Solo en la PC servidor.
export function ConfigAsistente() {
  const [final, setFinal] = useState<string | null>();
  const [editando, setEditando] = useState(false);
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<{ final: string | null }>('ia/clave').then((r) => setFinal(r.final), (e) => setError(String(e)));
    get<Config>('ia/configuracion').then(setConfig, (e) => setError(String(e)));
  }, []);

  const guardar = async (cambio: Partial<Config>) => {
    try {
      setConfig(await enviar<Config>('ia/configuracion', 'PUT', cambio));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small" title="API key de Anthropic">
        {final && !editando ? (
          <Space>
            <Typography.Text>Cargada (termina en <b>{final}</b>).</Typography.Text>
            <Button size="small" onClick={() => setEditando(true)}>Cambiar</Button>
          </Space>
        ) : (
          <Form layout="inline" onFinish={async (v: { clave: string }) => {
            try {
              setFinal((await enviar<{ final: string }>('ia/clave', 'PUT', v)).final);
              setEditando(false);
              setError(undefined);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}>
            <Form.Item name="clave" rules={[{ required: true, message: 'Falta la key' }]}>
              <Input.Password placeholder="sk-ant-…" autoComplete="new-password" style={{ width: 360 }} />
            </Form.Item>
            <Form.Item><Button type="primary" htmlType="submit">Guardar</Button></Form.Item>
            {final && <Form.Item><Button onClick={() => setEditando(false)}>Cancelar</Button></Form.Item>}
          </Form>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Se saca en <Typography.Link href="https://console.anthropic.com" target="_blank">console.anthropic.com</Typography.Link> con
          la cuenta del negocio (la suscripción de Claude Pro no sirve para esto). Ahí mismo se pone el tope de gasto mensual.
          La key queda cifrada en esta PC y no viaja en las copias de seguridad.
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="Modelo">
        <Space wrap>
          <Select style={{ width: 360 }} options={MODELOS} value={config?.modelo} loading={!config} onChange={(modelo) => guardar({ modelo })} />
          <Select style={{ width: 200 }} options={ESFUERZOS} value={config?.esfuerzo} loading={!config} onChange={(esfuerzo) => guardar({ esfuerzo })} />
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Sonnet con esfuerzo medio alcanza para la mayoría de las preguntas. Si se equivoca en análisis, probar Opus; si sobra, Haiku.
        </Typography.Paragraph>
      </Card>

      {error && <Alert type="error" showIcon title={error} />}
    </Space>
  );
}
