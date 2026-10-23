// Limpieza (plan 057): las tareas que las chicas cargan en el Google Form y lo que se liquida a la coordinadora por
// período (fechas libres). Se le paga todo junto a ella, pero se muestra cuánto le toca a cada chica. Control interno
// de la empresa: el pago es un gasto de Hornera y no toca las liquidaciones de los deptos.
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { crearMovimiento } from './movimientos.ts';

// Plus por tipo de tarea: horas que se suman (valor en minutos) o pesos por tarea (valor en centavos).
export type Plus = Record<string, { modo: 'horas' | 'pesos'; valor: number }>;
export const PLUS_INICIAL: Plus = {
  'Check-In': { modo: 'horas', valor: 60 }, 'Cambio Blanqueria': { modo: 'horas', valor: 60 }, 'Check-Out': { modo: 'horas', valor: 30 },
};
export interface Tarea { operaria: string; tipo: string; minutos: number; depto?: string | null }
export interface PorOperaria { operaria: string; tareas: number; minutos: number; importe: number }

const ahora = () => new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19); // hora local
const esFecha = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

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

// Lo de cada chica: minutos = duración + plus en horas; importe = minutos × precio / 60 + plus en pesos, redondeado
// por chica. El total del período es la suma de las chicas (más el ajuste): lo que reparte la coordinadora cierra exacto.
export function calcular(tareas: Tarea[], precioHora: number, plus: Plus) {
  const m = new Map<string, { tareas: number; minutos: number; pesos: number }>();
  for (const t of tareas) {
    const o = m.get(t.operaria) ?? { tareas: 0, minutos: 0, pesos: 0 };
    const p = plus[t.tipo];
    o.tareas++;
    o.minutos += t.minutos + (p?.modo === 'horas' ? p.valor : 0);
    o.pesos += p?.modo === 'pesos' ? p.valor : 0;
    m.set(t.operaria, o);
  }
  const porOperaria: PorOperaria[] = [...m].map(([operaria, o]) =>
    ({ operaria, tareas: o.tareas, minutos: o.minutos, importe: Math.round(o.minutos * precioHora / 60) + o.pesos }))
    .sort((a, b) => b.minutos - a.minutos || a.operaria.localeCompare(b.operaria));
  return { porOperaria, minutos: porOperaria.reduce((s, o) => s + o.minutos, 0), importe: porOperaria.reduce((s, o) => s + o.importe, 0) };
}

// ---- Reglas (plus por tipo), en configuracion. Cada liquidación se queda con una copia al crearse.

