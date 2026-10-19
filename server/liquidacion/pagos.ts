// Transferencias a propietarios de un mes cerrado: qué hay que pagarle a cada uno, "marcar
// pagado" (genera el movimiento "Liquidacion periodo", como la fila de CORRIENTE) y la lista
// para el banco en Excel. Un pago se anula desde acá o desde Movimientos.
import * as XLSX from 'xlsx';
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from '../auditoria.ts';
import { conceptoId } from '../movimientos.ts';

export interface Transferencia {
  liquidacionId: number;
  deptoId: number;
  codigo: string;
  depto: string;
  propietarioId: number;       // el dueño al cerrar el mes (no necesariamente el actual)
  propietario: string;
  cbu: string | null;          // null + esHornera = "Nosotros" (depto de los dueños)
  esHornera: boolean;
  moneda: 'ARS' | 'USD';
  saldo: number;               // centavos en la moneda de liquidación: >0 se le paga, <0 debe
  pagado: number;              // lo ya transferido (positivo)
  pendiente: number;
  // El mes siguiente ya está cerrado: lo pendiente quedó como saldo anterior de ese mes y se paga desde ahí.
  arrastradoA: string | null;
  pagos: { id: number; fecha: string; importe: number; cuenta: string | null; factura?: FacturaDePago | null }[];
}

// La factura de un pago: la de producción si hubo algún intento (la aprobada o, si no, el último rechazado); si no, la de prueba.
export interface FacturaDePago {
  id: number; estado: 'aprobado' | 'rechazado'; ambiente: 'homologacion' | 'produccion';
  cbte_tipo: number; punto_venta: number; numero: number | null; motivo: string | null;
}

export function listarTransferencias(db: DatabaseSync, mes: string): Transferencia[] {
  const filas = db.prepare(`
    SELECT l.id, l.periodo_id, l.depto_id, d.codigo, d.nombre AS depto, pr.id AS propietario_id, pr.nombre AS propietario, pr.cbu, pr.es_hornera,
           pr.moneda_liquidacion AS moneda, l.saldo_final_ars, l.saldo_final_usd
    FROM liquidacion l JOIN periodo p ON p.id = l.periodo_id JOIN depto d ON d.id = l.depto_id
    JOIN propietario pr ON pr.id = COALESCE(l.propietario_id, d.propietario_id) -- el dueño de ese mes
    WHERE p.mes = ? ORDER BY d.codigo`).all(mes) as any[];
  const siguiente = db.prepare('SELECT mes, estado FROM periodo WHERE mes > ? ORDER BY mes LIMIT 1').get(mes) as { mes: string; estado: string } | undefined;
  const arrastradoA = siguiente?.estado === 'cerrado' ? siguiente.mes : null;
  const pagosDe = db.prepare(`
    SELECT m.id, m.fecha, m.importe_ars, m.importe_usd, c.nombre AS cuenta,
      (SELECT json_object('id', id, 'estado', estado, 'ambiente', ambiente, 'cbte_tipo', cbte_tipo, 'punto_venta', punto_venta,
         'numero', numero, 'motivo', motivo) FROM comprobante WHERE movimiento_id = m.id AND asociado_id IS NULL
       ORDER BY ambiente = 'produccion' DESC, estado = 'aprobado' DESC, id DESC LIMIT 1) AS factura
    FROM movimiento m LEFT JOIN cuenta c ON c.id = m.cuenta_id
    WHERE m.periodo_id = ? AND m.depto_id = ? AND m.tipo = 'liquidacion' AND m.estado = 'vigente' ORDER BY m.fecha, m.id`);
  return filas.map((f) => {
    const usd = f.moneda === 'USD';
    const pagos = (pagosDe.all(f.periodo_id, f.depto_id) as any[])
      .map((m) => ({ id: m.id, fecha: m.fecha, importe: -(usd ? m.importe_usd : m.importe_ars), cuenta: m.cuenta, factura: m.factura && JSON.parse(m.factura) }));
    const saldo = usd ? f.saldo_final_usd : f.saldo_final_ars;
    const pagado = pagos.reduce((s, x) => s + x.importe, 0);
    return {
      liquidacionId: f.id, deptoId: f.depto_id, codigo: f.codigo, depto: f.depto, propietarioId: f.propietario_id, propietario: f.propietario, cbu: f.cbu, esHornera: !!f.es_hornera,
      moneda: f.moneda, saldo, pagado, pendiente: saldo - pagado, arrastradoA, pagos,
    };
  });
}

