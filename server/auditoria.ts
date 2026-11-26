// Registro de cambios financieros (DECISIONES: antes/después, con fecha y PC; sin login).
// El usuario es la PC: Lautaro y Amancay usan una cada uno (la servidor con el nombre de Terminales).
import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { sello } from './sello.ts';

type Accion = 'alta' | 'modificacion' | 'anulacion' | 'cierre' | 'reapertura' | 'importacion';

// Nombre de la terminal que hizo el pedido (lo pone server/terminales.ts); sin terminal, esta PC.
export const pcActual = new AsyncLocalStorage<string>();
// Lo confirmado desde el asistente (plan 068): la auditoría lo marca "con IA".
export const conIa = new AsyncLocalStorage<boolean>();

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
    db.prepare('UPDATE conversacion_ia SET pc = ? WHERE pc = ?').run(n, anterior); // el historial del asistente sigue siendo suyo
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { nombre: n };
}

export function auditar(db: DatabaseSync, tabla: string, id: number | null, accion: Accion, antes: unknown, despues: unknown) {
  db.prepare(`INSERT INTO auditoria(fecha, pc, tabla, registro_id, accion, antes_json, despues_json, con_ia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sello(), pcActual.getStore() ?? nombrePc(db), tabla, id, accion, antes == null ? null : JSON.stringify(antes), despues == null ? null : JSON.stringify(despues),
      conIa.getStore() ? 1 : 0);
}

// ---- Pantalla Herramientas → Auditoría: los cambios de un mes, legibles.

const TIPOS: Record<string, string> = {
  movimiento: 'Movimiento', reserva: 'Reserva', periodo: 'Mes', depto: 'Depto', cuenta: 'Cuenta',
  medio_pago: 'Medio de pago', emisor: 'Emisor', propietario: 'Propietario', comprobante: 'Factura',
  comprobante_arca: 'Comprobante de ARCA', stays: 'Traer mes de Stays', excel: 'Excel mensual', gastos: 'Gastos varios',
  gasto_ajeno: 'Gasto personal', liquidacion: 'Saldado por fuera', terminal: 'Terminal', depto_clave: 'Clave del depto',
  depto_servicio: 'Servicio del depto', depto_contacto: 'Contacto del depto', liquidacion_limpieza: 'Limpieza',
  tarea_limpieza: 'Horas de limpieza', configuracion: 'Configuración',
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
  propietario_id: 'Propietario', codigo: 'Código', descripcion: 'Descripción', periodoCreado: 'Mes nuevo', deptosNuevos: 'Deptos nuevos',
  eliminadas: 'Borradas', medios: 'Medios de pago', comision_cobro_usd_pct: 'Comisión de cobro', moneda_liquidacion: 'Liquida en',
  cbu: 'CBU/CVU', mails: 'Mails', saldado_fuera: 'Saldado el', direccion: 'Dirección', razon_social: 'Razón social', doc_nro: 'Documento', condicion_iva: 'Condición IVA',
  precio_hora: 'Precio por hora', plus_json: 'Plus', 'limpieza.plus': 'Reglas del plus', ajuste_nota: 'Nota del ajuste',
  movimiento_id: 'Pago', porOperaria: 'Por chica', operaria: 'Chica', adjunto_id: 'Comprobante n.º',
};
// En altas e importaciones no se muestra el mes (ya está en el filtro de la pantalla).
const SIN_MOSTRAR = new Set(['mes', 'periodo_id']);
// Datos de contexto que una modificación guarda solo en "después" (saldado por fuera): ya van en la referencia.
const CONTEXTO = new Set(['mes', 'depto', 'moneda']);
const vacio = (v: unknown) => v === null || v === undefined || v === '' || v === 0 || v === false || (Array.isArray(v) && !v.length);

const plata = (c: number, usd: boolean) =>
  `${usd ? 'US$' : '$'} ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PLATA = /importe|ajuste|tarifa|costo|servicio|cargo|adicional|prestamo|gestion|mantenimiento|cm_fee|precio|^total$/;
const etiqueta = (k: string) => CAMPOS[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)).replaceAll('_', ' ');

type Nombres = Record<string, Map<number, string>>;
function valor(k: string, v: unknown, n: Nombres): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.map((x) => valor(k, x, n)).join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([k2, v2]) => `${etiqueta(k2)}: ${valor(k2, v2, n)}`).join(', ');
  if (k.endsWith('_json') && typeof v === 'string') {
    try { return valor(k.slice(0, -5), JSON.parse(v), n); } catch { return v; } // un texto que no es JSON se muestra tal cual
  }
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
    return Object.keys(despues).filter((k) => !(CONTEXTO.has(k) && !(k in antes)) && JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .map((k) => `${etiqueta(k)}: ${valor(k, antes[k], n)} → ${valor(k, despues[k], n)}`).join(' · ') || 'Sin cambios';
  }
  const fila = accion === 'anulacion' ? antes : despues ?? antes;
  if (!fila || (accion === 'anulacion' && Object.keys(fila).join() === 'estado')) return accion === 'anulacion' ? 'Anulado' : '';
  // Alta, cierre e importación: lo que vale algo; los ceros y vacíos no dicen nada.
  return Object.entries(fila).filter(([k, v]) => !vacio(v) && !SIN_MOSTRAR.has(k))
    // El pago de una liquidación guarda 'importe' y su moneda (antes de v0.31.0, sin moneda: se muestra en pesos).
    .map(([k, v]) => `${etiqueta(k)}: ${k === 'importe' && typeof v === 'number' ? plata(v, fila.moneda === 'USD') : valor(k, v, n)}`).join(' · ');
}

