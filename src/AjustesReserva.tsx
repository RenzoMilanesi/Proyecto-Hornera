// Ajustes manuales de una reserva (las pestañas 🖊 del Excel). "Traer mes" no los pisa.
import { useEffect, useState } from 'react';
import { Alert, Form, Input, InputNumber, Modal, Switch } from 'antd';
import { enviar } from './api.ts';

export interface ReservaAjustable {
  id: number; codigo: string; depto: string;
  ajuste_ars: number; ajuste_usd: number; ajuste_comision_ars: number; ajuste_comision_usd: number;
  observacion: string | null; excluida: number;
}

// En pantalla en pesos/dólares; la API trabaja en centavos.
const aCentavos = (v: number | null | undefined) => Math.round((v ?? 0) * 100);

export function AjustesReserva({ reserva, alCerrar }: { reserva?: ReservaAjustable; alCerrar: (guardado: boolean) => void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setError(undefined);
    if (reserva) form.setFieldsValue({
      ajuste_ars: reserva.ajuste_ars / 100, ajuste_usd: reserva.ajuste_usd / 100,
      ajuste_comision_ars: reserva.ajuste_comision_ars / 100, ajuste_comision_usd: reserva.ajuste_comision_usd / 100,
      observacion: reserva.observacion ?? '', excluida: !!reserva.excluida,
    });
  }, [reserva, form]);

  const guardar = async () => {
    const v = form.getFieldsValue();
    try {
      await enviar(`reservas/${reserva!.id}`, 'PUT', {
        ajuste_ars: aCentavos(v.ajuste_ars), ajuste_usd: aCentavos(v.ajuste_usd),
        ajuste_comision_ars: aCentavos(v.ajuste_comision_ars), ajuste_comision_usd: aCentavos(v.ajuste_comision_usd),
        observacion: v.observacion || null, excluida: v.excluida ? 1 : 0,
      });
      alCerrar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const numero = { style: { width: '100%' }, step: 100, decimalSeparator: ',' };
  return (
    <Modal open={!!reserva} title={reserva && `Ajustes de la reserva ${reserva.codigo} (${reserva.depto})`}
      okText="Guardar" cancelText="Cancelar" onOk={guardar} onCancel={() => alCerrar(false)} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="Corrección de lo cobrado ARS" name="ajuste_ars" extra="Se suma a lo cobrado en Stays (negativo para restar)."><InputNumber {...numero} /></Form.Item>
        <Form.Item label="Corrección de lo cobrado USD" name="ajuste_usd"><InputNumber {...numero} /></Form.Item>
        <Form.Item label="Comisión OTA / agente ARS" name="ajuste_comision_ars" extra="Comisión cobrada por la plataforma o el agente (Booking reducida, Alq. Argentina, otros)."><InputNumber {...numero} min={0} /></Form.Item>
        <Form.Item label="Comisión OTA / agente USD" name="ajuste_comision_usd"><InputNumber {...numero} min={0} /></Form.Item>
        <Form.Item label="Observación" name="observacion"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item label="Excluir de la liquidación" name="excluida" valuePropName="checked"><Switch /></Form.Item>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}
