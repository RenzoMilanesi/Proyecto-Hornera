// Resumen interno (fase 6): KPIs por depto, resultado de Hornera, saldos de cuentas y evolución mensual.
// Mes cerrado: sale del snapshot (`liquidacion`). Mes abierto: del motor, como la pantalla Liquidación.
import type { DatabaseSync } from 'node:sqlite';
import { liquidacionGuardada, liquidarPeriodo } from './liquidacion/servicio.ts';
import { listarTransferencias } from './liquidacion/pagos.ts';
import { listarLiquidaciones } from './limpieza.ts';
import { vencimientos } from './ficha.ts';
import { SQL_DE_HORNERA } from './misComprobantes.ts';

export interface KpiDepto {
  codigo: string;
  nombre: string;
  noches_disponibles: number; // sin las bloqueadas
  noches_ocupadas: number;    // incluye las del propietario
  noches_propietario: number;
  reservas: number;
  bruto: number;              // ARS + USD × cambio, centavos
  alojamiento: number;        // lo que pagaron los huéspedes por las noches, sin tarifa por estadía ni propietario
  valor_inicial: number;      // lo que le queda al propietario antes de los gastos varios
  costos_operativos: number;  // tarifa por estadía cobrada al propietario (ARS)
  honorarios: number;         // positivo: lo que cobra Hornera
}

type Noches = Pick<KpiDepto, 'noches_disponibles' | 'noches_ocupadas' | 'noches_propietario' | 'alojamiento' | 'valor_inicial'>;

// Métricas del glosario (pedido 2026-10-23). Las estadías del propietario no son noches vendidas ni a la venta.
// Ocupación = vendidas / a la venta; ADR = alojamiento / vendidas; RevPAR = alojamiento / a la venta (= ADR × ocupación);
// neto por noche = valor inicial / vendidas.
export function metricas(k: Noches) {
  const venta = k.noches_disponibles - k.noches_propietario;
  const vendidas = k.noches_ocupadas - k.noches_propietario;
  const por = (x: number, n: number) => (n > 0 ? Math.round(x / n) : null);
  return {
    noches_venta: venta, noches_vendidas: vendidas, ocupacion: venta > 0 ? vendidas / venta : null,
    adr: por(k.alojamiento, vendidas), revpar: por(k.alojamiento, venta), neto_noche: por(k.valor_inicial, vendidas),
  };
}

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

// Resultado de Hornera = honorarios + costos operativos cobrados + ingresos/gastos de la empresa (INT).
// ponytail: así lo entendemos del Excel; confirmarlo con los dueños (DECISIONES, "Pendiente").
const SQL_EMPRESA = `
  SELECT COALESCE(SUM(m.importe_ars), 0) AS ars, COALESCE(SUM(m.importe_usd), 0) AS usd
  FROM movimiento m JOIN periodo p ON p.id = m.periodo_id
  WHERE p.mes = ? AND m.depto_id IS NULL AND m.estado = 'vigente' AND m.tipo IN ('gasto', 'ingreso', 'ajuste')`;

function kpisDelMes(db: DatabaseSync, mes: string): { estado: string; deptos: KpiDepto[]; avisos: string[] } {
  const p = db.prepare('SELECT estado FROM periodo WHERE mes = ?').get(mes) as { estado: string } | undefined;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  const calculo = p.estado === 'cerrado' ? liquidacionGuardada(db, mes) : liquidarPeriodo(db, mes);
  // Un mes importado del Excel no tiene el detalle de reservas: la cantidad sale del snapshot.
  const cantidad = new Map((db.prepare(`
    SELECT l.depto_id AS id, l.cant_reservas AS n FROM liquidacion l JOIN periodo p ON p.id = l.periodo_id WHERE p.mes = ?`)
    .all(mes) as { id: number; n: number }[]).map((x) => [x.id, x.n]));
  return {
    estado: p.estado,
    avisos: calculo.avisos,
    deptos: calculo.deptos.map(({ deptoId, codigo, nombre, resultado: r, cuenta }) => ({
      codigo, nombre, noches_disponibles: r.nochesDisponibles, noches_ocupadas: r.nochesOcupadas, noches_propietario: r.nochesPropietario,
      reservas: cantidad.get(deptoId) ?? r.reservas.length, bruto: r.bruto, alojamiento: r.alojamiento, valor_inicial: cuenta.valorInicial,
      costos_operativos: r.costosOperativos, honorarios: -r.honorarios + 0,
    })),
  };
}