// A qué se refiere cada renglón, con los datos de hoy (el depto y concepto del movimiento, el código de la reserva…).
const REFERENCIA = `CASE a.tabla
      WHEN 'movimiento' THEN (SELECT COALESCE(d.codigo || ' · ', '') || COALESCE(c.nombre, m.tipo) FROM movimiento m
        LEFT JOIN depto d ON d.id = m.depto_id LEFT JOIN concepto c ON c.id = m.concepto_id WHERE m.id = a.registro_id)
      WHEN 'reserva' THEN (SELECT d.codigo || ' · ' || r.codigo FROM reserva r JOIN depto d ON d.id = r.depto_id WHERE r.id = a.registro_id)
      WHEN 'gasto_ajeno' THEN (SELECT codigo || COALESCE(' · ' || descripcion, '') FROM gasto_ajeno WHERE id = a.registro_id)
      WHEN 'periodo' THEN (SELECT mes FROM periodo WHERE id = a.registro_id)
      WHEN 'depto' THEN (SELECT codigo FROM depto WHERE id = a.registro_id)
      WHEN 'cuenta' THEN (SELECT nombre FROM cuenta WHERE id = a.registro_id)
      WHEN 'propietario' THEN (SELECT nombre FROM propietario WHERE id = a.registro_id)
      WHEN 'emisor' THEN (SELECT nombre FROM emisor WHERE id = a.registro_id)
      WHEN 'liquidacion' THEN (SELECT d.codigo || ' · ' || p.mes FROM liquidacion l JOIN depto d ON d.id = l.depto_id
        JOIN periodo p ON p.id = l.periodo_id WHERE l.id = a.registro_id)
      WHEN 'depto_clave' THEN (SELECT d.codigo || ' · ' || k.nombre FROM depto_clave k JOIN depto d ON d.id = k.depto_id WHERE k.id = a.registro_id)
      WHEN 'comprobante' THEN (SELECT d.codigo FROM comprobante c JOIN depto d ON d.id = c.depto_id WHERE c.id = a.registro_id)
      WHEN 'terminal' THEN (SELECT nombre FROM terminal WHERE id = a.registro_id)
      WHEN 'liquidacion_limpieza' THEN (SELECT strftime('%d/%m', desde) || '–' || strftime('%d/%m/%Y', hasta) FROM liquidacion_limpieza WHERE id = a.registro_id)
    END AS referencia`;

export interface FilaAuditoria { id: number; fecha: string; pc: string; conIa: boolean; tipo: string; referencia: string | null; accion: string; cambios: string }

export function listarAuditoria(db: DatabaseSync, mes: string): FilaAuditoria[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error(`Mes inválido: "${mes}" (se espera AAAA-MM).`);
  const mapa = (sql: string) => new Map((db.prepare(sql).all() as { id: number; n: string }[]).map((f) => [f.id, f.n]));
  const n: Nombres = {
    depto_id: mapa('SELECT id, codigo AS n FROM depto'), concepto_id: mapa('SELECT id, nombre AS n FROM concepto'),
    cuenta_id: mapa('SELECT id, nombre AS n FROM cuenta'), periodo_id: mapa('SELECT id, mes AS n FROM periodo'),
    propietario_id: mapa('SELECT id, nombre AS n FROM propietario'),
  };
  const filas = db.prepare(`
    SELECT a.id, a.fecha, a.pc, a.con_ia, a.tabla, a.accion, a.antes_json, a.despues_json, ${REFERENCIA}
    FROM auditoria a WHERE a.fecha >= ? AND a.fecha < date(?, '+1 month') ORDER BY a.id DESC`)
    .all(`${mes}-01`, `${mes}-01`) as { id: number; fecha: string; pc: string; con_ia: number; tabla: string; accion: Accion; antes_json: string | null; despues_json: string | null; referencia: string | null }[];
  return filas.map((f) => ({
    id: f.id, fecha: f.fecha, pc: f.pc, conIa: f.con_ia === 1, tipo: TIPOS[f.tabla] ?? f.tabla, referencia: f.referencia, accion: ACCIONES[f.accion] ?? f.accion,
    cambios: cambios(f.accion, f.antes_json && JSON.parse(f.antes_json), f.despues_json && JSON.parse(f.despues_json), n),
  }));
}

// Campanita (avisos.ts): lo importante que hicieron otras PCs desde `desde` (sello). Altas y ediciones comunes, no.
export function cambiosDeOtrasPcs(db: DatabaseSync, pc: string, desde: string) {
  return (db.prepare(`
    SELECT a.id, a.fecha, a.pc, a.tabla, a.accion, ${REFERENCIA}
    FROM auditoria a WHERE a.pc <> ? AND datetime(a.fecha) >= datetime(?)
      AND (a.accion IN ('cierre', 'reapertura', 'importacion', 'anulacion') OR (a.tabla = 'comprobante' AND a.accion = 'alta'))
    ORDER BY a.id DESC LIMIT 20`).all(pc, desde) as { id: number; fecha: string; pc: string; tabla: string; accion: Accion; referencia: string | null }[])
    .map((f) => ({ id: f.id, fecha: f.fecha, pc: f.pc, texto: [ACCIONES[f.accion], TIPOS[f.tabla] ?? f.tabla, f.referencia].filter(Boolean).join(' · ') }));
}
