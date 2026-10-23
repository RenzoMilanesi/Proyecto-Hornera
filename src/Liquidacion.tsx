import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import type { LiquidacionDepto, LiquidacionPeriodo } from '../server/liquidacion/servicio.ts';
import { repartoCuenta, type CuentaLiquidacion } from '../server/liquidacion/motor.ts';
import type { ComparacionDepto } from '../server/liquidacion/comparar.ts';
import { enviar, get, pesos, subirArchivo } from './api.ts';
import { VariablesMes } from './Variables.tsx';
import { AjustesReserva, type ReservaAjustable } from './AjustesReserva.tsx';
import { FormMovimiento, TIPOS, type Cuenta, type Movimiento } from './Movimientos.tsx';

interface Periodo {
  mes: string; estado: string; usd_cotizacion: number | null; usd_descuento_pct: number;
  usd_cotizacion_fuente: 'api' | 'manual' | null; usd_cotizacion_fecha: string | null; provisoria: number;
}
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const derecha = { align: 'right' as const, onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }) };
const ars = (c: number) => (c ? pesos(c) : '');
const usd = (c: number) => (c ? pesos(c, 'USD') : '');

function Comparacion({ c }: { c?: ComparacionDepto }) {
  if (!c) return null;
  if (c.estado === 'igual') return <Tag color="green">igual al Excel</Tag>;
  if (c.estado === 'solo_excel') return <Tag color="orange">solo en el Excel</Tag>;
  if (c.estado === 'solo_app') return <Tag color="orange">no está en el Excel</Tag>;
  return <Tag color="red">{c.diferencias.length} diferencia{c.diferencias.length > 1 ? 's' : ''}</Tag>;
}

// Distribución del importe: la barra del reparto, grande en el detalle, `mini` en la fila de la tabla.
const TRAMOS = [
  { k: 'costos', nombre: 'Costos', color: '#B4B2A9' },
  { k: 'hornera', nombre: 'Hornera', color: '#F0997B' },
  { k: 'gastos', nombre: 'Gastos del depto', color: '#EF9F27' },
  { k: 'propietario', nombre: 'Propietario', color: '#1D9E75' },
  { k: 'deuda', nombre: 'Deuda del propietario', color: '#E24B4A' },
] as const;
function BarraReparto({ c, moneda, mini }: { c: CuentaLiquidacion; moneda?: 'ARS' | 'USD'; mini?: boolean }) {
  const r = repartoCuenta(c);
  const ancho = r.entro + r.deuda;
  if (r.entro <= 0) return null; // ponytail: sin barra cuando no entró plata; la cuenta de abajo lo explica
  const tramos = TRAMOS.filter((t) => r[t.k] > 0);
  const pct = (v: number) => `${Math.round((v / r.entro) * 100)}%`;
  const barra = (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', height: mini ? 8 : 26, minWidth: mini ? 120 : undefined, borderRadius: mini ? 4 : 6, overflow: 'hidden' }}>
        {tramos.map((t) => (
          <div key={t.k} title={mini ? undefined : `${t.nombre} ${pesos(r[t.k])}`}
            style={{ width: `${(r[t.k] / ancho) * 100}%`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, overflow: 'hidden',
              background: t.k === 'deuda' && !mini ? `repeating-linear-gradient(45deg, ${t.color} 0 4px, #F7C1C1 4px 8px)` : t.color }}>
            {!mini && t.k !== 'deuda' && r[t.k] / r.entro >= 0.1 ? pct(r[t.k]) : ''}
          </div>
        ))}
      </div>
      {/* Con deuda, la línea marca hasta dónde llegó lo que entró. */}
      {!mini && r.deuda > 0 && <div style={{ position: 'absolute', left: `${(r.entro / ancho) * 100}%`, top: -4, bottom: -4, borderLeft: '1.5px dashed #2A211B' }} />}
    </div>
  );
  if (mini) return <Tooltip title={tramos.map((t) => <div key={t.k}>{t.nombre}: {pesos(r[t.k])}</div>)}>{barra}</Tooltip>;
  return (
    <div>
      {barra}
      {/* Cada rótulo ocupa lo mismo que su tramo, así arranca debajo de él. Si el tramo es más angosto que
          el rótulo (max-content), el rótulo se estira y corre a los siguientes en vez de pisarlos. El último
          ocupa lo que sobra: con un ancho fijo, lo estirado sumaba más del 100% y aparecía un scroll horizontal. */}
      <div style={{ display: 'flex', marginTop: 6 }}>
        {tramos.map((t, i) => (
          <div key={t.k} style={{ flex: i === tramos.length - 1 ? '1 1 0' : `0 0 ${(r[t.k] / ancho) * 100}%`,
            minWidth: 'max-content', paddingRight: 16, whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: t.color, marginRight: 6 }} />
            <Typography.Text type="secondary">{t.nombre}{t.k === 'deuda' ? '' : ` ${pct(r[t.k])}`}</Typography.Text>
            <div><Typography.Text strong type={t.k === 'deuda' ? 'danger' : undefined}>{pesos(t.k === 'deuda' ? -r.deuda : r[t.k])}</Typography.Text></div>
          </div>
        ))}
      </div>
      <div><Typography.Text type="secondary">
        Sobre {pesos(r.entro)} que entraron{r.deuda > 0 ? ': los gastos superan lo que le tocaba al propietario (la línea punteada marca lo que entró)' : ''}
        {moneda === 'USD' ? ' · En pesos; el saldo pasa a dólares en la cuenta' : ''}.
      </Typography.Text></div>
    </div>
  );
}