export interface DatosPago { cuenta_id: number | null; fecha: string; importe: number; detalle?: string | null }

export function pagarLiquidacion(db: DatabaseSync, liquidacionId: number, d: DatosPago): number {
  const l = db.prepare(`
    SELECT l.id, l.periodo_id, l.depto_id, l.movimiento_pago_id, p.mes, d.codigo FROM liquidacion l
    JOIN periodo p ON p.id = l.periodo_id JOIN depto d ON d.id = l.depto_id WHERE l.id = ?`).get(liquidacionId) as any;
  if (!l) throw new Error('No existe la liquidación.');
  const t = listarTransferencias(db, l.mes).find((x) => x.liquidacionId === liquidacionId)!;
  if (t.arrastradoA) {
    throw new Error(`El saldo de ${l.mes} ya pasó a ${t.arrastradoA} (cerrado): pagalo desde ${t.arrastradoA}.`);
  }
  if (!Number.isInteger(d.importe) || d.importe <= 0) throw new Error('El importe va en centavos enteros y positivos.');
  if (d.importe > t.pendiente) {
    throw new Error(t.pendiente > 0 ? `El pago supera lo pendiente de ${l.codigo}.` : `${l.codigo} no tiene saldo a pagar en ${l.mes}.`);
  }
  if (typeof d.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) throw new Error('Fecha inválida (AAAA-MM-DD).');
  if (d.cuenta_id != null) {
    const c = db.prepare('SELECT nombre, moneda, activo FROM cuenta WHERE id = ?').get(d.cuenta_id) as { nombre: string; moneda: string; activo: number } | undefined;
    if (!c) throw new Error('No existe la cuenta.');
    if (c.moneda !== t.moneda) throw new Error(`${l.codigo} liquida en ${t.moneda} y la cuenta ${c.nombre} es en ${c.moneda}.`);
  }
  db.exec('BEGIN');
  try {
    const id = Number(db.prepare(`
      INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, concepto_id, detalle, importe_ars, importe_usd, cuenta_id, creado_en)
      VALUES (?, ?, ?, 'liquidacion', ?, ?, ?, ?, ?, ?)`).run(
      l.periodo_id, d.fecha, l.depto_id, conceptoId(db, 'Liquidacion periodo'), d.detalle?.trim() || 'Transferencia',
      t.moneda === 'ARS' ? -d.importe : 0, t.moneda === 'USD' ? -d.importe : 0, d.cuenta_id ?? null,
      new Date().toLocaleString('sv-SE').slice(0, 19),
    ).lastInsertRowid);
    if (!l.movimiento_pago_id) db.prepare('UPDATE liquidacion SET movimiento_pago_id = ? WHERE id = ?').run(id, l.id);
    auditar(db, 'movimiento', id, 'alta', null, { pago_liquidacion: l.id, depto: l.codigo, mes: l.mes, ...d });
    db.exec('COMMIT');
    return id;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

// Lista para el banco: una fila por depto con saldo a pagar (montos en pesos/dólares, no centavos).
export function excelTransferencias(db: DatabaseSync, mes: string): Buffer {
  const filas = listarTransferencias(db, mes).filter((t) => t.saldo > 0 && !t.arrastradoA).map((t) => ({
    Depto: t.codigo, Propietario: t.propietario, 'CBU/CVU': t.esHornera ? 'Nosotros' : (t.cbu ?? 'No informado'),
    Moneda: t.moneda, Saldo: t.saldo / 100, Pagado: t.pagado / 100, Pendiente: t.pendiente / 100,
  }));
  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja['!cols'] = [{ wch: 7 }, { wch: 40 }, { wch: 25 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, `Transferencias ${mes}`);
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}
