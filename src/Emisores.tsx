// Quién factura los honorarios en ARCA (Lautaro, Amancay) y su certificado (plan 031).
import { useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Switch, Table, Tag, Typography, Upload } from 'antd';
import { enviar, get } from './api.ts';

interface Emisor {
  id: number; nombre: string; razon_social: string; cuit: string; condicion_iva: string; punto_venta: number;
  domicilio: string | null; ingresos_brutos: string | null; inicio_actividades: string | null;
  ambiente: 'homologacion' | 'produccion'; activo: number;
  certificado: { alias: string; vence: string } | null; tiene_clave: boolean;
}

const CONDICIONES = [
  { value: 'monotributista', label: 'Monotributista (Factura C)' },
  { value: 'responsable_inscripto', label: 'Responsable inscripto (Factura A/B)' },
  { value: 'exento', label: 'Exento (Factura C)' },
];
const NOMBRE_CBTE: Record<number, string> = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' };
const fecha = (iso: string) => iso.split('-').reverse().join('/');
const cuitConGuiones = (c: string) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
const diasHasta = (iso: string) => Math.floor((new Date(`${iso}T00:00:00`).getTime() - Date.now()) / 86_400_000);
const ambiente = (a: Emisor['ambiente']) => (a === 'produccion' ? <Tag color="green">producción</Tag> : <Tag color="orange">homologación</Tag>);

// Estado del certificado: vencido, por vencer (30 días), sin clave en esta PC o al día.
function EstadoCertificado({ e }: { e: Emisor }) {
  if (!e.certificado) return <Tag color="red">sin certificado</Tag>;
  const dias = diasHasta(e.certificado.vence);
  return (
    <Space size={4} wrap>
      <span>vence {fecha(e.certificado.vence)}</span>
      {dias < 0 ? <Tag color="red">vencido</Tag> : dias <= 30 ? <Tag color="orange">vence en {dias} días</Tag> : null}
      {!e.tiene_clave && <Tag color="red">falta la clave en esta PC</Tag>}
    </Space>
  );
}

