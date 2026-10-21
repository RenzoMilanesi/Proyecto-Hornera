// Ajustes manuales de una reserva (las pestañas 🖊 del Excel). "Traer mes" no los pisa.
import { useEffect, useState } from 'react';
import { Alert, Col, Form, Input, InputNumber, Modal, Row, Switch, Typography } from 'antd';
import { entradaPlata, enviar, useUnaVez } from './api.ts';

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

  const numero = { ...entradaPlata, style: { width: '100%' }, step: 100 };
  const [guardarUnaVez, guardando] = useUnaVez(guardar);
  return (
    <Modal open={!!reserva} title={reserva && `Ajustes de la reserva ${reserva.codigo} (${reserva.depto})`}
      okText="Guardar" cancelText="Cancelar" onOk={guardarUnaVez} confirmLoading={guardando} onCancel={() => alCerrar(false)} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Typography.Text strong>Corrección de lo cobrado</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>Se suma a lo cobrado en Stays (negativo para restar).</Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Pesos" name="ajuste_ars"><InputNumber {...numero} prefix="$" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Dólares" name="ajuste_usd"><InputNumber {...numero} prefix="US$" /></Form.Item></Col>
        </Row>
        <Typography.Text strong>Comisión OTA / agente</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>Cobrada por la plataforma o el agente (Booking reducida, Alq. Argentina, otros).</Typography.Paragraph>
        <Row gutter={12}>
          <Col span={12}><Form.Item label="Pesos" name="ajuste_comision_ars"><InputNumber {...numero} min={0} prefix="$" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Dólares" name="ajuste_comision_usd"><InputNumber {...numero} min={0} prefix="US$" /></Form.Item></Col>
        </Row>
        <Form.Item label="Observación" name="observacion"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item label="Excluir de la liquidación" name="excluida" valuePropName="checked"><Switch /></Form.Item>
      </Form>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  );
}
