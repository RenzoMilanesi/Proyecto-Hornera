// Liquidación de un período a partir de lo que hay en la base: reservas y pagos de
// Stays (con sus ajustes), movimientos, bloqueos y el saldo que dejó el mes anterior.
// No guarda nada: con el período abierto se recalcula cada vez (al cerrar se guardará
// el snapshot en `liquidacion`).
import type { DatabaseSync } from 'node:sqlite';
import { cambioDelPeriodo, cuentaLiquidacion, liquidar, redondeoCuenta, truncPesos, type CuentaLiquidacion, type Importe, type ResultadoLiquidacion } from './motor.ts';
import { SQL_EN_PERIODO } from '../periodo.ts';

export interface LiquidacionDepto {
  deptoId: number;
  codigo: string;
  nombre: string;
  propietario: string;
  moneda: 'ARS' | 'USD';
  comisionPct: number;
  nochesNoDisponibles: number;
  saldoAnterior: Importe;
  movimientos: Importe;                       // del período, sin saldo inicial ni pagos de liquidación
  comisiones: Importe;                        // fee del channel manager + las cargadas en las reservas
  // Mismo orden que resultado.reservas. `comision`: la que esta reserva suma en este período.
  // Los ajustes y la observación, para abrir "Ajustes de la reserva" desde el detalle.
  reservas: {
    id: number; codigo: string; llegada: string; huespedes: number; comision: Importe;
    ajuste_ars: number; ajuste_usd: number; ajuste_comision_ars: number; ajuste_comision_usd: number; observacion: string | null;
  }[];
  resultado: ResultadoLiquidacion;
  cuenta: CuentaLiquidacion;
  redondeo: number;                           // saldo − (valor final + saldo anterior), ±$ 1; 0 si liquida en USD
}

export interface LiquidacionPeriodo {
  mes: string;
  estado: string;
  cotizacion: number | null;
  cambio: number | null;
  avisos: string[];
  deptos: LiquidacionDepto[];
}

const CERO: Importe = { ars: 0, usd: 0 };
const sumar = (a: Importe, b: Importe): Importe => ({ ars: a.ars + b.ars, usd: a.usd + b.usd });