export function resumenDelMes(db: DatabaseSync, mes: string) {
  const { estado, deptos, avisos } = kpisDelMes(db, mes);
  const suma = (k: keyof KpiDepto) => deptos.reduce((s, d) => s + (d[k] as number), 0);
  const { ars, usd } = db.prepare(SQL_EMPRESA).get(mes) as { ars: number; usd: number };
  const empresa = { ars, usd };
  const honorarios = suma('honorarios');
  const costos = suma('costos_operativos');
  const conMetricas = deptos.map((d) => ({ ...d, ...metricas(d) }));
  const totales = {
    noches_disponibles: suma('noches_disponibles'), noches_ocupadas: suma('noches_ocupadas'), noches_propietario: suma('noches_propietario'),
    reservas: suma('reservas'), bruto: suma('bruto'), alojamiento: suma('alojamiento'), valor_inicial: suma('valor_inicial'),
  };
  return {
    mes, estado, avisos, deptos: conMetricas,
    totales: {
      ...totales, ...metricas(totales),
      // Mediana por depto: un depto muy grande o muy chico no mueve el número de la cartera.
      revpar_mediana: mediana(conMetricas.flatMap((d) => (d.revpar == null ? [] : [d.revpar]))),
      honorario_efectivo: totales.bruto > 0 ? honorarios / totales.bruto : null, // honorarios sobre el bruto, no sobre la base
    },
    resultado: { honorarios, costos_operativos: costos, empresa, total_ars: honorarios + costos + empresa.ars },
    cuentas: db.prepare('SELECT nombre, moneda, saldo FROM v_saldo_cuenta WHERE activo = 1 ORDER BY moneda, nombre').all(),
  };
}

// Un renglón por mes: los cerrados en la app (o importados del Excel) con todo; los anteriores, solo
// con las noches del histórico (hoja OCUPACION). Los meses abiertos no entran: todavía cambian.
export function evolucion(db: DatabaseSync) {
  const cerrados = (db.prepare(`
    SELECT mes FROM periodo p WHERE estado = 'cerrado' AND EXISTS (SELECT 1 FROM liquidacion l WHERE l.periodo_id = p.id)`)
    .all() as { mes: string }[]).map(({ mes }) => {
    const { totales: t, resultado } = resumenDelMes(db, mes);
    return {
      mes, noches_disponibles: t.noches_disponibles, noches_ocupadas: t.noches_ocupadas, ocupacion: t.ocupacion, adr: t.adr, revpar: t.revpar,
      reservas: t.reservas, bruto: t.bruto, honorarios: resultado.honorarios, costos_operativos: resultado.costos_operativos,
      empresa_ars: resultado.empresa.ars, resultado_ars: resultado.total_ars, personales: personales(db, mes).reduce((s, p) => s + p.importe, 0),
    };
  });
  const historico = (db.prepare(`
    SELECT h.mes, SUM(h.noches_ocupadas) AS noches_ocupadas FROM historico_mensual h
    WHERE h.mes NOT IN (SELECT mes FROM periodo WHERE estado = 'cerrado')
    GROUP BY h.mes`).all() as { mes: string; noches_ocupadas: number }[]).map((h) => ({
    mes: h.mes, noches_disponibles: null, noches_ocupadas: h.noches_ocupadas, ocupacion: null, adr: null, revpar: null,
    reservas: null, bruto: null, honorarios: null, costos_operativos: null, empresa_ars: null, resultado_ars: null, personales: null,
  }));
  return [...historico, ...cerrados].sort((a, b) => a.mes.localeCompare(b.mes));
}

// Gastos personales del mes (CAY, LAU, la casa...): se muestran, pero no son de Hornera ni entran en el resultado.
const personales = (db: DatabaseSync, mes: string) => db.prepare(`
  SELECT g.codigo, SUM(g.importe) AS importe FROM gasto_ajeno g JOIN periodo p ON p.id = g.periodo_id
  WHERE p.mes = ? AND g.estado = 'vigente' GROUP BY g.codigo ORDER BY g.codigo`).all(mes) as { codigo: string; importe: number }[];

