// Ficha del depto (plan 049): notas, servicios e impuestos con su vencimiento, claves y contactos.
// Pantalla Mes → Vencimientos: lo que vence en un mes de los servicios que paga Hornera.
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { conceptoId } from './movimientos.ts';

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const entero = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

// Las tres listas de la ficha: tabla y cómo se valida cada renglón.
const LISTAS = {
  servicios: {
    tabla: 'depto_servicio',
    fila(b: Record<string, unknown>, db: DatabaseSync) {
      const f = {
        cuenta: texto(b.cuenta), titular: texto(b.titular), paga: b.paga === 'propietario' ? 'propietario' : 'hornera',
        dia: entero(b.dia), cada_meses: entero(b.cada_meses), mes_desde: entero(b.mes_desde), nota: texto(b.nota),
      };
      if (!texto(b.concepto)) throw new Error('Elegí el concepto del servicio.');
      const vence = [f.dia, f.cada_meses, f.mes_desde];
      if (vence.some((v) => v !== null) && vence.some((v) => v === null)) throw new Error('El vencimiento lleva día, cada cuántos meses y desde qué mes.');
      if (f.dia !== null && !(Number.isSafeInteger(f.dia) && f.dia >= 1 && f.dia <= 31)) throw new Error('El día de vencimiento va de 1 a 31.');
      if (f.cada_meses !== null && ![1, 2, 3, 4, 6, 12].includes(f.cada_meses)) throw new Error('Cada cuántos meses: 1, 2, 3, 4, 6 o 12.');
      if (f.mes_desde !== null && !(Number.isSafeInteger(f.mes_desde) && f.mes_desde >= 1 && f.mes_desde <= 12)) throw new Error('El mes va de 1 a 12.');
      return { ...f, concepto_id: conceptoId(db, texto(b.concepto)) }; // como en Movimientos: uno nuevo se crea
    },
  },
  claves: {
    tabla: 'depto_clave',
    fila(b: Record<string, unknown>) {
      const f = { nombre: texto(b.nombre), usuario: texto(b.usuario), clave: texto(b.clave), nota: texto(b.nota) };
      if (!f.nombre) throw new Error('Poné qué es (por ejemplo, "Wifi").');
      return f;
    },
  },
  contactos: {
    tabla: 'depto_contacto',
    fila(b: Record<string, unknown>) {
      const f = { nombre: texto(b.nombre), rol: texto(b.rol), telefono: texto(b.telefono), nota: texto(b.nota) };
      if (!f.nombre) throw new Error('Falta el nombre del contacto.');
      return f;
    },
  },
};
export type Lista = keyof typeof LISTAS;

function lista(nombre: string) {
  if (!Object.hasOwn(LISTAS, nombre)) throw new Error(`No existe la lista "${nombre}".`);
  return LISTAS[nombre as Lista];
}

type Fila = Record<string, unknown>;
// Solo las claves van a la auditoría, y sin el valor de la clave: la auditoría no es otro lugar donde leerlas.
function registrar(db: DatabaseSync, tabla: string, id: number, accion: 'alta' | 'modificacion' | 'anulacion', antes?: Fila, despues?: Fila) {
  if (tabla !== 'depto_clave') return;
  const { codigo } = db.prepare('SELECT codigo FROM depto WHERE id = ?').get(Number((antes ?? despues)!.depto_id)) as { codigo: string };
  const sinClave = (f?: Fila) => f && { depto: codigo, nombre: f.nombre, usuario: f.usuario, nota: f.nota,
    clave: f.clave ? 'cargada' : null } as Fila;
  const a = sinClave(antes), d = sinClave(despues);
  if (a && d && antes!.clave !== despues!.clave) [a.clave, d.clave] = ['anterior', 'nueva'];
  auditar(db, tabla, id, accion, a, d);
}

export function ficha(db: DatabaseSync, deptoId: number) {
  const d = db.prepare('SELECT notas FROM depto WHERE id = ?').get(deptoId) as { notas: string | null } | undefined;
  if (!d) throw new Error('No existe el depto.');
  return {
    notas: d.notas,
    servicios: db.prepare(`SELECT s.*, c.nombre AS concepto FROM depto_servicio s JOIN concepto c ON c.id = s.concepto_id
      WHERE s.depto_id = ? ORDER BY c.nombre, s.id`).all(deptoId),
    claves: db.prepare('SELECT * FROM depto_clave WHERE depto_id = ? ORDER BY nombre, id').all(deptoId),
    contactos: db.prepare('SELECT * FROM depto_contacto WHERE depto_id = ? ORDER BY nombre, id').all(deptoId),
  };
}

