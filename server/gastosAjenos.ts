// Gastos del Excel de gastos varios que no son de Hornera (plan 047): personales de Amancay y Lautaro, compartidos,
// de la Casa del Estudiante y de la casa. Van aparte de los movimientos: no tocan liquidaciones, cuentas ni el
// resultado. No se borran: se anulan. Todo cambio queda en `auditoria`.
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { sello } from './sello.ts';
import { periodoAbierto } from './movimientos.ts';

export const CODIGOS_AJENOS = ['CAY', 'LAU', 'CAY/LAU', 'CASEST', 'CASA'];

export interface DatosGastoAjeno {
  fecha: string;               // el mes del gasto es el de la fecha
  codigo: string;
  descripcion: string | null;
  importe: number;             // centavos, positivo
  origen?: string | null;      // fila del Excel (solo al crear)
}

const esFecha = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function validar(db: DatabaseSync, d: DatosGastoAjeno) {
  if (!esFecha(d.fecha)) throw new Error('Fecha inválida (AAAA-MM-DD).');
  if (!CODIGOS_AJENOS.includes(d.codigo)) throw new Error(`Código inválido: ${d.codigo}.`);
  if (!Number.isInteger(d.importe) || d.importe <= 0) throw new Error('El importe va en centavos enteros y positivo.');
  return { periodo_id: periodoAbierto(db, d.fecha.slice(0, 7)), fecha: d.fecha, codigo: d.codigo, descripcion: d.descripcion?.trim() || null, importe: d.importe };
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

const leer = (db: DatabaseSync, id: number) => db.prepare('SELECT * FROM gasto_ajeno WHERE id = ?').get(id) as Record<string, any> | undefined;

export function crearGastoAjeno(db: DatabaseSync, d: DatosGastoAjeno): number {
  return enTransaccion(db, () => {
    const v = validar(db, d);
    const id = Number(db.prepare(`
      INSERT INTO gasto_ajeno(periodo_id, fecha, codigo, descripcion, importe, origen, creado_en)
      VALUES (:periodo_id, :fecha, :codigo, :descripcion, :importe, :origen, :creado_en)`)
      .run({ ...v, origen: d.origen ?? null, creado_en: sello() }).lastInsertRowid);
    auditar(db, 'gasto_ajeno', id, 'alta', null, v);
    return id;
  });
}

export function editarGastoAjeno(db: DatabaseSync, id: number, d: DatosGastoAjeno) {
  enTransaccion(db, () => {
    const antes = leer(db, id);
    if (!antes) throw new Error('No existe el gasto.');
    if (antes.estado !== 'vigente') throw new Error('El gasto está anulado.');
    periodoAbierto(db, (db.prepare('SELECT mes FROM periodo WHERE id = ?').get(antes.periodo_id) as { mes: string }).mes);
    const v = validar(db, d);
    db.prepare(`UPDATE gasto_ajeno SET periodo_id = :periodo_id, fecha = :fecha, codigo = :codigo, descripcion = :descripcion,
      importe = :importe WHERE id = :id`).run({ ...v, id });
    auditar(db, 'gasto_ajeno', id, 'modificacion', antes, v);
  });
}

export function anularGastoAjeno(db: DatabaseSync, id: number) {
  enTransaccion(db, () => {
    const g = leer(db, id);
    if (!g) throw new Error('No existe el gasto.');
    if (g.estado !== 'vigente') throw new Error('El gasto ya está anulado.');
    periodoAbierto(db, (db.prepare('SELECT mes FROM periodo WHERE id = ?').get(g.periodo_id) as { mes: string }).mes);
    db.prepare(`UPDATE gasto_ajeno SET estado = 'anulado' WHERE id = ?`).run(id);
    auditar(db, 'gasto_ajeno', id, 'anulacion', { estado: 'vigente' }, { estado: 'anulado' });
  });
}

export function listarGastosAjenos(db: DatabaseSync, mes: string) {
  const gastos = db.prepare(`
    SELECT g.id, g.fecha, g.codigo, g.descripcion, g.importe, g.estado FROM gasto_ajeno g JOIN periodo p ON p.id = g.periodo_id
    WHERE p.mes = ? ORDER BY g.fecha, g.id`).all(mes) as { codigo: string; importe: number; estado: string }[];
  const porCodigo: Record<string, number> = Object.fromEntries(CODIGOS_AJENOS.map((c) => [c, 0]));
  for (const g of gastos) if (g.estado === 'vigente') porCodigo[g.codigo] += g.importe;
  // ponytail: los compartidos se parten sobre la suma del mes; el centavo impar va a Amancay.
  const mitad = Math.floor(porCodigo['CAY/LAU'] / 2);
  return { gastos, totales: { porCodigo, amancay: porCodigo.CAY + porCodigo['CAY/LAU'] - mitad, lautaro: porCodigo.LAU + mitad } };
}
