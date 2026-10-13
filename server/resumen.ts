// Resumen interno (fase 6): KPIs por depto, resultado de Hornera, saldos de cuentas y evolución mensual.
// Mes cerrado: sale del snapshot (`liquidacion`). Mes abierto: del motor, como la pantalla Liquidación.
import type { DatabaseSync } from 'node:sqlite';
import { liquidarPeriodo } from './liquidacion/servicio.ts';

export interface KpiDepto {
  codigo: string;
  nombre: string;
  noches_disponibles: number;
  noches_ocupadas: number;
  reservas: number;
  bruto: number;              // ARS + USD × cambio, centavos
  costos_operativos: number;  // tarifa por reserva cobrada al propietario (ARS)
  honorarios: number;         // positivo: lo que cobra Hornera
}

// Resultado de Hornera = honorarios + costos operativos cobrados + ingresos/gastos de la empresa (INT).
// ponytail: así lo entendemos del Excel; confirmarlo con los dueños (DECISIONES, "Pendiente").
const SQL_EMPRESA = `
  SELECT COALESCE(SUM(m.importe_ars), 0) AS ars, COALESCE(SUM(m.importe_usd), 0) AS usd
  FROM movimiento m JOIN periodo p ON p.id = m.periodo_id
  WHERE p.mes = ? AND m.depto_id IS NULL AND m.estado = 'vigente' AND m.tipo IN ('gasto', 'ingreso', 'ajuste')`;

function kpisDelMes(db: DatabaseSync, mes: string): { estado: string; deptos: KpiDepto[]; avisos: string[] } {
  const p = db.prepare('SELECT estado FROM periodo WHERE mes = ?').get(mes) as { estado: string } | undefined;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  if (p.estado === 'cerrado') {
    const deptos = db.prepare(`
      SELECT d.codigo, d.nombre, l.noches_disponibles, l.noches_ocupadas, l.cant_reservas AS reservas, l.bruto,
             l.costos_operativos, -l.honorarios AS honorarios
      FROM liquidacion l JOIN periodo p ON p.id = l.periodo_id JOIN depto d ON d.id = l.depto_id
      WHERE p.mes = ? ORDER BY d.codigo`).all(mes) as unknown as KpiDepto[];
    return { estado: p.estado, deptos, avisos: [] };
  }
  const calculo = liquidarPeriodo(db, mes);
  return {
    estado: p.estado,
    avisos: calculo.avisos,
    deptos: calculo.deptos.map(({ codigo, nombre, resultado: r }) => ({
      codigo, nombre, noches_disponibles: r.nochesDisponibles, noches_ocupadas: r.nochesOcupadas,
      reservas: r.reservas.length, bruto: r.bruto, costos_operativos: r.costosOperativos, honorarios: -r.honorarios + 0,
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
  return {
    mes, estado, avisos, deptos,
    totales: {
      noches_disponibles: suma('noches_disponibles'), noches_ocupadas: suma('noches_ocupadas'),
      reservas: suma('reservas'), bruto: suma('bruto'),
    },
    resultado: { honorarios, costos_operativos: costos, empresa, total_ars: honorarios + costos + empresa.ars },
    cuentas: db.prepare('SELECT nombre, moneda, saldo FROM v_saldo_cuenta WHERE activo = 1 ORDER BY moneda, nombre').all(),
  };
}

// Un renglón por mes: los cerrados en la app (o importados del Excel) con todo; los anteriores, solo
// con las noches del histórico (hoja OCUPACION). Los meses abiertos no entran: todavía cambian.
export function evolucion(db: DatabaseSync) {
  return db.prepare(`
    SELECT p.mes, SUM(l.noches_disponibles) AS noches_disponibles, SUM(l.noches_ocupadas) AS noches_ocupadas,
           SUM(l.cant_reservas) AS reservas, SUM(l.bruto) AS bruto, -SUM(l.honorarios) AS honorarios,
           -SUM(l.honorarios) + SUM(l.costos_operativos) + (
             SELECT COALESCE(SUM(m.importe_ars), 0) FROM movimiento m
             WHERE m.periodo_id = p.id AND m.depto_id IS NULL AND m.estado = 'vigente' AND m.tipo IN ('gasto', 'ingreso', 'ajuste')
           ) AS resultado_ars
    FROM periodo p JOIN liquidacion l ON l.periodo_id = p.id
    WHERE p.estado = 'cerrado'
    GROUP BY p.id
    UNION ALL
    SELECT h.mes, NULL, SUM(h.noches_ocupadas), NULL, NULL, NULL, NULL
    FROM historico_mensual h
    WHERE h.mes NOT IN (SELECT mes FROM periodo WHERE estado = 'cerrado')
    GROUP BY h.mes
    ORDER BY 1`).all();
}
