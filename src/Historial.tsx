// Historial de pagos de un depto o de un propietario: lo liquidado, lo pagado y lo pendiente mes a mes.
// Sin props es la pantalla del menú (con selector); con deptoId o propietarioId, el panel de Deptos/Propietarios.
import { useEffect, useState } from 'react';
import { Alert, Button, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { FilaHistorial } from '../server/liquidacion/historial.ts';
import { enviar, get, pesos } from './api.ts';
import { EstadoFactura, FormNotaCredito, FormPago, type FacturaNC } from './Transferencias.tsx';

interface Cuenta { id: number; nombre: string; moneda: 'ARS' | 'USD'; activo: number }
interface Periodo { mes: string; fecha_pago: string }

const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const ESTADOS: Record<FilaHistorial['estado'], { color: string; label: string }> = {
  pagado: { color: 'green', label: 'pagado' },
  parcial: { color: 'gold', label: 'parcial' },
  pendiente: { color: 'blue', label: 'pendiente' },
  debe: { color: 'red', label: 'debe' },
  arrastrado: { color: 'default', label: 'pasó al mes siguiente' },
  en_curso: { color: 'purple', label: 'en curso' },
};

export function Historial({ deptoId, propietarioId }: { deptoId?: number; propietarioId?: number }) {
  const fijo = deptoId ? `d:${deptoId}` : propietarioId ? `p:${propietarioId}` : undefined;
  const [elegido, setElegido] = useState(fijo);
  const [opciones, setOpciones] = useState<{ label: string; options: { value: string; label: string }[] }[]>([]);
  const [filas, setFilas] = useState<FilaHistorial[]>();
  const [anulados, setAnulados] = useState(false);
  const [filtroDepto, setFiltroDepto] = useState<number>();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [pagando, setPagando] = useState<FilaHistorial>();
  const [nc, setNc] = useState<{ factura: FacturaNC; codigo: string }>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    get<Cuenta[]>('cuentas').then(setCuentas);
    get<Periodo[]>('periodos').then(setPeriodos);
    if (fijo) return;
    Promise.all([get<{ id: number; codigo: string; nombre: string }[]>('deptos'), get<{ id: number; nombre: string }[]>('propietarios')]).then(([ds, ps]) => setOpciones([
      { label: 'Propietarios', options: ps.map((p) => ({ value: `p:${p.id}`, label: p.nombre })) },
      { label: 'Deptos', options: ds.map((d) => ({ value: `d:${d.id}`, label: `${d.codigo} · ${d.nombre}` })) },
    ]), (e) => setError(String(e)));
  }, [fijo]);
  useEffect(() => {
    if (!elegido) return;
    const [tipo, id] = elegido.split(':');
    setFilas(undefined);
    get<FilaHistorial[]>(`historial?${tipo === 'd' ? 'depto' : 'propietario'}=${id}${anulados ? '&anulados=1' : ''}`)
      .then(setFilas, (e) => setError(String(e)));
  }, [elegido, anulados, version]);

  const anular = async (id: number, codigo: string) => {
    try {
      const { facturaVigente } = await enviar<{ facturaVigente: FacturaNC | null }>(`movimientos/${id}/anular`, 'POST', {});
      if (facturaVigente) setNc({ factura: facturaVigente, codigo });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const porPropietario = elegido?.startsWith('p:');
  const deptos = [...new Map((filas ?? []).map((f) => [f.deptoId, f.codigo])).entries()];
  const visibles = (filas ?? []).filter((f) => !filtroDepto || f.deptoId === filtroDepto);
  // En curso y "pasó al mes siguiente" no suman: lo primero puede cambiar y lo segundo ya está en el mes siguiente.
  const total = (moneda: 'ARS' | 'USD', f: (x: FilaHistorial) => number) => visibles.filter((x) => x.moneda === moneda).reduce((s, x) => s + f(x), 0);
  const pagado = (m: 'ARS' | 'USD') => total(m, (x) => x.pagado);
  const pendiente = (m: 'ARS' | 'USD') => total(m, (x) => (x.estado === 'pendiente' || x.estado === 'parcial' ? x.pendiente : 0));
  const debe = (m: 'ARS' | 'USD') => total(m, (x) => (x.estado === 'debe' ? -x.saldo : 0));
  const ambas = (f: (m: 'ARS' | 'USD') => number) => `${pesos(f('ARS'))} · ${pesos(f('USD'), 'USD')}`;

  const columnas: TableColumnsType<FilaHistorial> = [
    { title: 'Mes', dataIndex: 'mes', width: 90 },
    { title: 'Depto', dataIndex: 'codigo', width: 80, render: (v: string) => <b>{v}</b> },
    // Por depto se ve quién era el dueño cada mes (puede haber cambiado).
    ...(porPropietario ? [] : [{ title: 'Propietario', dataIndex: 'propietario', ellipsis: true }]),
    { title: 'Saldo', dataIndex: 'saldo', ...derecha, render: (v: number, f) => <Typography.Text type={v < 0 ? 'danger' : undefined}>{pesos(v, f.moneda)}</Typography.Text> },
    { title: 'Pagado', dataIndex: 'pagado', ...derecha, render: (v: number, f) => (v ? pesos(v, f.moneda) : '') },
    { title: 'Pendiente', dataIndex: 'pendiente', ...derecha, render: (v: number, f) => (f.estado === 'pendiente' || f.estado === 'parcial' ? <b>{pesos(v, f.moneda)}</b> : '') },
    { title: 'Estado', dataIndex: 'estado', width: 170, render: (v: FilaHistorial['estado'], f) =>
      <Tag color={ESTADOS[v].color}>{v === 'arrastrado' && f.arrastradoA ? `pasó a ${f.arrastradoA}` : ESTADOS[v].label}</Tag> },
    { title: '', key: 'pagar', ...derecha, render: (_: unknown, f) => (f.estado === 'pendiente' || f.estado === 'parcial')
      && <Button size="small" type="primary" onClick={() => setPagando(f)}>Marcar pagado</Button> },
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size="middle">
        {!fijo && (
          <Select showSearch optionFilterProp="label" placeholder="Elegí un propietario o un depto" style={{ width: 340 }}
            value={elegido} onChange={(v) => { setElegido(v); setFiltroDepto(undefined); }} options={opciones} />
        )}
        {porPropietario && deptos.length > 1 && (
          <Select allowClear placeholder="Todos sus deptos" style={{ width: 160 }} value={filtroDepto} onChange={setFiltroDepto}
            options={deptos.map(([id, codigo]) => ({ value: id, label: codigo }))} />
        )}
        {elegido && <Space><Switch size="small" checked={anulados} onChange={setAnulados} /> Ver anulados</Space>}
      </Space>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(undefined)} />}
      {!elegido ? <Alert type="info" showIcon title="Elegí un propietario o un depto para ver sus pagos mes a mes." /> : (
        <>
          {filas && (
            <Typography.Text>
              Pagado <b>{ambas(pagado)}</b> · Pendiente <b>{ambas(pendiente)}</b>
              {(debe('ARS') || debe('USD')) ? <> · Debe <Typography.Text type="danger" strong>{ambas(debe)}</Typography.Text></> : null}
            </Typography.Text>
          )}
          <Table<FilaHistorial> rowKey={(f) => `${f.mes}-${f.deptoId}`} size="small" pagination={false} sticky scroll={{ x: 'max-content' }}
            loading={!filas && !error} dataSource={visibles} columns={columnas}
            expandable={{
              rowExpandable: (f) => f.pagos.length > 0,
              expandedRowRender: (f) => (
                <Table size="small" pagination={false} rowKey="id" dataSource={f.pagos} columns={[
                  { title: 'Fecha', dataIndex: 'fecha', render: (v: string, p) => (p.anulado ? <Typography.Text delete>{v}</Typography.Text> : v) },
                  { title: 'Importe', dataIndex: 'importe', ...derecha, render: (v: number, p) => (p.anulado ? <Typography.Text delete>{pesos(v, f.moneda)}</Typography.Text> : pesos(v, f.moneda)) },
                  { title: 'Cuenta', dataIndex: 'cuenta' },
                  // Solo la marca de un pago anulado con la factura vigente; facturar se hace desde Transferencias.
                  { title: '', key: 'factura', render: (_: unknown, p) => p.anulado && (
                    <EstadoFactura f={p.factura} anulado alFacturar={() => {}} alAnularFactura={() => setNc({ factura: p.factura as FacturaNC, codigo: f.codigo })} />
                  ) },
                  { title: '', key: 'anular', ...derecha, render: (_: unknown, p) => (p.anulado ? <Tag>anulado</Tag> : (
                    <Popconfirm title="El pago queda anulado (no se borra)." okText="Anular" cancelText="No" onConfirm={() => anular(p.id, f.codigo)}>
                      <Button size="small" danger>Anular</Button>
                    </Popconfirm>
                  )) },
                ]} />
              ),
            }} />
        </>
      )}
      <FormPago t={pagando && { ...pagando, liquidacionId: pagando.liquidacionId! }} cuentas={cuentas}
        fecha={periodos.find((p) => p.mes === pagando?.mes)?.fecha_pago ?? ''}
        alCerrar={(guardado) => { setPagando(undefined); if (guardado) setVersion((v) => v + 1); }} />
      <FormNotaCredito nc={nc} alCerrar={(cambio) => { setNc(undefined); if (cambio) setVersion((v) => v + 1); }} />
    </Space>
  );
}