export function leerPlus(db: DatabaseSync): Plus {
  const v = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'limpieza.plus'`).get() as { valor: string } | undefined;
  return v ? JSON.parse(v.valor) : PLUS_INICIAL;
}

function validarPlus(plus: unknown): Plus {
  if (!plus || typeof plus !== 'object' || Array.isArray(plus)) throw new Error('Reglas del plus inválidas.');
  for (const [tipo, p] of Object.entries(plus as Record<string, any>)) {
    if (!tipo.trim()) throw new Error('Falta el tipo de tarea.');
    if (!p || !['horas', 'pesos'].includes(p.modo)) throw new Error(`${tipo}: el plus es en horas o en pesos.`);
    if (!Number.isInteger(p.valor) || p.valor < 0) throw new Error(`${tipo}: el valor va en minutos o centavos enteros, sin negativos.`);
  }
  return plus as Plus;
}

export function guardarPlus(db: DatabaseSync, plus: unknown) {
  const p = validarPlus(plus);
  const antes = leerPlus(db);
  db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('limpieza.plus', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(JSON.stringify(p));
  auditar(db, 'configuracion', null, 'modificacion', { 'limpieza.plus': antes }, { 'limpieza.plus': p });
}

// ---- Liquidaciones

interface FilaLiq {
  id: number; desde: string; hasta: string; precio_hora: number; plus_json: string; ajuste: number; ajuste_nota: string | null;
  movimiento_id: number | null; creado_en: string;
}
const leer = (db: DatabaseSync, id: number) => db.prepare('SELECT * FROM liquidacion_limpieza WHERE id = ?').get(id) as FilaLiq | undefined;

const tareasEntre = (db: DatabaseSync, desde: string, hasta: string) => db.prepare(`
  SELECT t.fecha, t.operaria, t.tipo, t.minutos, d.codigo AS depto FROM tarea_limpieza t LEFT JOIN depto d ON d.id = t.depto_id
  WHERE t.fecha BETWEEN ? AND ? ORDER BY t.fecha, t.id`).all(desde, hasta) as unknown as (Tarea & { fecha: string })[];

export interface DatosLiquidacion { desde: string; hasta: string; precio_hora: number; ajuste?: number; ajuste_nota?: string | null; plus?: Plus }

function validar(d: DatosLiquidacion) {
  if (!esFecha(d.desde) || !esFecha(d.hasta)) throw new Error('Fechas inválidas (AAAA-MM-DD).');
  if (d.hasta < d.desde) throw new Error('"Hasta" es anterior a "desde".');
  if (!Number.isInteger(d.precio_hora) || d.precio_hora <= 0) throw new Error('El precio por hora va en centavos enteros y mayor que 0.');
  const ajuste = d.ajuste ?? 0;
  if (!Number.isInteger(ajuste)) throw new Error('El ajuste va en centavos enteros.');
  const nota = d.ajuste_nota?.trim() || null;
  if (ajuste !== 0 && !nota) throw new Error('Un ajuste lleva una nota que diga por qué.');
  return { desde: d.desde, hasta: d.hasta, precio_hora: d.precio_hora, ajuste, ajuste_nota: nota };
}

// El trigger de solapamiento habla en SQL; acá se traduce para el usuario.
function sinPisar<T>(db: DatabaseSync, d: { desde: string; hasta: string }, id: number | null, fn: () => T): T {
  const otra = db.prepare('SELECT desde, hasta FROM liquidacion_limpieza WHERE id IS NOT ? AND desde <= ? AND hasta >= ?')
    .get(id, d.hasta, d.desde) as { desde: string; hasta: string } | undefined;
  if (otra) throw new Error(`Se pisa con el período ${ddmm(otra.desde)}–${ddmm(otra.hasta)}.`);
  return fn();
}

export function crearLiquidacion(db: DatabaseSync, d: DatosLiquidacion): number {
  return enTransaccion(db, () => {
    const v = { ...validar(d), plus_json: JSON.stringify(d.plus ? validarPlus(d.plus) : leerPlus(db)) };
    return sinPisar(db, v, null, () => {
      const id = Number(db.prepare(`
        INSERT INTO liquidacion_limpieza(desde, hasta, precio_hora, plus_json, ajuste, ajuste_nota, creado_en)
        VALUES (:desde, :hasta, :precio_hora, :plus_json, :ajuste, :ajuste_nota, :creado_en)`).run({ ...v, creado_en: ahora() }).lastInsertRowid);
      auditar(db, 'liquidacion_limpieza', id, 'alta', null, v);
      return id;
    });
  });
}

// Solo pendiente: una pagada quedó como se pagó (para cambiarla, anular el pago en Movimientos).
export function editarLiquidacion(db: DatabaseSync, id: number, d: DatosLiquidacion) {
  enTransaccion(db, () => {
    const antes = leer(db, id);
    if (!antes) throw new Error('No existe la liquidación.');
    if (antes.movimiento_id != null) throw new Error('La liquidación ya está pagada: para cambiarla, anulá el pago en Movimientos.');
    const v = { ...validar(d), plus_json: d.plus ? JSON.stringify(validarPlus(d.plus)) : antes.plus_json };
    sinPisar(db, v, id, () => db.prepare(`UPDATE liquidacion_limpieza SET desde = :desde, hasta = :hasta, precio_hora = :precio_hora,
      plus_json = :plus_json, ajuste = :ajuste, ajuste_nota = :ajuste_nota WHERE id = :id`).run({ ...v, id }));
    auditar(db, 'liquidacion_limpieza', id, 'modificacion', antes, v);
  });
}

function detalle(db: DatabaseSync, l: FilaLiq) {
  const plus: Plus = JSON.parse(l.plus_json);
  const tareas = tareasEntre(db, l.desde, l.hasta);
  const pagada = l.movimiento_id != null;
  const calculo = calcular(tareas, l.precio_hora, plus);
  const porOperaria = pagada
    ? db.prepare(`SELECT operaria, tareas, minutos, importe FROM liquidacion_limpieza_operaria WHERE liquidacion_limpieza_id = ?
        ORDER BY minutos DESC, operaria`).all(l.id) as unknown as PorOperaria[]
    : calculo.porOperaria;
  const importe = porOperaria.reduce((s, o) => s + o.importe, 0);
  // Por depto es informativo: sale de las tareas de hoy (en una pagada puede diferir de la foto si cambió el Excel).
  const porDepto = new Map<string, { tareas: number; minutos: number }>();
  for (const t of tareas) {
    const p = plus[t.tipo];
    const k = t.depto ?? 'INT';
    const x = porDepto.get(k) ?? { tareas: 0, minutos: 0 };
    x.tareas++;
    x.minutos += t.minutos + (p?.modo === 'horas' ? p.valor : 0);
    porDepto.set(k, x);
  }
  const fechaPago = pagada ? (db.prepare('SELECT fecha FROM movimiento WHERE id = ?').get(l.movimiento_id) as { fecha: string }).fecha : null;
  return {
    id: l.id, desde: l.desde, hasta: l.hasta, precio_hora: l.precio_hora, plus, ajuste: l.ajuste, ajuste_nota: l.ajuste_nota,
    pagada, movimiento_id: l.movimiento_id, fecha_pago: fechaPago,
    tareas: tareas.length, minutos: porOperaria.reduce((s, o) => s + o.minutos, 0), importe, total: importe + l.ajuste,
    // Pagada y el Excel cambió después: se avisa, lo pagado no se toca.
    difiere: pagada && (calculo.importe !== importe || calculo.porOperaria.length !== porOperaria.length),
    porOperaria,
    porDepto: [...porDepto].map(([depto, x]) => ({ depto, ...x })).sort((a, b) => b.minutos - a.minutos),
  };
}

export function verLiquidacion(db: DatabaseSync, id: number) {
  const l = leer(db, id);
  if (!l) throw new Error('No existe la liquidación.');
  return detalle(db, l);
}

export function listarLiquidaciones(db: DatabaseSync) {
  const filas = db.prepare('SELECT * FROM liquidacion_limpieza ORDER BY desde DESC').all() as unknown as FilaLiq[];
  return filas.map((l) => { const { porOperaria: _o, porDepto: _d, ...resto } = detalle(db, l); return resto; });
}

// Guarda la foto por chica y crea el gasto de la empresa (concepto Limpieza) en el mes de la fecha de pago.
export function pagarLiquidacion(db: DatabaseSync, id: number, d: { fecha: string; cuenta_id: number | null }) {
  return enTransaccion(db, () => {
    const l = leer(db, id);
    if (!l) throw new Error('No existe la liquidación.');
    if (l.movimiento_id != null) throw new Error('La liquidación ya está pagada.');
    if (!esFecha(d.fecha)) throw new Error('Fecha de pago inválida (AAAA-MM-DD).');
    const { porOperaria, total } = detalle(db, l);
    if (total <= 0) throw new Error('No hay nada para pagar en el período.');
    const movimientoId = crearMovimiento(db, {
      mes: d.fecha.slice(0, 7), fecha: d.fecha, depto: null, tipo: 'gasto', concepto: 'Limpieza',
      detalle: `Limpieza ${ddmm(l.desde)}–${ddmm(l.hasta)}`, importe_ars: -total, importe_usd: 0, cuenta_id: d.cuenta_id ?? null,
    });
    const foto = db.prepare('INSERT INTO liquidacion_limpieza_operaria VALUES (?, ?, ?, ?, ?)');
    for (const o of porOperaria) foto.run(id, o.operaria, o.tareas, o.minutos, o.importe);
    db.prepare('UPDATE liquidacion_limpieza SET movimiento_id = ? WHERE id = ?').run(movimientoId, id);
    auditar(db, 'liquidacion_limpieza', id, 'modificacion', { movimiento_id: null }, { movimiento_id: movimientoId, porOperaria, total });
    return { movimiento_id: movimientoId };
  });
}

// ---- Horas (informativo): con el plus en horas de las reglas actuales, como la columna "Horas Totales" del Excel.
export function horas(db: DatabaseSync, desde: string, hasta: string) {
  if (!esFecha(desde) || !esFecha(hasta)) throw new Error('Fechas inválidas (AAAA-MM-DD).');
  const plus = leerPlus(db);
  const sumar = (m: Map<string, { tareas: number; minutos: number }>, k: string, min: number) => {
    const x = m.get(k) ?? { tareas: 0, minutos: 0 };
    x.tareas++;
    x.minutos += min;
    m.set(k, x);
  };
  const operaria = new Map(), depto = new Map(), mes = new Map();
  for (const t of tareasEntre(db, desde, hasta)) {
    const p = plus[t.tipo];
    const min = t.minutos + (p?.modo === 'horas' ? p.valor : 0);
    sumar(operaria, t.operaria, min);
    sumar(depto, t.depto ?? 'INT', min);
    sumar(mes, t.fecha.slice(0, 7), min);
  }
  const lista = (m: Map<string, { tareas: number; minutos: number }>) => [...m].map(([clave, x]) => ({ clave, ...x }));
  return {
    porOperaria: lista(operaria).sort((a, b) => b.minutos - a.minutos),
    porDepto: lista(depto).sort((a, b) => b.minutos - a.minutos),
    porMes: lista(mes).sort((a, b) => a.clave.localeCompare(b.clave)),
  };
}
