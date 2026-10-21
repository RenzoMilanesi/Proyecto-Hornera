// Movimientos (reemplaza la hoja CORRIENTE): gastos e ingresos de cada depto o de la
// empresa, adelantos al propietario, cobros directos, saldos iniciales y transferencias
// entre cuentas. Nunca se borran: se anulan. Todo cambio queda en `auditoria`.
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';

// Los de tipo 'liquidacion' los genera "marcar pagado" (fase 5c) y los de 'transferencia', transferir().
export const TIPOS_CARGABLES = ['gasto', 'ingreso', 'pre_liquidacion', 'pago_directo', 'saldo_inicial', 'ajuste'] as const;
const EGRESOS = new Set(['gasto', 'pre_liquidacion', 'pago_directo']); // importes ≤ 0
const CON_DEPTO = new Set(['pre_liquidacion', 'pago_directo']);       // siempre son de un propietario

export interface DatosMovimiento {
  mes: string;                 // período al que se imputa
  fecha: string;
  depto: string | null;        // código; null = empresa (INT)
  tipo: string;
  concepto: string | null;     // nombre; si no existe se da de alta
  detalle: string | null;
  importe_ars: number;         // centavos, con signo
  importe_usd: number;
  cuenta_id: number | null;    // null = no mueve plata de una cuenta
  origen?: string | null;      // fila de un Excel importado (solo al crear; editar no lo cambia)
}

const ahora = () => new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19); // hora local
const esFecha = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function periodoAbierto(db: DatabaseSync, mes: unknown): number {
  const p = db.prepare('SELECT id, estado FROM periodo WHERE mes = ?').get(String(mes)) as { id: number; estado: string } | undefined;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  if (p.estado !== 'abierto') throw new Error(`El período ${mes} está cerrado: reabrilo para cargar o cambiar movimientos.`);
  return p.id;
}

function cuentaActiva(db: DatabaseSync, id: unknown) {
  const c = db.prepare('SELECT id, nombre, moneda, activo FROM cuenta WHERE id = ?').get(Number(id)) as
    { id: number; nombre: string; moneda: 'ARS' | 'USD'; activo: number } | undefined;
  if (!c) throw new Error('No existe la cuenta.');
  if (!c.activo) throw new Error(`La cuenta ${c.nombre} está dada de baja.`);
  return c;
}

export function conceptoId(db: DatabaseSync, nombre: string | null): number | null {
  const n = nombre?.trim();
  if (!n) return null;
  const fila = db.prepare('SELECT id FROM concepto WHERE lower(nombre) = lower(?)').get(n) as { id: number } | undefined;
  return fila?.id ?? Number(db.prepare('INSERT INTO concepto(nombre) VALUES (?)').run(n).lastInsertRowid);
}

// Valida y traduce a columnas. Los errores son mensajes para mostrar tal cual.
function validar(db: DatabaseSync, d: DatosMovimiento) {
  const periodoId = periodoAbierto(db, d.mes);
  if (!esFecha(d.fecha)) throw new Error('Fecha inválida (AAAA-MM-DD).');
  if (!(TIPOS_CARGABLES as readonly string[]).includes(d.tipo)) throw new Error(`Tipo de movimiento inválido: ${d.tipo}.`);
  if (!Number.isInteger(d.importe_ars) || !Number.isInteger(d.importe_usd)) throw new Error('Los importes van en centavos enteros.');
  if (d.importe_ars === 0 && d.importe_usd === 0) throw new Error('Falta el importe.');
  if (EGRESOS.has(d.tipo) && (d.importe_ars > 0 || d.importe_usd > 0)) throw new Error(`Un movimiento de tipo ${d.tipo} es un egreso: el importe va negativo.`);
  if (d.tipo === 'ingreso' && (d.importe_ars < 0 || d.importe_usd < 0)) throw new Error('Un ingreso va positivo.');

  let deptoId: number | null = null;
  if (d.depto) {
    const depto = db.prepare('SELECT id FROM depto WHERE codigo = ?').get(d.depto) as { id: number } | undefined;
    if (!depto) throw new Error(`No existe el depto ${d.depto}.`);
    deptoId = depto.id;
  } else if (CON_DEPTO.has(d.tipo)) {
    throw new Error(`Un movimiento de tipo ${d.tipo} tiene que ser de un depto.`);
  }
  if (d.cuenta_id != null) {
    const c = cuentaActiva(db, d.cuenta_id);
    if ((c.moneda === 'ARS' && d.importe_usd !== 0) || (c.moneda === 'USD' && d.importe_ars !== 0)) {
      throw new Error(`La cuenta ${c.nombre} es en ${c.moneda}: el importe tiene que estar solo en ${c.moneda}.`);
    }
  }
  return {
    periodo_id: periodoId, fecha: d.fecha, depto_id: deptoId, tipo: d.tipo, concepto_id: conceptoId(db, d.concepto),
    detalle: d.detalle?.trim() || null, importe_ars: d.importe_ars, importe_usd: d.importe_usd, cuenta_id: d.cuenta_id ?? null,
  };
}