// La cuenta de la liquidación renglón por renglón, con lo que compone cada uno y dónde se corrige.
// Las acciones solo con el mes abierto (`editar`); un mes cerrado está congelado.
interface Edicion {
  ajustar: (r: ReservaAjustable) => void;
  movimiento: (m?: Movimiento) => void;
  variables: () => void;
}
interface Renglon { key: string; concepto: string; importe: ReactNode; detalle?: ReactNode; total?: boolean }
// Título de cada sección del detalle, un poco más grande que el texto de las tablas.
const Titulo = ({ children }: { children: ReactNode }) => <Typography.Text strong style={{ fontSize: 16 }}>{children}</Typography.Text>;
type Fila =LiquidacionDepto['resultado']['reservas'][number] & { reserva: LiquidacionDepto['reservas'][number] };

function Detalle({ d, comparacion, movimientos, editar }: { d: LiquidacionDepto; comparacion?: ComparacionDepto; movimientos: Movimiento[]; editar?: Edicion }) {
  const r = d.resultado;
  const c = d.cuenta;
  const pct = `${(d.comisionPct * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
  const saldo = d.moneda === 'USD' ? r.saldo.usd : r.saldo.ars;
  const enlace = (texto: string, fn?: () => void) => (fn ? <Typography.Link onClick={fn}>{texto}</Typography.Link> : texto);
  const renglones: Renglon[] = [
    { key: 'ing', concepto: 'Ingresos operativos', importe: pesos(c.ingresosOperativos),
      detalle: <>Lo cobrado de las reservas del período{r.ingresos.usd ? ` (${pesos(r.ingresos.ars)} + ${pesos(r.ingresos.usd, 'USD')})` : ''}.{editar && ' Se corrige en cada reserva: Ajustar.'}</> },
    { key: 'cos', concepto: '− Costos', importe: pesos(c.costos),
      detalle: editar
        ? <>Costos operativos {pesos(-r.costosOperativos)} (tarifas: {enlace('Variables del mes', editar.variables)}) y comisiones OTA/CM {ars(-d.comisiones.ars)} {usd(-d.comisiones.usd)} (en cada reserva: Ajustar).</>
        : <>Costos operativos {pesos(-r.costosOperativos)} y comisiones OTA/CM {ars(-d.comisiones.ars)} {usd(-d.comisiones.usd)}.</> },
    { key: 'bru', concepto: 'Base de honorarios', importe: pesos(c.baseHonorarios), total: true },
    { key: 'hon', concepto: `− Honorarios (${pct})`, importe: pesos(c.honorarios), detalle: editar ? 'Comisión del depto: Deptos → Variables.' : undefined },
    { key: 'ini', concepto: 'Valor liquidación inicial', importe: pesos(c.valorInicial), total: true },
    { key: 'exc', concepto: '− Gastos Varios', importe: pesos(c.excepcionales),
      detalle: <>Gastos del depto y adelantos al propietario del mes ({movimientos.length}, abajo){editar && <> · {enlace('Agregar', () => editar.movimiento())}</>}.</> },
    { key: 'fin', concepto: 'Valor liquidación final', importe: pesos(c.valorFinal), total: true },
    { key: 'ant', concepto: 'Saldo mes anterior', importe: <>{ars(d.saldoAnterior.ars)} {usd(d.saldoAnterior.usd)}</> },
    // La cuenta ya está en pesos: solo el que liquida en dólares tiene un paso más.
    ...(d.moneda === 'USD' ? [{ key: 'conv', concepto: 'Pasado a dólares', importe: '',
      detalle: 'Liquida en dólares: los pesos pasan a USD con el cambio menos la comisión de cobro.' }] : []),
    ...(d.redondeo ? [{ key: 'red', concepto: 'Redondeo', importe: pesos(d.redondeo),
      detalle: 'La cuenta usa los totales redondeados como el Excel; el saldo, los valores exactos.' }] : []),
    { key: 'sal', concepto: 'Saldo a liquidar', importe: <Typography.Text type={saldo < 0 ? 'danger' : undefined}>{pesos(saldo, d.moneda)}</Typography.Text>, total: true },
  ];
  // Reservas: las columnas de plata que no tienen nada en ninguna reserva no se muestran, y abajo va el total.
  const filas: Fila[] = r.reservas.map((l, i) => ({ ...l, reserva: d.reservas[i] }));
  const sumar = (f: (l: Fila) => number) => filas.reduce((s, l) => s + f(l), 0);
  const hay = (f: (l: Fila) => number) => filas.some((l) => f(l) !== 0);
  const comisionArs = (l: Fila) => l.reserva.comision.ars;
  const comisionUsd = (l: Fila) => l.reserva.comision.usd;
  const totales: Record<string, ReactNode> = {
    reserva: 'Total', noches: `${sumar((l) => l.nochesPeriodo)} noches`,
    ars: ars(sumar((l) => l.importePeriodoArs)), usd: usd(sumar((l) => l.importePeriodoUsd)),
    tarifa: ars(sumar((l) => l.tarifaPeriodo)), com: <>{ars(sumar(comisionArs))} {usd(sumar(comisionUsd))}</>,
  };
  const columnasReservas: TableColumnsType<Fila> = [
    { title: 'Código Stays', key: 'reserva', render: (_: unknown, l) => <Typography.Text code>{l.reserva.codigo}</Typography.Text> },
    { title: 'Código plataforma', key: 'ota', render: (_: unknown, l) => l.reserva.codigo_ota && <Typography.Text code>{l.reserva.codigo_ota}</Typography.Text> },
    { title: 'Noches (período / total)', key: 'noches', render: (_: unknown, l) => `${l.nochesPeriodo} / ${l.nochesTotales}` },
    ...(hay((l) => l.importePeriodoArs) ? [{ title: 'Cobrado ARS', key: 'ars', dataIndex: 'importePeriodoArs', ...derecha, render: ars }] : []),
    ...(hay((l) => l.importePeriodoUsd) ? [{ title: 'Cobrado USD', key: 'usd', dataIndex: 'importePeriodoUsd', ...derecha, render: usd }] : []),
    { title: 'Tarifa', key: 'tarifa', dataIndex: 'tarifaPeriodo', ...derecha, render: ars },
    ...(hay(comisionArs) || hay(comisionUsd)
      ? [{ title: 'Comisión OTA', key: 'com', ...derecha, render: (_: unknown, l: Fila) => <>{ars(comisionArs(l))} {usd(comisionUsd(l))}</> }] : []),
    ...(editar ? [{
      title: '', key: 'aj', width: 80,
      render: (_: unknown, l: Fila) => <Button size="small" onClick={() => editar.ajustar({ ...l.reserva, depto: d.codigo, excluida: 0 })}>Ajustar</Button>,
    }] : []),
  ];
  return (
    // width 0 + minWidth 100%: el detalle ocupa el ancho de la fila sin agrandarlo. La tabla de deptos es
    // `scroll.x: max-content` y con `width: 100%` las tablas de adentro se estiraban a 1.000.000 px.
    <Space orientation="vertical" style={{ width: 0, minWidth: '100%' }}>
      {comparacion?.estado === 'distinto' && (
        <Alert type="error" showIcon title="Diferencias con el Excel" description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>{comparacion.diferencias.map((x, i) => (
            <li key={i}>{x.campo}{x.unidad === 'noches' ? '' : ` ${x.unidad}`}: app {x.unidad === 'noches' ? x.app : pesos(x.app, x.unidad)} · Excel {x.unidad === 'noches' ? x.excel : pesos(x.excel, x.unidad)}</li>
          ))}</ul>} />
      )}
      <Titulo>Distribución del importe</Titulo>
      <BarraReparto c={c} moneda={d.moneda} />
      <Titulo>Cuenta de la liquidación</Titulo>
      <Table<Renglon> size="small" pagination={false} showHeader={false} rowKey="key" dataSource={renglones}
        rowClassName={(x) => (x.total ? 'subtotal' : '')}
        columns={[
          { dataIndex: 'concepto', width: 240, render: (v: string, x) => (x.total ? <b>{v}</b> : v) },
          { dataIndex: 'importe', width: 170, ...derecha, render: (v: ReactNode, x) => (x.total ? <b>{v}</b> : v) },
          { dataIndex: 'detalle', render: (v?: ReactNode) => <Typography.Text type="secondary">{v}</Typography.Text> },
        ]} />
      <Titulo>Reservas · ingresos y costos</Titulo>
      <Table<Fila> size="small" pagination={false} rowKey={(l) => l.reserva.id} dataSource={filas} columns={columnasReservas}
        summary={() => filas.length > 1 && (
          <Table.Summary.Row className="subtotal">
            {columnasReservas.map((col, i) => (
              <Table.Summary.Cell key={col.key} index={i} align={col.align}><b>{totales[col.key as string]}</b></Table.Summary.Cell>
            ))}
          </Table.Summary.Row>
        )} />
      <Space>
        <Titulo>Gastos Varios</Titulo>
        {editar && <Button size="small" onClick={() => editar.movimiento()}>Agregar Nuevo Gasto</Button>}
      </Space>
      {movimientos.length === 0 && <Typography.Text type="secondary">Sin gastos ni adelantos del depto este mes.</Typography.Text>}
      {movimientos.length > 0 && (
        <Table<Movimiento> size="small" pagination={false} rowKey="id" dataSource={movimientos} columns={[
          { title: 'Fecha', dataIndex: 'fecha', width: 110 },
          { title: 'Tipo', dataIndex: 'tipo', render: (v: string) => TIPOS[v] ?? v },
          { title: 'Concepto', dataIndex: 'concepto' },
          { title: 'Detalle', dataIndex: 'detalle', ellipsis: true },
          { title: 'ARS', dataIndex: 'importe_ars', ...derecha, render: ars },
          { title: 'USD', dataIndex: 'importe_usd', ...derecha, render: usd },
          ...(editar ? [{ title: '', key: 'ed', width: 80, render: (_: unknown, m: Movimiento) => <Button size="small" onClick={() => editar.movimiento(m)}>Editar</Button> }] : []),
        ]} />
      )}
    </Space>
  );
}

export function Liquidacion() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [mes, setMes] = useState<string>();
  const [datos, setDatos] = useState<LiquidacionPeriodo>();
  const [error, setError] = useState<string>();
  const [cotizacion, setCotizacion] = useState<number | null>(null);
  const [comparacion, setComparacion] = useState<Map<string, ComparacionDepto>>();
  const [comparando, setComparando] = useState(false);
  const [texto, setTexto] = useState('');
  const [abiertos, setAbiertos] = useState<number[]>([]); // deptos desplegados: se resaltan
  const [variables, setVariables] = useState(false);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [conceptos, setConceptos] = useState<string[]>([]);
  const [ajustando, setAjustando] = useState<ReservaAjustable>();
  const [movimiento, setMovimiento] = useState<{ depto: string; editando?: Movimiento }>();

  const cargarPeriodos = () => get<Periodo[]>('periodos').then((ps) => {
    setPeriodos(ps);
    setMes((m) => m ?? (ps.find((p) => p.estado === 'abierto') ?? ps[0])?.mes);
    if (!ps.length) setError('No hay meses cargados: importá el Excel de un mes (Herramientas) o traelo de Stays.');
  });
  useEffect(() => {
    cargarPeriodos().catch((e) => setError(String(e)));
    get<Cuenta[]>('cuentas').then(setCuentas, () => {});
    get<{ nombre: string }[]>('conceptos').then((cs) => setConceptos(cs.map((c) => c.nombre)), () => {});
  }, []);

  const calcular = (m: string) => {
    setError(undefined);
    setComparacion(undefined); // una comparación vieja no vale para el cálculo nuevo
    get<LiquidacionPeriodo>(`liquidacion?mes=${m}`).then((d) => { setDatos(d); setCotizacion(d.cotizacion); }, (e) => setError(String(e)));
    // Los costos excepcionales del detalle: movimientos vigentes de cada depto, sin saldo inicial ni pagos.
    get<Movimiento[]>(`movimientos?mes=${m}`).then((ms) => setMovimientos(ms.filter((x) =>
      x.estado === 'vigente' && x.depto && x.tipo !== 'saldo_inicial' && x.tipo !== 'liquidacion')), (e) => setError(String(e)));
  };
  useEffect(() => { if (mes) calcular(mes); }, [mes]);

  const periodo = periodos.find((p) => p.mes === mes);
  const guardarCotizacion = async () => {
    if (!mes || !cotizacion) return;
    try {
      await enviar(`periodos/${mes}/cotizacion`, 'PUT', { cotizacion });
      await cargarPeriodos();
      calcular(mes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [ocupado, setOcupado] = useState<string>(); // acción en curso: 'cerrar', 'reabrir', 'pdf', 'pdf:OVL'…
  const [aviso, setAviso] = useState<string>();
  // El aviso de éxito (PDF guardado, cotización) se va solo a los 15 s.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(undefined), 15_000);
    return () => clearTimeout(t);
  }, [aviso]);
  const accion = async (cual: string, fn: () => Promise<unknown>, exito?: string) => {
    setOcupado(cual);
    setError(undefined);
    setAviso(undefined);
    try {
      await fn();
      if (exito) setAviso(exito);
      await cargarPeriodos();
      if (mes) calcular(mes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(undefined);
    }
  };
  const pdf = (depto?: string) => accion(depto ? `pdf:${depto}` : 'pdf', async () => {
    const r = await enviar<{ carpeta: string; archivos: string[]; en_servidor: boolean }>('liquidacion/pdf', 'POST', { mes, depto });
    setAviso(`${r.archivos.length === 1 ? 'PDF guardado' : `${r.archivos.length} PDF guardados`} en ${r.carpeta}${r.en_servidor ? ' de la PC servidor' : ''}`);
  });

  const comparar = async (archivo: File) => {
    setComparando(true);
    setError(undefined);
    try {
      const r = await subirArchivo<{ deptos: ComparacionDepto[] }>(`liquidacion/comparar?mes=${mes}`, archivo);
      setComparacion(new Map(r.deptos.map((d) => [d.codigo, d])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComparando(false);
    }
  };

  // Orden por Saldo: los que liquidan en dólares, pasados a pesos al cambio del mes, para compararlos con el resto.
  const saldoEnPesos = (d: LiquidacionDepto) => (d.moneda === 'USD' ? d.resultado.saldo.usd * (datos?.cambio ?? 0) : d.resultado.saldo.ars);
  // Orden por Reparto: la parte de lo que entró que le queda al propietario (con deuda, negativa).
  const parteDelPropietario = (d: LiquidacionDepto) => {
    const r = repartoCuenta(d.cuenta);
    return r.entro > 0 ? (r.propietario - r.deuda) / r.entro : 0;
  };
  const columnas: TableColumnsType<LiquidacionDepto> = [
    { title: 'Depto', dataIndex: 'codigo', width: 80, render: (v: string) => <b>{v}</b>, sorter: (a, b) => a.codigo.localeCompare(b.codigo) },
    { title: 'Propietario', dataIndex: 'propietario', ellipsis: true, sorter: (a, b) => a.propietario.localeCompare(b.propietario) },
    { title: 'Noches', key: 'noches', width: 90, render: (_: unknown, d) => `${d.resultado.nochesOcupadas} / ${d.resultado.nochesDisponibles}` },
    { title: 'Reparto', key: 'reparto', width: 160, render: (_: unknown, d) => <BarraReparto c={d.cuenta} mini />,
      sorter: (a, b) => parteDelPropietario(a) - parteDelPropietario(b) },
    {
      title: 'Saldo', key: 'saldo', ...derecha, sorter: (a, b) => saldoEnPesos(a) - saldoEnPesos(b),
      render: (_: unknown, d) => {
        const valor = d.moneda === 'USD' ? d.resultado.saldo.usd : d.resultado.saldo.ars;
        return <Typography.Text type={valor < 0 ? 'danger' : undefined} strong>{pesos(valor, d.moneda)}</Typography.Text>;
      },
    },
    ...(comparacion ? [{ title: 'Excel', key: 'excel', width: 150, render: (_: unknown, d: LiquidacionDepto) => <Comparacion c={comparacion.get(d.codigo)} /> }] : []),
    {
      title: '', key: 'pdf', width: 70,
      render: (_: unknown, d: LiquidacionDepto) => (
        <Button size="small" loading={ocupado === `pdf:${d.codigo}`} disabled={!!ocupado} onClick={() => pdf(d.codigo)}
          title={periodo?.estado === 'abierto' ? 'Vista previa: el mes todavía está abierto' : undefined}>PDF</Button>
      ),
    },
  ];
  const t = texto.trim().toLowerCase();
  const visibles = (datos?.deptos ?? []).filter((d) => !t || d.codigo.toLowerCase().includes(t) || d.propietario.toLowerCase().includes(t));
  const suma = (f: (d: LiquidacionDepto) => number) => visibles.reduce((s, d) => s + f(d), 0);
  // Saldos a favor de los propietarios; lo que falta transferir (descontando pagos) está en Transferencias.
  const saldos = (m: 'ARS' | 'USD') => suma((d) => (d.moneda === m ? Math.max(0, m === 'USD' ? d.resultado.saldo.usd : d.resultado.saldo.ars) : 0));
  const resumen = comparacion && [...comparacion.values()].reduce((s, c) => ({ ...s, [c.estado]: (s[c.estado] ?? 0) + 1 }), {} as Record<string, number>);
  const soloExcel = comparacion && [...comparacion.values()].filter((c) => c.estado === 'solo_excel').map((c) => c.codigo);

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="large">
          <Select style={{ width: 160 }} value={mes} onChange={setMes} placeholder="Mes"
            options={periodos.map((p) => ({ value: p.mes, label: `${p.mes} · ${p.estado}` }))} />
          {periodo && <Tag color={periodo.estado === 'abierto' ? 'blue' : 'green'}>{periodo.estado === 'abierto' ? 'abierto: los números todavía cambian' : 'cerrado'}</Tag>}
          <Space>
            <span>Dólar cripto al cierre</span>
            <InputNumber min={1} decimalSeparator="," value={cotizacion} onChange={setCotizacion} disabled={periodo?.estado !== 'abierto'} style={{ width: 120 }} />
            {periodo?.estado === 'abierto' && <Button onClick={guardarCotizacion} disabled={!cotizacion || cotizacion === datos?.cotizacion}>Guardar</Button>}
            {periodo?.usd_cotizacion_fuente === 'manual' && <Tag>manual</Tag>}
            {periodo?.usd_cotizacion_fuente === 'api' && periodo.usd_cotizacion_fecha && (
              <Tag color={periodo.provisoria ? 'orange' : 'green'}>{periodo.provisoria ? 'provisoria' : 'API'} · {ddmm(periodo.usd_cotizacion_fecha)}</Tag>
            )}
            {periodo?.estado === 'abierto' && (
              <Button loading={ocupado === 'dolar'} disabled={!!ocupado}
                onClick={() => accion('dolar', async () => {
                  const r = await enviar<{ aviso?: string }>(`periodos/${mes}/cotizacion/traer`, 'POST', {});
                  if (r.aviso) setAviso(r.aviso);
                })}>Pedir a la API</Button>
            )}
            {datos?.cambio != null && <Typography.Text type="secondary">cambio: {datos.cambio.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</Typography.Text>}
          </Space>
          {mes && <Button onClick={() => setVariables(true)}>Variables del mes</Button>}
          <Upload accept=".xlsx" showUploadList={false} disabled={!datos?.cambio || comparando}
            beforeUpload={(archivo) => { comparar(archivo); return false; }}>
            <Button loading={comparando} disabled={!datos?.cambio}>Comparar con el Excel del mes</Button>
          </Upload>
          {periodo?.estado === 'abierto' && (
            <Popconfirm title={`¿Cerrar ${mes}?`}
              description={<>La liquidación queda guardada y el mes congelado. Se puede reabrir mientras no haya pagos.
                {periodo.provisoria && periodo.usd_cotizacion_fecha
                  ? <><br /><Typography.Text type="warning">La cotización es provisoria (del {ddmm(periodo.usd_cotizacion_fecha)}), no la del cierre.</Typography.Text></> : null}</>}
              okText="Cerrar mes" cancelText="No" disabled={!datos?.cambio}
              onConfirm={() => accion('cerrar', () => enviar(`periodos/${mes}/cerrar`, 'POST', {}), `${mes} cerrado.`)}>
              <Button type="primary" disabled={!datos?.cambio || !!ocupado} loading={ocupado === 'cerrar'}>Cerrar mes</Button>
            </Popconfirm>
          )}
          {periodo?.estado === 'cerrado' && (
            <>
              <Button disabled={!!ocupado} loading={ocupado === 'pdf'} onClick={() => pdf()}>PDF de todos los deptos</Button>
              <Popconfirm title={`¿Reabrir ${mes}?`} description="Se borra la liquidación guardada y se vuelve a calcular. No se puede si ya hay pagos."
                okText="Reabrir" cancelText="No"
                onConfirm={() => accion('reabrir', () => enviar(`periodos/${mes}/reabrir`, 'POST', {}), `${mes} reabierto.`)}>
                <Button danger disabled={!!ocupado} loading={ocupado === 'reabrir'}>Reabrir mes</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </Card>

      {mes && <VariablesMes mes={mes} abierto={variables} alCerrar={(guardado) => { setVariables(false); if (guardado) calcular(mes); }} />}
      <AjustesReserva reserva={ajustando} alCerrar={(guardado) => { setAjustando(undefined); if (guardado && mes) calcular(mes); }} />
      {mes && <FormMovimiento abierto={!!movimiento} mes={mes} editando={movimiento?.editando} depto={movimiento?.depto}
        deptos={(datos?.deptos ?? []).map((d) => d.codigo)} cuentas={cuentas} conceptos={conceptos}
        alCerrar={(guardado) => { setMovimiento(undefined); if (guardado) calcular(mes); }} />}
      {error && <Alert type="error" showIcon title={error} />}
      {aviso && <Alert type="success" showIcon closable title={aviso} onClose={() => setAviso(undefined)} />}
      {datos?.avisos.length ? <Alert type="warning" showIcon title="Avisos" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{datos.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>} /> : null}
      {resumen && (
        <Alert type={resumen.distinto || resumen.solo_excel || resumen.solo_app ? 'warning' : 'success'} showIcon
          title={`Comparación con el Excel: ${resumen.igual ?? 0} iguales, ${resumen.distinto ?? 0} con diferencias`
            + (resumen.solo_app ? `, ${resumen.solo_app} solo en la app` : '')}
          description={soloExcel?.length ? `Hojas del Excel sin liquidación en la app: ${soloExcel.join(', ')}` : undefined} />
      )}

      <Space wrap size="middle">
        <Input.Search allowClear placeholder="Buscar depto o propietario" style={{ width: 280 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
        {datos && (
          <Typography.Text type="secondary">
            {visibles.length} deptos · Bruto <b>{pesos(suma((d) => d.resultado.bruto))}</b> · Honorarios <b>{pesos(suma((d) => d.resultado.honorarios))}</b>
            {' '}· Saldos <b>{pesos(saldos('ARS'))}</b> · <b>{pesos(saldos('USD'), 'USD')}</b>
          </Typography.Text>
        )}
      </Space>
      <Table<LiquidacionDepto> rowKey="deptoId" size="small" pagination={false} sticky scroll={{ x: "max-content" }} loading={!datos && !error}
        dataSource={visibles} columns={columnas}
        rowClassName={(d) => (abiertos.includes(d.deptoId) ? 'fila-abierta' : '')}
        expandable={{
          expandedRowKeys: abiertos, onExpandedRowsChange: (k) => setAbiertos(k as number[]), expandedRowClassName: () => 'detalle-abierto',
          expandedRowRender: (d) => <Detalle d={d} comparacion={comparacion?.get(d.codigo)} movimientos={movimientos.filter((m) => m.depto === d.codigo)}
            editar={periodo?.estado === 'abierto' ? {
              ajustar: setAjustando, variables: () => setVariables(true),
              movimiento: (m) => setMovimiento({ depto: d.codigo, editando: m }),
            } : undefined} />,
        }} />
    </Space>
  );
}
