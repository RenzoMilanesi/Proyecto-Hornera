// Terminal sin emparejar: pide el código que se genera en el servidor (Terminales).
import { useState } from 'react';
import { Alert, Button, Card, Form, Input } from 'antd';
import { enviar } from './api.ts';

export function Emparejar() {
  const [error, setError] = useState<string>();
  return (
    <Card title="Conectar esta PC al servidor" style={{ maxWidth: 420, margin: '80px auto' }}>
      <p>En la PC servidor abrí <b>Terminales → Generar código</b> y escribilo acá.</p>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}
      <Form layout="vertical" onFinish={(v) => enviar('terminales/emparejar', 'POST', v).then(() => location.reload(), (e) => setError(e instanceof Error ? e.message : String(e)))}>
        <Form.Item name="nombre" label="Nombre de esta PC" rules={[{ required: true, message: 'Falta el nombre' }]}><Input placeholder="PC de la oficina" /></Form.Item>
        <Form.Item name="codigo" label="Código" rules={[{ required: true, message: 'Falta el código' }]}><Input inputMode="numeric" maxLength={6} /></Form.Item>
        <Button type="primary" htmlType="submit">Conectar</Button>
      </Form>
    </Card>
  );
}