// Lo facturado en ARCA por emisor: lo emitido desde la app más lo importado de Mis Comprobantes que no es de la app.
// ponytail: NC A, B y C (3, 8, 13) restan; si algún emisor usa factura de crédito electrónica, sumar 203/208/213.
const SQL_FACTURADO = `
  SELECT emisor_id, fecha, CASE WHEN cbte_tipo IN (3, 8, 13) THEN -importe ELSE importe END AS importe
  FROM comprobante WHERE estado = 'aprobado' AND ambiente = 'produccion'
  UNION ALL
  SELECT ca.emisor_id, ca.fecha, CASE WHEN ca.cbte_tipo IN (3, 8, 13) THEN -ABS(ca.importe) ELSE ca.importe END
  FROM comprobante_arca ca WHERE NOT ${SQL_DE_HORNERA}`;

// Resumen de Hornera misma (pedido 2026-10-23): resultado por concepto, personales aparte, lo que falta pagar,
// lo disponible y lo facturado. Lo pendiente de limpieza y propietarios es de hoy; los vencimientos, del mes elegido.
export function resumenHornera(db: DatabaseSync, mes: string, hoy?: string) {
  const { estado, avisos, resultado, cuentas } = resumenDelMes(db, mes);
  const conceptos = db.prepare(`
    SELECT COALESCE(c.nombre, 'Sin concepto') AS concepto, SUM(m.importe_ars) AS ars, SUM(m.importe_usd) AS usd
    FROM movimiento m JOIN periodo p ON p.id = m.periodo_id LEFT JOIN concepto c ON c.id = m.concepto_id
    WHERE p.mes = ? AND m.depto_id IS NULL AND m.estado = 'vigente' AND m.tipo IN ('gasto', 'ingreso', 'ajuste')
    GROUP BY 1 ORDER BY SUM(m.importe_ars)`).all(mes) as { concepto: string; ars: number; usd: number }[];

  const limpieza = listarLiquidaciones(db).filter((l) => !l.pagada && l.total > 0)
    .map(({ id, desde, hasta, total }) => ({ id, desde, hasta, total }));
  // Del último mes cerrado: lo que se le debe a cada propietario (no los deptos de Hornera ni los saldos en contra).
  const cerrado = db.prepare(`SELECT mes FROM periodo WHERE estado = 'cerrado' ORDER BY mes DESC LIMIT 1`).get() as { mes: string } | undefined;
  const propietarios = (cerrado ? listarTransferencias(db, cerrado.mes) : [])
    .filter((t) => !t.esHornera && !t.arrastradoA && t.pendiente > 0)
    .map(({ codigo, propietario, moneda, pendiente }) => ({ codigo, propietario, moneda, pendiente }));

  const saldos = cuentas as { nombre: string; moneda: 'ARS' | 'USD'; saldo: number }[];
  const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const disponible = (moneda: 'ARS' | 'USD') => suma(saldos.filter((c) => c.moneda === moneda).map((c) => c.saldo))
    - suma(propietarios.filter((p) => p.moneda === moneda).map((p) => p.pendiente))
    - (moneda === 'ARS' ? suma(limpieza.map((l) => l.total)) : 0);

  const facturado = db.prepare(`
    SELECT e.nombre AS emisor, COALESCE(SUM(CASE WHEN substr(f.fecha, 1, 7) = ? THEN f.importe END), 0) AS mes, SUM(f.importe) AS doce
    FROM (${SQL_FACTURADO}) f JOIN emisor e ON e.id = f.emisor_id
    WHERE substr(f.fecha, 1, 7) BETWEEN ? AND ? GROUP BY e.id ORDER BY e.nombre`).all(mes, mesAnterior(mes, 11), mes) as
    { emisor: string; mes: number; doce: number }[];

  return {
    mes, estado, avisos, resultado, conceptos, personales: personales(db, mes),
    pendiente: { vencimientos: vencimientos(db, mes, hoy).filter((v) => v.estado !== 'pagado'), limpieza, propietarios, mes_propietarios: cerrado?.mes ?? null },
    cuentas: saldos, disponible: { ars: disponible('ARS'), usd: disponible('USD') }, facturado,
  };
}

// Elasticidad precio de la ocupación por depto (pedido de Amancay, 2026-10-23): cuánto cambia la ocupación
// cuando cambia el ADR, entre este mes y el mismo mes del año anterior (o, si no hay, el mes anterior).
// Fórmula de arco: (Δocupación / promedio) / (ΔADR / promedio). Es indicativa: con datos observados el precio
// sube cuando hay más demanda, así que el número mezcla precio y demanda (ver avisos).
// ponytail: ADR y ocupación del mes; con las fotos del calendario de Stays (plan 050) se puede medir por noche ofrecida.
const CAMBIO_MINIMO = 0.05; // con el ADR casi igual, cualquier ruido en la ocupación da elasticidades absurdas