function enTransaccion<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

const leer = (db: DatabaseSync, id: number) => db.prepare('SELECT * FROM movimiento WHERE id = ?').get(id) as Record<string, any> | undefined;

export function crearMovimiento(db: DatabaseSync, d: DatosMovimiento): number {
  return enTransaccion(db, () => {
    const v = validar(db, d);
    const id = Number(db.prepare(`
      INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, concepto_id, detalle, importe_ars, importe_usd, cuenta_id, origen, creado_en)
      VALUES (:periodo_id, :fecha, :depto_id, :tipo, :concepto_id, :detalle, :importe_ars, :importe_usd, :cuenta_id, :origen, :creado_en)`)
      .run({ ...v, origen: d.origen ?? null, creado_en: ahora() }).lastInsertRowid);
    auditar(db, 'movimiento', id, 'alta', null, v);
    return id;
  });
}

export function editarMovimiento(db: DatabaseSync, id: number, d: DatosMovimiento) {
  enTransaccion(db, () => {
    const antes = leer(db, id);
    if (!antes) throw new Error('No existe el movimiento.');
    if (antes.estado !== 'vigente') throw new Error('El movimiento está anulado.');
    if (antes.tipo === 'liquidacion' || antes.tipo === 'transferencia') {
      throw new Error('Los pagos de liquidación y las transferencias no se editan: se anulan y se vuelven a cargar.');
    }
    periodoAbierto(db, (db.prepare('SELECT mes FROM periodo WHERE id = ?').get(antes.periodo_id) as { mes: string }).mes);
    const v = validar(db, d);
    db.prepare(`
      UPDATE movimiento SET periodo_id = :periodo_id, fecha = :fecha, depto_id = :depto_id, tipo = :tipo, concepto_id = :concepto_id,
        detalle = :detalle, importe_ars = :importe_ars, importe_usd = :importe_usd, cuenta_id = :cuenta_id WHERE id = :id`).run({ ...v, id });
    auditar(db, 'movimiento', id, 'modificacion', antes, v);
  });
}

// Anula el movimiento (y su contraparte si es una transferencia).
export function anularMovimiento(db: DatabaseSync, id: number) {
  enTransaccion(db, () => {
    const m = leer(db, id);
    if (!m) throw new Error('No existe el movimiento.');
    if (m.estado !== 'vigente') throw new Error('El movimiento ya está anulado.');
    // Con el mes siguiente cerrado, ese cierre ya arrastró el saldo descontando este pago: anularlo dejaría la plata
    // sin deberse en ningún mes (y desde el mes viejo no se puede volver a pagar, plan 025).
    if (m.tipo === 'liquidacion') {
      const sig = db.prepare(`SELECT s.mes FROM periodo p JOIN periodo s ON s.mes > p.mes WHERE p.id = ? AND s.estado = 'cerrado' ORDER BY s.mes LIMIT 1`)
        .get(m.periodo_id) as { mes: string } | undefined;
      if (sig) throw new Error(`El saldo de este mes ya pasó a ${sig.mes} (cerrado): reabrí ${sig.mes} para anular el pago.`);
    }
    const ids = m.transferencia_grupo
      ? (db.prepare(`SELECT id FROM movimiento WHERE transferencia_grupo = ? AND estado = 'vigente'`).all(m.transferencia_grupo) as { id: number }[]).map((x) => x.id)
      : [id];
    for (const x of ids) {
      db.prepare(`UPDATE movimiento SET estado = 'anulado' WHERE id = ?`).run(x); // el trigger frena si el período está cerrado
      auditar(db, 'movimiento', x, 'anulacion', { estado: 'vigente' }, { estado: 'anulado' });
    }
  });
}

