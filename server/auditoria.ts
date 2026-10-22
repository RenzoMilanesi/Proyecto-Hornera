// Registro de cambios financieros (DECISIONES: antes/después, con fecha y PC; sin login).
// El usuario es la PC: Lautaro y Amancay usan una cada uno (la servidor con el nombre de Terminales).
import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';

type Accion = 'alta' | 'modificacion' | 'anulacion' | 'cierre' | 'reapertura' | 'importacion';

// Nombre de la terminal que hizo el pedido (lo pone server/terminales.ts); sin terminal, esta PC.
export const pcActual = new AsyncLocalStorage<string>();

// Nombre de la PC servidor: el que se le pone en Terminales o, si no, el de Windows.
export const nombrePc = (db: DatabaseSync) =>
  (db.prepare(`SELECT valor FROM configuracion WHERE clave = 'pc.nombre'`).get() as { valor: string } | undefined)?.valor ?? hostname();

// Al ponerle nombre, lo ya registrado con el nombre anterior pasa a decir el nuevo (decisión 2026-10-21).
export function nombrarPc(db: DatabaseSync, nombre: unknown) {
  const n = typeof nombre === 'string' ? nombre.trim().slice(0, 60) : '';
  if (!n) throw new Error('Escribí el nombre de esta PC.');
  const anterior = nombrePc(db);
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('pc.nombre', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(n);
    db.prepare('UPDATE auditoria SET pc = ? WHERE pc = ?').run(n, anterior);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { nombre: n };
}

export function auditar(db: DatabaseSync, tabla: string, id: number | null, accion: Accion, antes: unknown, despues: unknown) {
  db.prepare(`INSERT INTO auditoria(fecha, pc, tabla, registro_id, accion, antes_json, despues_json) VALUES (datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?)`)
    .run(pcActual.getStore() ?? nombrePc(db), tabla, id, accion, antes == null ? null : JSON.stringify(antes), despues == null ? null : JSON.stringify(despues));
}

// ---- Pantalla Herramientas → Auditoría: los cambios de un mes, legibles.

const TIPOS: Record<string, string> = {
  movimiento: 'Movimiento', reserva: 'Reserva', periodo: 'Mes', depto: 'Variables del depto', cuenta: 'Cuenta',
  medio_pago: 'Medio de pago', emisor: 'Emisor', propietario: 'Datos fiscales', comprobante: 'Factura',
  comprobante_arca: 'Comprobante de ARCA', stays: 'Traer mes de Stays', excel: 'Excel mensual', gastos: 'Gastos varios',
};
const ACCIONES: Record<Accion, string> = {
  alta: 'Alta', modificacion: 'Modificación', anulacion: 'Anulación', cierre: 'Cierre', reapertura: 'Reapertura', importacion: 'Importación',
};
const CAMPOS: Record<string, string> = {
  importe_ars: 'Importe $', importe_usd: 'Importe US$', depto_id: 'Depto', concepto_id: 'Concepto', cuenta_id: 'Cuenta',
  periodo_id: 'Mes', ajuste_ars: 'Corrección $', ajuste_usd: 'Corrección US$', ajuste_comision_ars: 'Comisión $',
  ajuste_comision_usd: 'Comisión US$', usd_cotizacion: 'Cotización del dólar', usd_descuento_pct: 'Descuento del dólar',
  comision_pct: 'Comisión', tarifa_base_override: 'Tarifa base propia', adicional_huesped_override: 'Adicional por huésped propio',
  cm_fee_usd_override: 'Channel manager propio', cm_fee_usd: 'Channel manager', descuenta_comision: 'Descuenta comisión', pago_liquidacion: 'Liquidación n.º',
};

const plata = (c: number, usd: boolean) =>
  `${usd ? 'US$' : '$'} ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PLATA = /importe|ajuste|tarifa|costo|servicio|cargo|adicional|prestamo|gestion|mantenimiento|cm_fee/;
const etiqueta = (k: string) => CAMPOS[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)).replaceAll('_', ' ');

type Nombres = Record<string, Map<number, string>>;
function valor(k: string, v: unknown, n: Nombres): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.map((x) => valor(k, x, n)).join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([k2, v2]) => `${etiqueta(k2)}: ${valor(k2, v2, n)}`).join(', ');
  if (typeof v !== 'number') return String(v);
  if (n[k]) return n[k].get(v) ?? `#${v}`;
  if (k.endsWith('_pct')) return `${(v * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
  if (k === 'usd_cotizacion') return `$ ${v.toLocaleString('es-AR')}`;
  if (PLATA.test(k)) return plata(v, k.includes('usd'));
  if (['excluida', 'activo', 'descuenta_comision'].includes(k)) return v ? 'Sí' : 'No';
  return String(v);
}

// Modificación: solo lo que cambió ("Importe $: $ 10.000,00 → $ 12.000,00"). Alta, cierre o importación: lo que quedó.
// Anulación: lo que había (o "Anulado" si solo cambió el estado).
function cambios(accion: Accion, antes: Record<string, unknown> | null, despues: Record<string, unknown> | null, n: Nombres) {
  if (accion === 'modificacion' && antes && despues) {
    return Object.keys(despues).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .map((k) => `${etiqueta(k)}: ${valor(k, antes[k], n)} → ${valor(k, despues[k], n)}`).join(' · ') || 'Sin cambios';
  }
  const fila = accion === 'anulacion' ? antes : despues ?? antes;
  if (!fila || (accion === 'anulacion' && Object.keys(fila).join() === 'estado')) return accion === 'anulacion' ? 'Anulado' : '';
  return Object.entries(fila).filter(([, v]) => v !== null && v !== '')
    // El pago de una liquidación guarda 'importe' y su moneda (antes de v0.31.0, sin moneda: se muestra en pesos).
    .map(([k, v]) => `${etiqueta(k)}: ${k === 'importe' && typeof v === 'number' ? plata(v, fila.moneda === 'USD') : valor(k, v, n)}`).join(' · ');
}

export interface FilaAuditoria { id: number; fecha: string; pc: string; tipo: string; referencia: string | null; accion: string; cambios: string }

export function listarAuditoria(db: DatabaseSync, mes: string): FilaAuditoria[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error(`Mes inválido: "${mes}" (se espera AAAA-MM).`);
  const mapa = (sql: string) => new Map((db.prepare(sql).all() as { id: number; n: string }[]).map((f) => [f.id, f.n]));
  const n: Nombres = {
    depto_id: mapa('SELECT id, codigo AS n FROM depto'), concepto_id: mapa('SELECT id, nombre AS n FROM concepto'),
    cuenta_id: mapa('SELECT id, nombre AS n FROM cuenta'), periodo_id: mapa('SELECT id, mes AS n FROM periodo'),
  };
  // A qué se refiere cada renglón, con los datos de hoy (el depto y concepto del movimiento, el código de la reserva…).
  const filas = db.prepare(`
    SELECT a.id, a.fecha, a.pc, a.tabla, a.accion, a.antes_json, a.despues_json, CASE a.tabla
      WHEN 'movimiento' THEN (SELECT COALESCE(d.codigo || ' · ', '') || COALESCE(c.nombre, m.tipo) FROM movimiento m
        LEFT JOIN depto d ON d.id = m.depto_id LEFT JOIN concepto c ON c.id = m.concepto_id WHERE m.id = a.registro_id)
      WHEN 'reserva' THEN (SELECT d.codigo || ' · ' || r.codigo FROM reserva r JOIN depto d ON d.id = r.depto_id WHERE r.id = a.registro_id)
      WHEN 'periodo' THEN (SELECT mes FROM periodo WHERE id = a.registro_id)
      WHEN 'depto' THEN (SELECT codigo FROM depto WHERE id = a.registro_id)
      WHEN 'cuenta' THEN (SELECT nombre FROM cuenta WHERE id = a.registro_id)
      WHEN 'propietario' THEN (SELECT nombre FROM propietario WHERE id = a.registro_id)
      WHEN 'emisor' THEN (SELECT nombre FROM emisor WHERE id = a.registro_id)
    END AS referencia
    FROM auditoria a WHERE a.fecha >= ? AND a.fecha < date(?, '+1 month') ORDER BY a.id DESC`)
    .all(`${mes}-01`, `${mes}-01`) as { id: number; fecha: string; pc: string; tabla: string; accion: Accion; antes_json: string | null; despues_json: string | null; referencia: string | null }[];
  return filas.map((f) => ({
    id: f.id, fecha: f.fecha, pc: f.pc, tipo: TIPOS[f.tabla] ?? f.tabla, referencia: f.referencia, accion: ACCIONES[f.accion] ?? f.accion,
    cambios: cambios(f.accion, f.antes_json && JSON.parse(f.antes_json), f.despues_json && JSON.parse(f.despues_json), n),
  }));
}