const mesAnterior = (mes: string, meses: number) => {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + m - 1 - meses;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export function arco(antes: number, despues: number) {
  const prom = (antes + despues) / 2;
  return prom === 0 ? null : (despues - antes) / prom;
}

export function elasticidadDelMes(db: DatabaseSync, mes: string) {
  const existe = (m: string) => db.prepare('SELECT 1 FROM periodo WHERE mes = ?').get(m) !== undefined;
  const anual = mesAnterior(mes, 12);
  const base = existe(anual) ? anual : existe(mesAnterior(mes, 1)) ? mesAnterior(mes, 1) : null;
  const avisos = ['Indicativa: el precio se sube cuando se espera más demanda (temporada, feriados), así que este número mezcla precio y demanda. No decidir precios solo con él.'];
  if (!base) {
    return { base: null, tipo: null, deptos: {} as Record<string, number>, mediana: null, validos: 0, confianza: 'sin datos', avisos: [...avisos, 'No hay un mes anterior cargado para comparar.'] };
  }
  const tipo = base === anual ? 'anual' : 'mensual';
  const conMetricas = (m: string) => new Map(kpisDelMes(db, m).deptos.map((d) => [d.codigo, metricas(d)]));
  const ahora = conMetricas(mes);
  const antes = conMetricas(base);
  const deptos: Record<string, number> = {};
  let precioQuieto = 0;
  for (const [codigo, x] of ahora) {
    const y = antes.get(codigo);
    if (!y || x.adr == null || y.adr == null || x.ocupacion == null || y.ocupacion == null) continue;
    const dp = arco(y.adr, x.adr);
    const dq = arco(y.ocupacion, x.ocupacion);
    if (dp == null || dq == null) continue;
    if (Math.abs(dp) < CAMBIO_MINIMO) { precioQuieto++; continue; }
    deptos[codigo] = Math.round((dq / dp) * 100) / 100;
  }
  const valores = Object.values(deptos);
  const positivos = valores.filter((v) => v > 0).length;
  if (tipo === 'mensual') avisos.push(`Compara contra ${base}, el mes anterior: dos meses distintos tienen distinta demanda. Con un año de datos se compara contra el mismo mes del año anterior.`);
  if (valores.length === 0) avisos.push(`Ningún depto cambió el ADR un ${CAMBIO_MINIMO * 100} % o más: no hay con qué calcularla.`);
  else if (valores.length < 5) avisos.push(`Solo ${valores.length} depto(s) cambiaron el ADR un ${CAMBIO_MINIMO * 100} % o más: con tan pocos, el número es muy inestable.`);
  if (precioQuieto) avisos.push(`${precioQuieto} depto(s) quedan afuera porque su ADR casi no cambió.`);
  if (positivos) avisos.push(`En ${positivos} depto(s) la ocupación subió junto con el precio (valor positivo): ahí pesó la demanda, no el precio.`);
  const sinDetalle = [mes, base].filter((m) => db.prepare(`
    SELECT 1 FROM periodo p WHERE p.mes = ? AND p.estado = 'cerrado'
      AND NOT EXISTS (SELECT 1 FROM liquidacion l JOIN liquidacion_reserva lr ON lr.liquidacion_id = l.id WHERE l.periodo_id = p.id)`).get(m));
  if (sinDetalle.length) avisos.push(`${sinDetalle.join(' y ')} viene${sinDetalle.length > 1 ? 'n' : ''} del Excel, sin detalle de reservas: su ADR incluye las estadías del propietario.`);
  if ([mes, base].some((m) => (db.prepare('SELECT estado FROM periodo WHERE mes = ?').get(m) as { estado: string }).estado === 'abierto')) {
    avisos.push('Uno de los meses está abierto: los números todavía cambian.');
  }
  return {
    base, tipo, deptos, mediana: valores.length ? (mediana(valores.map((v) => v * 100)) ?? 0) / 100 : null, validos: valores.length,
    confianza: tipo === 'anual' && valores.length >= 5 ? 'baja' : 'muy baja', avisos,
  };
}
