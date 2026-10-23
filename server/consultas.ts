// Consultas de solo lectura que comparten las rutas GET y las herramientas del asistente (plan 061).
import type { DatabaseSync } from 'node:sqlite';
import { SQL_EN_PERIODO } from './periodo.ts';
import { liquidacionGuardada, liquidarPeriodo } from './liquidacion/servicio.ts';

export const listarPropietarios = (db: DatabaseSync) => db.prepare(`
  SELECT p.id, p.nombre, p.moneda_liquidacion, p.cbu IS NOT NULL AS tiene_cbu,
         (SELECT group_concat(codigo, ', ') FROM depto WHERE propietario_id = p.id) AS deptos
  FROM propietario p WHERE p.activo = 1 ORDER BY p.nombre`).all();

export const listarDeptos = (db: DatabaseSync) => db.prepare(`
  SELECT d.id, d.codigo, d.nombre, d.direccion, d.estado, d.comision_pct, d.tarifa_base_override,
         d.adicional_huesped_override, d.cm_fee_usd_override, p.nombre AS propietario,
         COALESCE(d.fotos, '[]') AS fotos
  FROM depto d JOIN propietario p ON p.id = d.propietario_id ORDER BY d.codigo`).all()
  .map((d) => ({ ...d, fotos: JSON.parse(d.fotos as string) as string[] }));

// provisoria: de la API pero de un momento, no la del cierre (server/cotizacion.ts).
export const listarPeriodos = (db: DatabaseSync) => db.prepare(`
  SELECT mes, estado, usd_cotizacion, usd_cotizacion_fuente, usd_cotizacion_fecha, usd_descuento_pct, fecha_pago,
         usd_cotizacion_fuente = 'api' AND usd_cotizacion_provisoria = 1 AS provisoria
  FROM periodo ORDER BY mes DESC`).all();

export const listarCuentas = (db: DatabaseSync) =>
  db.prepare('SELECT cuenta_id AS id, nombre, moneda, activo, saldo, saldo_desde FROM v_saldo_cuenta ORDER BY activo DESC, nombre').all();

// Reservas del período (regla de server/periodo.ts) con lo cobrado neto. Mes inexistente: ninguna.
export function reservasDelMes(db: DatabaseSync, mes: string) {
  const periodo = db.prepare('SELECT fecha_inicio, fecha_cierre_reservas FROM periodo WHERE mes = ?')
    .get(mes) as { fecha_inicio: string; fecha_cierre_reservas: string } | undefined;
  if (!periodo) return [];
  const { fecha_inicio: inicio, fecha_cierre_reservas: cierre } = periodo;
  return db.prepare(`
    SELECT r.id, r.codigo, d.codigo AS depto, r.llegada, r.salida, r.huespedes, p.nombre AS plataforma,
           r.estado_stays, r.ajuste_ars, r.ajuste_usd, r.ajuste_comision_ars, r.ajuste_comision_usd, r.observacion, r.excluida,
           r.cancelada, r.hora_llegada, r.hora_salida, r.desglose_json,
           COALESCE(SUM(CASE v.moneda WHEN 'ARS' THEN v.importe_neto END), 0) AS cobrado_ars,
           COALESCE(SUM(CASE v.moneda WHEN 'USD' THEN v.importe_neto END), 0) AS cobrado_usd,
           MAX(v.falta_comision) AS falta_comision
    FROM reserva r
    JOIN depto d ON d.id = r.depto_id
    LEFT JOIN plataforma p ON p.id = r.plataforma_id
    LEFT JOIN v_pago_liquidable v ON v.reserva_id = r.id
    WHERE ${SQL_EN_PERIODO}
    GROUP BY r.id ORDER BY d.codigo, r.llegada`).all({ inicio, cierre });
}

// Un mes cerrado se muestra como se guardó al cerrar, no recalculado con los datos de hoy.
export function liquidacionDelMes(db: DatabaseSync, mes: string) {
  const cerrado = (db.prepare('SELECT estado FROM periodo WHERE mes = ?').get(mes) as { estado: string } | undefined)?.estado === 'cerrado';
  return cerrado ? liquidacionGuardada(db, mes) : liquidarPeriodo(db, mes);
}
