// Variables operativas del mes: tarifas de limpieza, lavandería, etc. que usa la liquidación.
// "Traer mes" las copia al mes siguiente, así que alcanza con cambiarlas en el mes abierto.
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Col, Form, InputNumber, Modal, Row, Tag, Typography } from 'antd';
import { entradaPlata, enviar, get, useUnaVez } from './api.ts';

// Campos en pesos (centavos en la base).
const PLATA = ['costo_hora_limpieza', 'servicio_limpieza', 'servicio_lavanderia', 'prestamo_blanqueria', 'gestion_operativa',
  'mantenimiento', 'tarifa_base', 'adicional_huesped', 'cargo_tramo_1', 'cargo_tramo_2'];
const aCentavos = (v: number | null | undefined) => Math.round((v ?? 0) * 100);
const requerido = [{ required: true, message: 'Falta el valor' }];

const Plata = ({ name, label, extra, prefix = '$' }: { name: string; label: string; extra?: ReactNode; prefix?: string }) => (
  <Form.Item name={name} label={label} extra={extra} rules={requerido}>
    <InputNumber {...entradaPlata} prefix={prefix} min={0} style={{ width: '100%' }} />
  </Form.Item>
);
const Seccion = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <>
    <Typography.Text strong>{titulo}</Typography.Text>
    <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>{children}</Typography.Paragraph>
  </>
);

export function VariablesMes({ mes, abierto, alCerrar }: { mes: string; abierto: boolean; alCerrar: (guardado: boolean) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  const [soloLectura, setSoloLectura] = useState(true);

  useEffect(() => {
    if (!abierto) return;
    setError(undefined);
    get<Record<string, any>>(`periodos/${mes}/parametros`).then((p) => {
      setSoloLectura(p.estado !== 'abierto');
      form.setFieldsValue({
        ...Object.fromEntries(PLATA.map((c) => [c, p[c] / 100])),
        cm_fee_usd: p.cm_fee_usd / 100, usd_descuento_pct: p.usd_descuento_pct * 100,
        noches_tramo_1: p.noches_tramo_1, noches_tramo_2: p.noches_tramo_2,
      });
    }, (e) => setError(String(e)));
  }, [abierto, mes, form]);

  // Las fórmulas de la hoja del Excel: proponen, el usuario puede corregir antes de guardar.
  const recalcular = () => {
    const v = form.getFieldsValue();
    const limpieza = Math.round(v.costo_hora_limpieza * 1.4 * 100) / 100;
    form.setFieldsValue({ servicio_limpieza: limpieza, tarifa_base: 2 * (limpieza + v.servicio_lavanderia + v.gestion_operativa) + v.mantenimiento });
  };

  const guardar = async () => {
    const v = await form.validateFields();
    try {
      await enviar(`periodos/${mes}/parametros`, 'PUT', {
        ...Object.fromEntries(PLATA.map((c) => [c, aCentavos(v[c])])),
        cm_fee_usd: aCentavos(v.cm_fee_usd), usd_descuento_pct: v.usd_descuento_pct / 100,
        noches_tramo_1: v.noches_tramo_1, noches_tramo_2: v.noches_tramo_2,
      });
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [guardarUnaVez, guardando] = useUnaVez(guardar);
  return (
    <Modal open={abierto} title={`Variables operativas de ${mes}`} width={560} okText="Guardar" cancelText="Cancelar"
      onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} okButtonProps={{ disabled: soloLectura }} destroyOnHidden>
      <dl className="ficha">
        <dt>Mes</dt><dd><b>{mes}</b> {soloLectura ? <Tag color="green">cerrado</Tag> : <Tag color="blue">abierto</Tag>}</dd>
        <dt>Se aplica</dt>
        <dd>{soloLectura ? 'Quedan como se liquidó el mes; no se pueden cambiar.'
          : 'A la liquidación de este mes. Los meses que se creen después con "traer mes" arrancan con estos valores.'}</dd>
      </dl>
      <Form form={form} layout="vertical" disabled={soloLectura}>
        <Seccion titulo="Limpieza y servicios">Costo de cada servicio por reserva.</Seccion>
        <Row gutter={12}>
          <Col span={12}><Plata name="costo_hora_limpieza" label="Costo hora de limpieza" /></Col>
          <Col span={12}><Plata name="servicio_limpieza" label="Servicio de limpieza" extra="Costo hora × 1,4" /></Col>
          <Col span={12}><Plata name="servicio_lavanderia" label="Servicio de lavandería" /></Col>
          <Col span={12}><Plata name="prestamo_blanqueria" label="Préstamo de blanquería" /></Col>
          <Col span={12}><Plata name="gestion_operativa" label="Gestión operativa" /></Col>
          <Col span={12}><Plata name="mantenimiento" label="Mantenimiento" /></Col>
        </Row>

        <Seccion titulo="Tarifa por reserva">
          Base = 2 × (limpieza + lavandería + gestión) + mantenimiento.{' '}
          {!soloLectura && <Typography.Link onClick={recalcular}>Recalcular desde el costo hora</Typography.Link>}
        </Seccion>
        <Row gutter={12}>
          <Col span={12}><Plata name="tarifa_base" label="Tarifa base" /></Col>
          <Col span={12}><Plata name="adicional_huesped" label="Por cada par de huéspedes extra" /></Col>
        </Row>

        <Seccion titulo="Estadías largas">Cada tantas noches de la estadía se suma el cargo.</Seccion>
        {([1, 2] as const).map((n) => (
          <Row gutter={12} key={n}>
            <Col span={12}>
              <Form.Item name={`noches_tramo_${n}`} label={`Tramo ${n}: cada`} rules={requerido}>
                <InputNumber min={1} precision={0} suffix="noches" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}><Plata name={`cargo_tramo_${n}`} label="Suma" /></Col>
          </Row>
        ))}

        <Seccion titulo="Dólar y channel manager">El descuento se resta al dólar cripto del cierre.</Seccion>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="usd_descuento_pct" label="Descuento sobre el dólar cripto" rules={requerido}>
              <InputNumber min={0} max={99.99} precision={2} decimalSeparator="," suffix="%" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}><Plata name="cm_fee_usd" label="Channel manager por depto y mes" prefix="US$" /></Col>
        </Row>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}