function FormEmisor({ e, abierto, alCerrar }: { e?: Emisor; abierto: boolean; alCerrar: (guardado: boolean) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  const ambienteElegido = Form.useWatch('ambiente', form);
  useEffect(() => {
    if (!abierto) return;
    setError(undefined);
    form.setFieldsValue(e ? { ...e, activo: !!e.activo } : { condicion_iva: 'monotributista', ambiente: 'homologacion', activo: true });
  }, [abierto, e, form]);
  const guardar = async () => {
    const v = await form.validateFields();
    try {
      const cuerpo = { ...v, cuit: String(v.cuit ?? e?.cuit ?? ''), activo: !e || v.activo ? 1 : 0 };  // el alta no muestra "Activo": nace activo
      await (e ? enviar(`emisores/${e.id}`, 'PUT', cuerpo) : enviar('emisores', 'POST', cuerpo));
      alCerrar(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal open={abierto} title={e ? `Datos de ${e.nombre}` : 'Nuevo emisor'} okText="Guardar" cancelText="Cancelar" onOk={guardar} width={560}
      onCancel={() => alCerrar(false)} destroyOnHidden>
      {e && (
        <dl className="ficha">
          <dt>Emisor</dt><dd><b>{e.nombre}</b> · {e.razon_social}</dd>
          <dt>CUIT</dt><dd>{cuitConGuiones(e.cuit)}</dd>
          <dt>Certificado</dt><dd><EstadoCertificado e={e} /></dd>
        </dl>
      )}
      <Form form={form} layout="vertical">
        <Typography.Text strong>Datos fiscales</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>Tal como figuran en la constancia de inscripción de ARCA; salen impresos en la factura.</Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Nombre" name="nombre" rules={[{ required: true, message: 'Falta el nombre' }]}><Input placeholder="Lautaro" /></Form.Item></Col>
          <Col span={12}>
            <Form.Item label="CUIT" name="cuit" rules={e ? [] : [{ required: true, pattern: /^\d{2}-?\d{8}-?\d$/, message: '11 dígitos' }]}
              extra={e ? 'No se cambia: el certificado y las facturas son de este CUIT.' : undefined}>
              <Input disabled={!!e} placeholder={e ? cuitConGuiones(e.cuit) : '20-12345678-9'} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="Razón social" name="razon_social" rules={[{ required: true, message: 'Falta la razón social' }]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Condición frente al IVA" name="condicion_iva" rules={[{ required: true }]}><Select options={CONDICIONES} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Inicio de actividades" name="inicio_actividades"><Input type="date" style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Domicilio" name="domicilio"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Ingresos brutos" name="ingresos_brutos"><Input /></Form.Item></Col>
        </Row>
        <Typography.Text strong>Facturación electrónica</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>El punto de venta tiene que ser de tipo "Web Services" (no el de Comprobantes en Línea).</Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Punto de venta" name="punto_venta" rules={[{ required: true, type: 'number', min: 1, max: 99999, message: 'Entre 1 y 99999' }]}>
              <InputNumber precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Ambiente" name="ambiente" extra={e?.certificado && ambienteElegido !== e.ambiente
              ? <Typography.Text type="warning">Al guardar se borra el certificado: el de un ambiente no sirve en el otro.</Typography.Text>
              : 'Homologación es de prueba: las facturas no valen.'}>
              <Radio.Group optionType="button" options={[{ value: 'homologacion', label: 'Homologación' }, { value: 'produccion', label: 'Producción' }]} />
            </Form.Item>
          </Col>
        </Row>
        {e && <Form.Item label="Activo" name="activo" valuePropName="checked" extra="Un emisor inactivo no se ofrece para facturar."><Switch /></Form.Item>}
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

function FormCertificado({ e, alCerrar }: { e?: Emisor; alCerrar: (guardado: boolean) => void }) {
  const [archivos, setArchivos] = useState<{ crt?: string; key?: string }>({});
  const [error, setError] = useState<string>();
  useEffect(() => { if (e) { setArchivos({}); setError(undefined); } }, [e]);
  // Se lee el archivo en el navegador y se manda como texto; Upload no sube nada solo.
  const elegir = (campo: 'crt' | 'key', accept: string) => (
    <Upload accept={accept} maxCount={1} beforeUpload={(f) => { f.text().then((t) => setArchivos((a) => ({ ...a, [campo]: t }))); return false; }}
      onRemove={() => setArchivos((a) => ({ ...a, [campo]: undefined }))}>
      <Button>Elegir archivo</Button>
    </Upload>
  );
  const guardar = async () => {
    try {
      await enviar(`emisores/${e!.id}/certificado`, 'POST', archivos);
      alCerrar(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal open={!!e} title={e && `Certificado de ARCA de ${e.nombre}`} okText="Guardar" cancelText="Cancelar" onOk={guardar} width={560}
      okButtonProps={{ disabled: !archivos.crt || !archivos.key }} onCancel={() => alCerrar(false)} destroyOnHidden>
      {e && (
        <dl className="ficha">
          <dt>Emisor</dt><dd><b>{e.nombre}</b> · CUIT {cuitConGuiones(e.cuit)}</dd>
          <dt>Ambiente</dt><dd>{ambiente(e.ambiente)}</dd>
          <dt>Actual</dt><dd><EstadoCertificado e={e} /></dd>
        </dl>
      )}
      <Typography.Text strong>Archivos del certificado</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
        El .crt lo descarga ARCA al asociar el certificado; el .key es la clave privada que se generó con openssl.
        La clave queda cifrada en esta PC y no viaja en los backups: se carga solo desde la PC servidor.
      </Typography.Paragraph>
      <Form layout="vertical">
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Certificado (.crt)">{elegir('crt', '.crt,.pem,.cer')}</Form.Item></Col>
          <Col span={12}><Form.Item label="Clave privada (.key)">{elegir('key', '.key,.pem')}</Form.Item></Col>
        </Row>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function Emisores() {
  const [emisores, setEmisores] = useState<Emisor[]>();
  const [editando, setEditando] = useState<{ e?: Emisor }>();
  const [certificado, setCertificado] = useState<Emisor>();
  const [probando, setProbando] = useState<number>();
  const [aviso, setAviso] = useState<{ tipo: 'success' | 'error'; texto: string }>();
  const [version, setVersion] = useState(0);
  useEffect(() => { get<Emisor[]>('emisores').then(setEmisores, (e) => setAviso({ tipo: 'error', texto: String(e) })); }, [version]);
  const cerrar = (guardado: boolean) => { setEditando(undefined); setCertificado(undefined); if (guardado) setVersion((v) => v + 1); };

  const probar = async (e: Emisor) => {
    setProbando(e.id);
    setAviso(undefined);
    try {
      const r = await enviar<{ cbteTipo: number; ultimo: number }>(`emisores/${e.id}/probar`, 'POST', {});
      setAviso({ tipo: 'success', texto: `ARCA respondió bien para ${e.nombre}: último comprobante autorizado ${NOMBRE_CBTE[r.cbteTipo]} `
        + `n.º ${r.ultimo} del punto de venta ${e.punto_venta}${r.ultimo === 0 ? ' (todavía ninguno)' : ''}.` });
    } catch (err) {
      setAviso({ tipo: 'error', texto: `${e.nombre}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setProbando(undefined);
    }
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {aviso && <Alert type={aviso.tipo} showIcon closable title={aviso.texto} onClose={() => setAviso(undefined)} />}
      <div><Button type="primary" onClick={() => setEditando({})}>Nuevo emisor</Button></div>
      <Table<Emisor> rowKey="id" size="small" pagination={false} loading={!emisores} dataSource={emisores} scroll={{ x: 'max-content' }} columns={[
        { title: 'Emisor', dataIndex: 'nombre', render: (v: string, e) => <>{v} {!e.activo && <Tag>inactivo</Tag>}<br /><Typography.Text type="secondary">{e.razon_social}</Typography.Text></> },
        { title: 'CUIT', dataIndex: 'cuit', render: cuitConGuiones },
        { title: 'Condición', dataIndex: 'condicion_iva', render: (v: string) => CONDICIONES.find((c) => c.value === v)?.label },
        { title: 'Punto de venta', dataIndex: 'punto_venta', align: 'right' },
        { title: 'Ambiente', dataIndex: 'ambiente', render: ambiente },
        { title: 'Certificado', key: 'certificado', render: (_: unknown, e) => <EstadoCertificado e={e} /> },
        {
          title: '', key: 'acciones', render: (_: unknown, e) => (
            <Space>
              <Button size="small" onClick={() => setEditando({ e })}>Editar</Button>
              <Button size="small" onClick={() => setCertificado(e)}>Certificado</Button>
              <Button size="small" loading={probando === e.id} disabled={!e.certificado || !e.tiene_clave} onClick={() => probar(e)}>Probar</Button>
            </Space>
          ),
        },
      ]} />
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        "Probar" pide a ARCA el último comprobante autorizado: si responde, el certificado, el permiso de facturación electrónica (wsfe) y el punto de venta están bien.
        El certificado vale 2 años: renovalo antes de que venza, o no se va a poder facturar.
      </Typography.Paragraph>
      <FormEmisor e={editando?.e} abierto={!!editando} alCerrar={cerrar} />
      <FormCertificado e={certificado} alCerrar={cerrar} />
    </Space>
  );
}