export interface DatosTransferencia {
  mes: string; fecha: string; detalle: string | null;
  desde_cuenta_id: number; importe_desde: number;   // centavos > 0, en la moneda de la cuenta de origen
  hacia_cuenta_id: number; importe_hacia: number;   // centavos > 0, en la moneda de la de destino (compra/venta de USD)
}

// Transferencia entre cuentas propias: dos movimientos con el mismo transferencia_grupo.
export function transferir(db: DatabaseSync, t: DatosTransferencia): number {
  return enTransaccion(db, () => {
    const periodoId = periodoAbierto(db, t.mes);
    if (!esFecha(t.fecha)) throw new Error('Fecha inválida (AAAA-MM-DD).');
    const desde = cuentaActiva(db, t.desde_cuenta_id);
    const hacia = cuentaActiva(db, t.hacia_cuenta_id);
    if (desde.id === hacia.id) throw new Error('La cuenta de origen y la de destino son la misma.');
    if (!Number.isInteger(t.importe_desde) || !Number.isInteger(t.importe_hacia) || t.importe_desde <= 0 || t.importe_hacia <= 0) {
      throw new Error('Los importes van en centavos enteros y positivos.');
    }
    if (desde.moneda === hacia.moneda && t.importe_desde !== t.importe_hacia) {
      throw new Error('Entre cuentas de la misma moneda el importe que sale y el que entra son el mismo.');
    }
    const alta = db.prepare(`
      INSERT INTO movimiento(periodo_id, fecha, tipo, detalle, importe_ars, importe_usd, cuenta_id, transferencia_grupo, creado_en)
      VALUES (?, ?, 'transferencia', ?, ?, ?, ?, ?, ?)`);
    const lado = (c: typeof desde, importe: number) => (c.moneda === 'ARS' ? [importe, 0] : [0, importe]);
    const detalle = t.detalle?.trim() || `${desde.nombre} → ${hacia.nombre}`;
    const primero = Number(alta.run(periodoId, t.fecha, detalle, ...lado(desde, -t.importe_desde), desde.id, null, ahora()).lastInsertRowid);
    db.prepare('UPDATE movimiento SET transferencia_grupo = ? WHERE id = ?').run(primero, primero);
    const segundo = Number(alta.run(periodoId, t.fecha, detalle, ...lado(hacia, t.importe_hacia), hacia.id, primero, ahora()).lastInsertRowid);
    auditar(db, 'movimiento', primero, 'alta', null, { transferencia: t, movimientos: [primero, segundo] });
    return primero;
  });
}

export function listarMovimientos(db: DatabaseSync, mes: string) {
  return db.prepare(`
    SELECT m.id, m.fecha, d.codigo AS depto, m.tipo, c.nombre AS concepto, m.detalle, m.importe_ars, m.importe_usd,
           m.cuenta_id, cu.nombre AS cuenta, m.estado, m.transferencia_grupo
    FROM movimiento m JOIN periodo p ON p.id = m.periodo_id
    LEFT JOIN depto d ON d.id = m.depto_id
    LEFT JOIN concepto c ON c.id = m.concepto_id
    LEFT JOIN cuenta cu ON cu.id = m.cuenta_id
    WHERE p.mes = ? ORDER BY m.fecha, m.id`).all(mes);
}