export function guardarNotas(db: DatabaseSync, deptoId: number, cuerpo: unknown) {
  const r = db.prepare('UPDATE depto SET notas = ? WHERE id = ?').run(texto((cuerpo as { notas?: unknown } | null)?.notas), deptoId);
  if (!r.changes) throw new Error('No existe el depto.');
}

export function agregar(db: DatabaseSync, nombre: string, deptoId: number, cuerpo: unknown) {
  const { tabla, fila } = lista(nombre);
  if (!db.prepare('SELECT 1 FROM depto WHERE id = ?').get(deptoId)) throw new Error('No existe el depto.');
  const f = { ...fila((cuerpo ?? {}) as Fila, db), depto_id: deptoId };
  const campos = Object.keys(f);
  const id = Number(db.prepare(`INSERT INTO ${tabla}(${campos.join(', ')}) VALUES (${campos.map((c) => `:${c}`).join(', ')})`).run(f).lastInsertRowid);
  registrar(db, tabla, id, 'alta', undefined, f);
  return id;
}

export function editar(db: DatabaseSync, nombre: string, id: number, cuerpo: unknown) {
  const { tabla, fila } = lista(nombre);
  const antes = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id) as Fila | undefined;
  if (!antes) throw new Error('Ese renglón ya no existe.');
  const f = fila((cuerpo ?? {}) as Fila, db);
  db.prepare(`UPDATE ${tabla} SET ${Object.keys(f).map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`).run({ ...f, id });
  registrar(db, tabla, id, 'modificacion', antes, { ...f, depto_id: antes.depto_id });
}

// ponytail: se borra de verdad; no es plata ni entra en liquidaciones (las claves quedan auditadas).
export function borrar(db: DatabaseSync, nombre: string, id: number) {
  const { tabla } = lista(nombre);
  const antes = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id) as Fila | undefined;
  if (!antes) return;
  db.prepare(`DELETE FROM ${tabla} WHERE id = ?`).run(id);
  registrar(db, tabla, id, 'anulacion', antes);
}

export interface Vencimiento {
  servicio_id: number; depto_id: number; codigo: string; depto: string; concepto: string; cuenta: string | null;
  vence: string; estado: 'pagado' | 'pendiente' | 'vencido';
}

/** Lo que vence en `mes` (AAAA-MM). Pagado = hay un gasto vigente del depto con ese concepto y fecha en el mes. */
export function vencimientos(db: DatabaseSync, mes: string, hoy = new Date().toLocaleDateString('sv')): Vencimiento[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error(`Mes inválido: "${mes}" (se espera AAAA-MM).`);
  const [anio, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  const filas = db.prepare(`
    SELECT s.id AS servicio_id, s.depto_id, d.codigo, d.nombre AS depto, c.nombre AS concepto, s.cuenta, s.dia, s.cada_meses, s.mes_desde,
           EXISTS (SELECT 1 FROM movimiento mv WHERE mv.depto_id = s.depto_id AND mv.concepto_id = s.concepto_id
                   AND mv.tipo = 'gasto' AND mv.estado = 'vigente' AND substr(mv.fecha, 1, 7) = ?) AS pagado
    FROM depto_servicio s JOIN depto d ON d.id = s.depto_id JOIN concepto c ON c.id = s.concepto_id
    WHERE s.paga = 'hornera' AND s.dia IS NOT NULL AND d.estado <> 'finalizado'`).all(mes) as
    { servicio_id: number; depto_id: number; codigo: string; depto: string; concepto: string; cuenta: string | null; dia: number; cada_meses: number; mes_desde: number; pagado: number }[];
  return filas
    .filter((f) => (((m - f.mes_desde) % f.cada_meses) + f.cada_meses) % f.cada_meses === 0)
    .map(({ dia, cada_meses: _, mes_desde: __, pagado, ...f }) => {
      const vence = `${mes}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`; // día 31 en un mes de 30: el último
      return { ...f, vence, estado: pagado ? 'pagado' : vence < hoy ? 'vencido' : 'pendiente' } as Vencimiento;
    })
    .sort((a, b) => a.vence.localeCompare(b.vence) || a.codigo.localeCompare(b.codigo));
}
