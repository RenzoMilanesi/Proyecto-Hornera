// Variables operativas del mes: tarifas de limpieza, lavandería, etc. que usa la liquidación.
// "Traer mes" las copia al mes siguiente, así que alcanza con cambiarlas en el mes abierto.
import { useEffect, useState } from 'react';
import { Alert, Button, Divider, Form, InputNumber, Modal, Space, Typography } from 'antd';
import { entradaPlata, enviar, get } from './api.ts';

const PLATA: [string, string, string?][] = [
  ['costo_hora_limpieza', 'Costo hora de limpieza'],
  ['servicio_limpieza', 'Servicio de limpieza', 'Costo hora × 1,4'],
  ['servicio_lavanderia', 'Servicio de lavandería'],
  ['prestamo_blanqueria', 'Préstamo de blanquería'],
  ['gestion_operativa', 'Gestión operativa'],
  ['mantenimiento', 'Mantenimiento'],
  ['tarifa_base', 'Tarifa base por reserva', '2 × (limpieza + lavandería + gestión) + mantenimiento'],
  ['adicional_huesped', 'Adicional por cada par de huéspedes extra'],
  ['cargo_tramo_1', 'Cargo de estadía larga 1'],
  ['cargo_tramo_2', 'Cargo de estadía larga 2'],
];
const aCentavos = (v: number | null | undefined) => Math.round((v ?? 0) * 100);

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
        ...Object.fromEntries(PLATA.map(([c]) => [c, p[c] / 100])),
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
        ...Object.fromEntries(PLATA.map(([c]) => [c, aCentavos(v[c])])),
        cm_fee_usd: aCentavos(v.cm_fee_usd), usd_descuento_pct: v.usd_descuento_pct / 100,
        noches_tramo_1: v.noches_tramo_1, noches_tramo_2: v.noches_tramo_2,
      });
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const requerido = [{ required: true, message: 'Falta el valor' }];
  return (
    <Modal open={abierto} title={`Variables operativas · ${mes}`} width={640} okText="Guardar" cancelText="Cancelar"
      onOk={guardar} onCancel={() => alCerrar(false)} okButtonProps={{ disabled: soloLectura }} destroyOnHidden>
      {soloLectura && <Alert type="info" showIcon title="El mes está cerrado: las variables quedan como se liquidó." style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" disabled={soloLectura}>
        <Space wrap size="middle" align="start">
          {PLATA.slice(0, 7).map(([campo, label, extra]) => (
            <Form.Item key={campo} name={campo} label={label} extra={extra} rules={requerido} style={{ width: 280 }}>
              <InputNumber {...entradaPlata} prefix="$" min={0} style={{ width: '100%' }} />
            </Form.Item>
          ))}
        </Space>
        <Button size="small" onClick={recalcular} disabled={soloLectura}>Recalcular servicio de limpieza y tarifa base</Button>
        <Divider />
        <Space wrap size="middle" align="start">
          <Form.Item name="adicional_huesped" label="Adicional por cada par de huéspedes extra" rules={requerido} style={{ width: 280 }}>
            <InputNumber {...entradaPlata} prefix="$" min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="cm_fee_usd" label="Channel manager por depto y mes" rules={requerido} style={{ width: 280 }}>
            <InputNumber {...entradaPlata} prefix="US$" min={0} style={{ width: '100%' }} />
          </Form.Item>
          {([1, 2] as const).map((n) => (
            <Form.Item key={n} label={`Estadía larga ${n}: cada tantas noches suma`} style={{ width: 280, marginBottom: 0 }}>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name={`noches_tramo_${n}`} rules={requerido} noStyle><InputNumber min={1} precision={0} suffix="noches" style={{ width: '45%' }} /></Form.Item>
                <Form.Item name={`cargo_tramo_${n}`} rules={requerido} noStyle><InputNumber {...entradaPlata} prefix="$" min={0} style={{ width: '55%' }} /></Form.Item>
              </Space.Compact>
            </Form.Item>
          ))}
          <Form.Item name="usd_descuento_pct" label="Descuento sobre el dólar cripto" rules={requerido} style={{ width: 280 }}>
            <InputNumber min={0} max={99.99} suffix="%" style={{ width: '100%' }} />
          </Form.Item>
        </Space>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
      <Typography.Text type="secondary">Se aplican a la liquidación de este mes. Los meses que se creen después con "traer mes" arrancan con estos valores.</Typography.Text>
    </Modal>
  );
}