export function liquidarPeriodo(db: DatabaseSync, mes: string): LiquidacionPeriodo {
  const p = db.prepare('SELECT * FROM periodo WHERE mes = ?').get(mes) as any;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  const avisos: string[] = [];
  const base = { mes, estado: p.estado as string, cotizacion: p.usd_cotizacion as number | null };
  if (p.usd_cotizacion == null) {
    return { ...base, cambio: null, avisos: ['Falta la cotización del dólar del período: cargala para calcular la liquidación.'], deptos: [] };
  }
  const cambio = cambioDelPeriodo(p.usd_cotizacion, p.usd_descuento_pct);
  const periodo = {
    inicio: p.fecha_inicio, cierre: p.fecha_cierre_reservas, cambio,
    tarifaBase: p.tarifa_base, adicionalHuesped: p.adicional_huesped,
    nochesTramo1: p.noches_tramo_1, cargoTramo1: p.cargo_tramo_1, nochesTramo2: p.noches_tramo_2, cargoTramo2: p.cargo_tramo_2,
  };

  // Saldo de arrastre: lo que dejó la liquidación cerrada del mes anterior, menos lo pagado.
  const anterior = db.prepare('SELECT id, mes, estado FROM periodo WHERE mes < ? ORDER BY mes DESC LIMIT 1').get(mes) as
    { id: number; mes: string; estado: string } | undefined;
  const saldos = new Map<number, Importe>();
  if (!anterior) {
    avisos.push('No hay un mes anterior cargado: no se arrastra saldo.');
  } else if (anterior.estado !== 'cerrado') {
    avisos.push(`El mes anterior (${anterior.mes}) está abierto: su saldo se arrastra recién cuando se cierre.`);
  } else {
    const [a, m] = mes.split('-').map(Number);
    const mesAnterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
    if (anterior.mes !== mesAnterior) {
      avisos.push(`Se arrastra el saldo de ${anterior.mes}: falta cargar ${mesAnterior}.`);
    }
    const filas = db.prepare(`
      SELECT l.depto_id, -- saldado por fuera: no se arrastra
             CASE WHEN l.saldado_fuera IS NULL THEN l.saldo_final_ars + COALESCE(SUM(m.importe_ars), 0) ELSE 0 END AS ars,
             CASE WHEN l.saldado_fuera IS NULL THEN l.saldo_final_usd + COALESCE(SUM(m.importe_usd), 0) ELSE 0 END AS usd
      FROM liquidacion l
      LEFT JOIN movimiento m ON m.periodo_id = l.periodo_id AND m.depto_id = l.depto_id
                            AND m.tipo = 'liquidacion' AND m.estado = 'vigente'
      WHERE l.periodo_id = ? GROUP BY l.id`).all(anterior.id) as { depto_id: number; ars: number; usd: number }[];
    for (const f of filas) saldos.set(f.depto_id, { ars: f.ars, usd: f.usd });
  }

  const deptos = db.prepare(`
    SELECT d.id, d.codigo, d.nombre, d.estado, d.comision_pct, d.tarifa_base_override, d.adicional_huesped_override,
           d.cm_fee_usd_override, pr.nombre AS propietario, pr.moneda_liquidacion, pr.comision_cobro_usd_pct
    FROM depto d JOIN propietario pr ON pr.id = d.propietario_id ORDER BY d.codigo`).all() as any[];
  const reservasDe = db.prepare(`
    SELECT r.id, r.codigo, r.llegada, r.salida, r.huespedes, r.moneda, r.precio_compra,
           r.ajuste_ars, r.ajuste_usd, r.ajuste_comision_ars, r.ajuste_comision_usd, r.observacion, pl.codigo AS canal,
           EXISTS (SELECT 1 FROM depto_pago_directo dp WHERE dp.depto_id = r.depto_id AND dp.plataforma_id = r.plataforma_id) AS pago_directo,
           COALESCE((SELECT SUM(v.importe_neto) FROM v_pago_liquidable v WHERE v.reserva_id = r.id AND v.moneda = 'ARS'), 0) AS cobrado_ars,
           COALESCE((SELECT SUM(v.importe_neto) FROM v_pago_liquidable v WHERE v.reserva_id = r.id AND v.moneda = 'USD'), 0) AS cobrado_usd
    FROM reserva r LEFT JOIN plataforma pl ON pl.id = r.plataforma_id
    WHERE r.depto_id = :depto AND r.excluida = 0 AND r.cancelada = 0 AND ${SQL_EN_PERIODO}
    ORDER BY r.llegada, r.codigo`);
  const movimientosDe = db.prepare(`
    SELECT tipo, importe_ars AS ars, importe_usd AS usd FROM movimiento
    WHERE periodo_id = ? AND depto_id = ? AND estado = 'vigente' AND tipo <> 'liquidacion'`);
  const nochesBloqueadas = db.prepare(`
    SELECT COALESCE(SUM(MAX(0, julianday(MIN(hasta, :cierre)) - julianday(MAX(desde, :inicio)))), 0) AS n
    FROM bloqueo WHERE depto_id = :depto AND estado = 'vigente'`);

  const resultado: LiquidacionDepto[] = [];
  for (const d of deptos) {
    const reservas = reservasDe.all({ depto: d.id, inicio: p.fecha_inicio, cierre: p.fecha_cierre_reservas }) as any[];
    const movimientos = movimientosDe.all(p.id, d.id) as { tipo: string; ars: number; usd: number }[];
    // Un "Saldo mes anterior" cargado en el período (migración) reemplaza al arrastre calculado.
    const iniciales = movimientos.filter((m) => m.tipo === 'saldo_inicial');
    const saldoAnterior = iniciales.length ? iniciales.reduce(sumar, CERO) : (saldos.get(d.id) ?? CERO);
    const conMovimiento = movimientos.length > 0 || saldoAnterior.ars !== 0 || saldoAnterior.usd !== 0;
    if (d.estado !== 'activo' && reservas.length === 0 && !conMovimiento) continue;

    // Comisiones: fee del channel manager (deptos activos o con reservas) + las cargadas a mano en
    // las reservas que LLEGAN en el período: una reserva que cruza de mes aparece en los dos y su
    // comisión se cobra una sola vez. ponytail: sin % automático por plataforma (DECISIONES).
    const fee = d.estado === 'activo' || reservas.length ? (d.cm_fee_usd_override ?? p.cm_fee_usd) : 0;
    const comisionDe = (x: any): Importe => (x.llegada >= p.fecha_inicio && x.llegada < p.fecha_cierre_reservas
      ? { ars: x.ajuste_comision_ars, usd: x.ajuste_comision_usd } : CERO);
    const comisiones = reservas.reduce((s, x) => sumar(s, comisionDe(x)), { ars: 0, usd: fee });
    const nochesNoDisponibles = Math.round((nochesBloqueadas.get({ depto: d.id, inicio: p.fecha_inicio, cierre: p.fecha_cierre_reservas }) as { n: number }).n);

    const r = liquidar({
      periodo,
      depto: {
        codigo: d.codigo, comisionPct: d.comision_pct, tarifaBaseOverride: d.tarifa_base_override,
        adicionalHuespedOverride: d.adicional_huesped_override, monedaLiquidacion: d.moneda_liquidacion,
        comisionCobroUsdPct: d.comision_cobro_usd_pct,
        nochesNoDisponibles,
      },
      reservas: reservas.map((x) => ({
        llegada: x.llegada, salida: x.salida, huespedes: x.huespedes, canal: x.canal ?? '',
        ars: x.cobrado_ars, ajusteArs: x.ajuste_ars, usd: x.cobrado_usd, ajusteUsd: x.ajuste_usd,
        // Lo que la plataforma le paga directo al propietario (co-host): informativo en el PDF.
        pagoPlataformaUsd: x.pago_directo && x.moneda === 'USD' ? (x.precio_compra ?? 0) : 0,
      })),
      comisiones,
      movimientos: iniciales.length ? movimientos : [saldoAnterior, ...movimientos],
    });
    const movimientosMes = movimientos.filter((m) => m.tipo !== 'saldo_inicial').reduce(sumar, CERO);
    const cuenta = cuentaLiquidacion(r.bruto, r.gastosDirectos, r.honorarios, movimientosMes, cambio);
    resultado.push({
      deptoId: d.id, codigo: d.codigo, nombre: d.nombre, propietario: d.propietario, moneda: d.moneda_liquidacion,
      comisionPct: d.comision_pct, nochesNoDisponibles, saldoAnterior, comisiones,
      movimientos: movimientosMes,
      reservas: reservas.map((x) => ({
        id: x.id, codigo: x.codigo, llegada: x.llegada, huespedes: x.huespedes, comision: comisionDe(x),
        ajuste_ars: x.ajuste_ars, ajuste_usd: x.ajuste_usd, ajuste_comision_ars: x.ajuste_comision_ars, ajuste_comision_usd: x.ajuste_comision_usd,
        observacion: x.observacion,
      })),
      resultado: r, cuenta,
      redondeo: d.moneda_liquidacion === 'ARS' ? redondeoCuenta(cuenta, saldoAnterior, r.saldo.ars, cambio) : 0,
    });
  }
  return { ...base, cambio, avisos, deptos: resultado };
}

