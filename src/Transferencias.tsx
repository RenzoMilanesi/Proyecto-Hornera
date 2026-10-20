// Transferencias a propietarios de un mes cerrado: qué se le paga a cada uno, "marcar pagado"
// (genera el movimiento "Liquidacion periodo") y la lista para el banco en Excel.
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { FacturaDePago, Transferencia } from '../server/liquidacion/pagos.ts';
import { descargarPdfComprobante, entradaPlata, enviar, get, pesos, simbolo } from './api.ts';

interface Periodo { mes: string; estado: string; fecha_pago: string }
interface Cuenta { id: number; nombre: string; moneda: 'ARS' | 'USD'; activo: number }
const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };

export function FormPago({ t, fecha, cuentas, alCerrar }: { t?: Transferencia; fecha: string; cuentas: Cuenta[]; alCerrar: (guardado: boolean, pagoId?: number) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (t) { setError(undefined); form.setFieldsValue({ cuenta_id: null, fecha, importe: t.pendiente / 100, detalle: 'Transferencia' }); }
  }, [t, fecha, form]);
  const guardar = async () => {
    const v = await form.validateFields();
    try {
      const { id } = await enviar<{ id: number }>(`liquidaciones/${t!.liquidacionId}/pagar`, 'POST', { cuenta_id: v.cuenta_id ?? null, fecha: v.fecha, importe: Math.round(v.importe * 100), detalle: v.detalle });
      alCerrar(true, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal open={!!t} title={t && `Pago de la liquidación de ${t.codigo}`} okText="Marcar pagado" cancelText="Cancelar" onOk={guardar} width={560}
      onCancel={() => alCerrar(false)} destroyOnHidden>
      {t && (
        <dl className="ficha">
          <dt>Propietario</dt><dd><b>{t.propietario}</b></dd>
          <dt>CBU/CVU</dt>
          <dd>{t.esHornera ? <Tag>Nosotros</Tag> : t.cbu ? <Typography.Text copyable code>{t.cbu}</Typography.Text> : <Tag color="orange">no informado</Tag>}</dd>
          <dt>Pendiente</dt><dd><Typography.Text strong style={{ fontSize: 18 }}>{pesos(t.pendiente, t.moneda)}</Typography.Text></dd>
        </dl>
      )}
      <Form form={form} layout="vertical">
        <Space wrap align="start" size="middle">
          <Form.Item label="Fecha" name="fecha" rules={[{ required: true }]}><Input type="date" style={{ width: 170 }} /></Form.Item>
          <Form.Item label="Importe" name="importe" rules={[{ required: true }, { type: 'number', min: 0.01, message: 'Mayor que 0' }]}
            extra={<>Menos que lo pendiente si se paga en partes. <Typography.Link onClick={() => t && form.setFieldValue('importe', t.pendiente / 100)}>Todo lo pendiente</Typography.Link></>}>
            <InputNumber {...entradaPlata} prefix={simbolo(t?.moneda)} style={{ width: 220 }} />
          </Form.Item>
        </Space>
        <Form.Item label="Sale de la cuenta" name="cuenta_id" extra={`Solo cuentas en ${t?.moneda ?? ''}. Vacío si no sale de una cuenta (por ejemplo, el depto propio).`}>
          <Select allowClear placeholder="Sin cuenta" options={cuentas.filter((c) => c.activo && c.moneda === t?.moneda).map((c) => ({ value: c.id, label: c.nombre }))} />
        </Form.Item>
        <Form.Item label="Detalle" name="detalle"><Input /></Form.Item>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

interface EmisorLista { id: number; nombre: string; ambiente: 'homologacion' | 'produccion'; activo: number; certificado: { vence: string } | null; tiene_clave: boolean }
interface Propuesta {
  ofrece: boolean; motivo?: string; honorarios: number; facturado?: number; propuesto?: number;
  mes: string; codigo: string; propietario: string; importe_pago: number; fecha_pago: string;
}
const numeroCbte = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`;

// Factura de los honorarios de un pago (plan 031). El pago ya está registrado: si ARCA falla, queda pendiente.
export interface AFacturar { pagoId: number; codigo: string; moneda: 'ARS' | 'USD' }
export function FormFactura({ a, alCerrar }: { a?: AFacturar; alCerrar: (cambio: boolean) => void }) {
  const [form] = Form.useForm();
  const [emisores, setEmisores] = useState<EmisorLista[]>([]);
  const [p, setP] = useState<Propuesta>();
  const [error, setError] = useState<string>();
  const [revisar, setRevisar] = useState(false);   // ARCA pudo haber autorizado el intento anterior
  const [intento, setIntento] = useState(false);   // quedó un intento guardado: el padre recarga
  const [emitiendo, setEmitiendo] = useState(false);
  const emisorId = Form.useWatch('emisor_id', form) as number | undefined;
  const importe = Form.useWatch('importe', form) as number | undefined;
  useEffect(() => {
    if (!a) return;
    setError(undefined); setRevisar(false); setIntento(false); setP(undefined);
    form.resetFields();
    get<EmisorLista[]>('emisores').then((es) => setEmisores(es.filter((e) => e.activo && e.certificado && e.tiene_clave)));
  }, [a, form]);
  useEffect(() => {
    if (!a) return;
    get<Propuesta>(`pagos/${a.pagoId}/factura${emisorId ? `?emisor=${emisorId}` : ''}`).then((x) => {
      setP(x);
      if (x.ofrece && form.getFieldValue('importe') == null) form.setFieldValue('importe', x.propuesto! / 100);
    }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [a, emisorId, form]);
  // Aviso, no error: el importe es libre (plan 031).
  const pasa = !!p?.ofrece && importe != null && p.facturado! + Math.round(importe * 100) > p.honorarios;
  const emitir = async () => {
    const v = await form.validateFields().catch(() => null);  // los errores ya se ven en los campos
    if (!v) return;
    setEmitiendo(true);
    try {
      await enviar(`pagos/${a!.pagoId}/factura`, 'POST', { emisor_id: v.emisor_id, importe: Math.round(v.importe * 100), revisado: revisar });
      alCerrar(true);
    } catch (e) {
      setIntento(true);
      setRevisar(!!(e as { cuerpo?: { revisar?: number } }).cuerpo?.revisar);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmitiendo(false);
    }
  };
  return (
    <Modal open={!!a} title={a && `Facturar este pago de ${a.codigo}`} okText={revisar ? 'Ya lo revisé: emitir igual' : 'Emitir'} cancelText="Ahora no"
      onOk={emitir} onCancel={() => alCerrar(intento)} width={560} confirmLoading={emitiendo} okButtonProps={{ disabled: !p?.ofrece }} destroyOnHidden>
      {a && p && (
        <dl className="ficha">
          <dt>Propietario</dt><dd><b>{p.propietario}</b></dd>
          <dt>Pago</dt><dd><b>{pesos(p.importe_pago, a.moneda)}</b> · {p.fecha_pago}</dd>
          <dt>Honorarios</dt><dd>{pesos(p.honorarios)} de {p.mes}{p.ofrece && <> · ya facturado {pesos(p.facturado!)}</>}</dd>
        </dl>
      )}
      <Form form={form} layout="vertical" disabled={!!p && !p.ofrece}>
        <Space wrap align="start" size="middle">
          <Form.Item label="Emisor" name="emisor_id" rules={[{ required: true, message: 'Elegí quién factura' }]}
            extra={!emisores.length && 'Ningún emisor tiene el certificado cargado (Datos → Emisores).'}>
            <Select style={{ width: 220 }} placeholder="Quién factura"
              options={emisores.map((e) => ({ value: e.id, label: e.ambiente === 'produccion' ? e.nombre : `${e.nombre} (homologación)` }))} />
          </Form.Item>
          <Form.Item label="Importe" name="importe" rules={[{ required: true }, { type: 'number', min: 0.01, message: 'Mayor que 0' }]}
            validateStatus={pasa ? 'warning' : undefined} help={pasa ? 'Con esta factura lo facturado del mes pasa los honorarios del depto.' : undefined}
            extra="En pesos: la parte de los honorarios que corresponde a este pago.">
            <InputNumber {...entradaPlata} prefix="$" style={{ width: 220 }} />
          </Form.Item>
        </Space>
      </Form>
      {p && !p.ofrece && <Alert type="info" showIcon title={`No se factura: ${p.motivo}`} />}
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

// Factura de un pago anulado que sigue vigente: la anula una nota de crédito (plan 031).
export type FacturaNC = Pick<FacturaDePago, 'id' | 'punto_venta' | 'importe' | 'ambiente' | 'emisor'> & { numero: number };

export function FormNotaCredito({ nc, alCerrar }: { nc?: { factura: FacturaNC; codigo: string }; alCerrar: (cambio: boolean) => void }) {
  const [error, setError] = useState<string>();
  const [revisar, setRevisar] = useState(false);
  const [intento, setIntento] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  useEffect(() => { if (nc) { setError(undefined); setRevisar(false); setIntento(false); } }, [nc]);
  const emitir = async () => {
    setEmitiendo(true);
    try {
      await enviar(`comprobantes/${nc!.factura.id}/nota-credito`, 'POST', { revisado: revisar });
      alCerrar(true);
    } catch (e) {
      setIntento(true);
      setRevisar(!!(e as { cuerpo?: { revisar?: number } }).cuerpo?.revisar);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmitiendo(false);
    }
  };
  const f = nc?.factura;
  return (
    <Modal open={!!nc} title={f && `Nota de crédito de la factura ${numeroCbte(f.punto_venta, f.numero)}`} okText={revisar ? 'Ya lo revisé: emitir igual' : 'Emitir nota de crédito'}
      cancelText="Ahora no" onOk={emitir} onCancel={() => alCerrar(intento)} width={560} confirmLoading={emitiendo} destroyOnHidden>
      {nc && f && (
        <dl className="ficha">
          <dt>Depto</dt><dd><b>{nc.codigo}</b></dd>
          <dt>Factura</dt><dd><b>{numeroCbte(f.punto_venta, f.numero)}</b> · {f.emisor}{f.ambiente === 'homologacion' && <> <Tag>homologación</Tag></>}</dd>
          <dt>Importe</dt><dd><Typography.Text strong style={{ fontSize: 18 }}>{pesos(f.importe)}</Typography.Text></dd>
        </dl>
      )}
      <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
        El pago se anuló pero la factura sigue vigente en ARCA. La nota de crédito la anula por el mismo importe y período.
        Si se saltea, el pago queda marcado "pago anulado, factura vigente" hasta emitirla.
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}

export function EstadoFactura({ f, anulado, alFacturar, alAnularFactura, alPdf }: {
  f?: FacturaDePago | null; anulado?: boolean; alFacturar: () => void; alAnularFactura: () => void; alPdf?: () => void;
}) {
  const pdf = alPdf && f?.estado === 'aprobado' && <Button size="small" onClick={alPdf}>PDF</Button>;
  if (anulado && f?.estado === 'aprobado') {
    return (
      <Space size="small">
        <Tag color="orange">pago anulado, factura vigente</Tag>
        {f.nc_motivo && <Typography.Text type="danger" ellipsis={{ tooltip: f.nc_motivo }} style={{ maxWidth: 240 }}>{f.nc_motivo}</Typography.Text>}
        <Button size="small" onClick={alAnularFactura}>Emitir nota de crédito</Button>
        {pdf}
      </Space>
    );
  }
  if (anulado) return null;
  if (f?.estado === 'aprobado' && f.ambiente === 'produccion') return <Space size="small"><Tag color="green">emitida n.º {numeroCbte(f.punto_venta, f.numero!)}</Tag>{pdf}</Space>;
  return (
    <Space size="small">
      {!f ? <Tag color="orange">pendiente</Tag>
        : f.estado === 'aprobado' ? <Tag title="Emitida en homologación: no vale fiscalmente">prueba n.º {numeroCbte(f.punto_venta, f.numero!)}</Tag>
          : <Typography.Text type="danger" ellipsis={{ tooltip: f.motivo }} style={{ maxWidth: 320 }}><Tag color="red">rechazada</Tag>{f.motivo}</Typography.Text>}
      {pdf}
      <Button size="small" onClick={alFacturar}>{f?.estado === 'rechazado' ? 'Reintentar' : 'Facturar'}</Button>
    </Space>
  );
}

export function Transferencias() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [mes, setMes] = useState<string>();
  const [filas, setFilas] = useState<Transferencia[]>();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [pagando, setPagando] = useState<Transferencia>();
  const [facturando, setFacturando] = useState<AFacturar>();
  const [nc, setNc] = useState<{ factura: FacturaNC; codigo: string }>();
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    get<Periodo[]>('periodos').then((ps) => {
      const cerrados = ps.filter((p) => p.estado === 'cerrado');
      setPeriodos(cerrados);
      setMes(cerrados[0]?.mes);
    });
    get<Cuenta[]>('cuentas').then(setCuentas);
  }, []);
  useEffect(() => { if (mes) get<Transferencia[]>(`transferencias?mes=${mes}`).then(setFilas, (e) => setError(String(e))); }, [mes, version]);

  const anular = async (id: number, t: Transferencia) => {
    try {
      const { facturaVigente } = await enviar<{ facturaVigente: FacturaNC | null }>(`movimientos/${id}/anular`, 'POST', {});
      if (facturaVigente) setNc({ factura: facturaVigente, codigo: t.codigo });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const pdfFactura = async (id: number) => setError(await descargarPdfComprobante(id));
  const exportar = async () => {
    const r = await fetch(`/api/transferencias/excel?mes=${mes}`);
    const enlace = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `transferencias-${mes}.xlsx` });
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  };

  const columnas: TableColumnsType<Transferencia> = [
    { title: 'Depto', dataIndex: 'codigo', width: 70, render: (v: string) => <b>{v}</b> },
    { title: 'Propietario', dataIndex: 'propietario', ellipsis: true },
    { title: 'CBU/CVU', key: 'cbu', render: (_: unknown, t) => (t.esHornera ? <Tag>Nosotros</Tag> : t.cbu ?? <Tag color="orange">no informado</Tag>) },
    { title: 'Saldo', key: 'saldo', ...derecha, render: (_: unknown, t) => <Typography.Text type={t.saldo < 0 ? 'danger' : undefined}>{pesos(t.saldo, t.moneda)}</Typography.Text> },
    { title: 'Pagado', key: 'pagado', ...derecha, render: (_: unknown, t) => (t.pagado ? pesos(t.pagado, t.moneda) : '') },
    {
      title: 'Pendiente', key: 'pendiente', ...derecha,
      render: (_: unknown, t) => (t.saldo < 0 ? <Tag color="red">debe</Tag> : t.pendiente === 0 ? <Tag color="green">pagado</Tag>
        : t.arrastradoA ? <Tag title="El saldo quedó como saldo anterior del mes siguiente, ya cerrado">pasó a {t.arrastradoA}</Tag> : <b>{pesos(t.pendiente, t.moneda)}</b>),
    },
    { title: '', key: 'pagar', ...derecha, render: (_: unknown, t) => t.pendiente > 0 && !t.arrastradoA && <Button size="small" type="primary" onClick={() => setPagando(t)}>Marcar pagado</Button> },
  ];
  const aPagar = (filas ?? []).filter((t) => t.pendiente > 0 && !t.arrastradoA);
  const totales = (moneda: 'ARS' | 'USD') => aPagar.filter((t) => t.moneda === moneda).reduce((s, t) => s + t.pendiente, 0);

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Select style={{ width: 160 }} value={mes} onChange={setMes} placeholder="Mes cerrado" options={periodos.map((p) => ({ value: p.mes, label: p.mes }))} />
          <Button disabled={!mes} onClick={exportar}>Exportar a Excel</Button>
          <Space><Switch size="small" checked={soloPendientes} onChange={setSoloPendientes} /> Solo pendientes</Space>
          {filas && <Typography.Text>Pendiente: <b>{pesos(totales('ARS'))}</b> · <b>{pesos(totales('USD'), 'USD')}</b> ({aPagar.length} deptos)</Typography.Text>}
        </Space>
      </Card>
      {!periodos.length && <Alert type="info" showIcon title="No hay meses cerrados: las transferencias salen al cerrar el mes en Liquidación." />}
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      <Table<Transferencia> rowKey="liquidacionId" size="small" pagination={false} sticky scroll={{ x: 'max-content' }} loading={!!mes && !filas}
        dataSource={soloPendientes ? aPagar : filas} columns={columnas}
        expandable={{
          rowExpandable: (t) => t.pagos.length > 0,
          expandedRowRender: (t) => (
            <Table size="small" pagination={false} rowKey="id" dataSource={t.pagos} columns={[
              { title: 'Fecha', dataIndex: 'fecha', render: (v: string, p) => (p.anulado ? <Typography.Text delete>{v}</Typography.Text> : v) },
              { title: 'Importe', dataIndex: 'importe', ...derecha, render: (v: number, p) => (p.anulado ? <Typography.Text delete>{pesos(v, t.moneda)}</Typography.Text> : pesos(v, t.moneda)) },
              { title: 'Cuenta', dataIndex: 'cuenta' },
              {
                title: 'Factura', key: 'factura', render: (_: unknown, p) => !t.esHornera && (
                  <EstadoFactura f={p.factura} anulado={p.anulado} alFacturar={() => setFacturando({ pagoId: p.id, codigo: t.codigo, moneda: t.moneda })}
                    alAnularFactura={() => setNc({ factura: p.factura as FacturaNC, codigo: t.codigo })} alPdf={() => pdfFactura(p.factura!.id)} />
                ),
              },
              {
                title: '', key: 'anular', ...derecha, render: (_: unknown, p) => (p.anulado ? <Tag>anulado</Tag> :
                  <Popconfirm title="El pago queda anulado (no se borra)." okText="Anular" cancelText="No" onConfirm={() => anular(p.id, t)}>
                    <Button size="small" danger>Anular</Button>
                  </Popconfirm>
                ),
              },
            ]} />
          ),
        }} />
      <FormPago t={pagando} fecha={periodos.find((p) => p.mes === mes)?.fecha_pago ?? ''} cuentas={cuentas}
        alCerrar={(guardado, pagoId) => {
          if (pagoId && pagando && !pagando.esHornera) setFacturando({ pagoId, codigo: pagando.codigo, moneda: pagando.moneda });  // ofrece la factura del pago
          setPagando(undefined);
          if (guardado) setVersion((v) => v + 1);
        }} />
      <FormFactura a={facturando} alCerrar={(cambio) => { setFacturando(undefined); if (cambio) setVersion((v) => v + 1); }} />
      <FormNotaCredito nc={nc} alCerrar={(cambio) => { setNc(undefined); if (cambio) setVersion((v) => v + 1); }} />
    </Space>
  );
}