/**
 * La liquidación de un mes cerrado tal como se guardó al cerrar (o al importar el Excel): lo que se ve en
 * Liquidación, igual que el PDF y Transferencias. `liquidarPeriodo` recalcula con los datos de hoy, que para
 * un mes cerrado pueden ser otros (comisión o moneda cambiadas, mes importado sin reservas en la base);
 * esa recalculación la sigue usando "Comparar con el Excel".
 */
export function liquidacionGuardada(db: DatabaseSync, mes: string): LiquidacionPeriodo {
  const p = db.prepare('SELECT * FROM periodo WHERE mes = ?').get(mes) as any;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  if (p.estado !== 'cerrado') throw new Error(`El período ${mes} no está cerrado.`);
  const filas = db.prepare(`
    SELECT l.*, d.codigo, d.nombre, pr.nombre AS propietario
    FROM liquidacion l JOIN depto d ON d.id = l.depto_id
    JOIN propietario pr ON pr.id = COALESCE(l.propietario_id, d.propietario_id)
    WHERE l.periodo_id = ? ORDER BY d.codigo`).all(p.id) as any[];
  const reservasDe = db.prepare(`
    SELECT r.id, r.codigo, r.llegada, r.huespedes, r.ajuste_ars, r.ajuste_usd, r.ajuste_comision_ars, r.ajuste_comision_usd,
           r.observacion, lr.*
    FROM liquidacion_reserva lr JOIN reserva r ON r.id = lr.reserva_id
    WHERE lr.liquidacion_id = ? ORDER BY r.llegada, r.codigo`);
  const cambio: number | null = filas[0]?.cambio ?? (p.usd_cotizacion == null ? null : cambioDelPeriodo(p.usd_cotizacion, p.usd_descuento_pct));

  const deptos = filas.map((l): LiquidacionDepto => {
    const reservas = reservasDe.all(l.id) as any[];
    const comisiones = { ars: l.comisiones_ars, usd: l.comisiones_usd };
    const movimientos = { ars: l.movimientos_ars, usd: l.movimientos_usd };
    const gastosDirectos = truncPesos(-l.costos_operativos - comisiones.ars - comisiones.usd * l.cambio); // [F19], no se guarda
    const resultado: ResultadoLiquidacion = {
      reservas: reservas.map((x) => ({
        codigoInterno: x.codigo_interno, nochesTotales: x.noches_totales, nochesPeriodo: x.noches_periodo,
        importeArs: x.importe_ars, importePeriodoArs: x.importe_periodo_ars, importeUsd: x.importe_usd, importePeriodoUsd: x.importe_periodo_usd,
        tarifa: x.tarifa, tarifaPeriodo: x.tarifa_periodo, pagoPlataformaUsd: x.pago_plataforma_usd,
      })),
      ingresos: { ars: l.ingresos_ars, usd: l.ingresos_usd }, costosOperativos: l.costos_operativos,
      bruto: l.bruto, gastosDirectos, honorarios: l.honorarios, saldoParcial: l.bruto + gastosDirectos + l.honorarios,
      conversion: { ars: l.conversion_ars, usd: l.conversion_usd }, saldo: { ars: l.saldo_final_ars, usd: l.saldo_final_usd },
      nochesDisponibles: l.noches_disponibles, nochesOcupadas: l.noches_ocupadas, nochesPropietario: l.noches_propietario,
      ocupacion: l.noches_disponibles === 0 ? 0 : l.noches_ocupadas / l.noches_disponibles,
    };
    const cuenta = cuentaLiquidacion(l.bruto, gastosDirectos, l.honorarios, movimientos, l.cambio);
    const saldoAnterior = { ars: l.saldo_anterior_ars, usd: l.saldo_anterior_usd };
    return {
      deptoId: l.depto_id, codigo: l.codigo, nombre: l.nombre, propietario: l.propietario, moneda: l.moneda,
      comisionPct: l.comision_pct, nochesNoDisponibles: l.noches_no_disponibles,
      saldoAnterior, movimientos, comisiones,
      reservas: reservas.map((x) => ({
        id: x.id, codigo: x.codigo, llegada: x.llegada, huespedes: x.huespedes, comision: { ars: x.comision_ars, usd: x.comision_usd },
        ajuste_ars: x.ajuste_ars, ajuste_usd: x.ajuste_usd, ajuste_comision_ars: x.ajuste_comision_ars, ajuste_comision_usd: x.ajuste_comision_usd,
        observacion: x.observacion,
      })),
      resultado, cuenta,
      redondeo: l.moneda === 'ARS' ? redondeoCuenta(cuenta, saldoAnterior, l.saldo_final_ars, l.cambio) : 0,
    };
  });
  return { mes, estado: p.estado, cotizacion: p.usd_cotizacion, cambio, avisos: [], deptos };
}
