// Lo emitido en ARCA por cualquier medio (plan 036): el CSV de Mis Comprobantes → Emitidos, importado a mano.
// Incluye lo facturado por Comprobantes en Línea, que Hornera no ve: sirve para avisar antes de facturar dos
// veces la misma liquidación y para vincular a un pago la factura que se hizo por fuera.
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { sello } from './sello.ts';
import { dniDeCuit } from './fiscal.ts';

// Facturas (no NC ni ND): A, B, C, M y las de crédito MiPyME.
const FACTURAS = [1, 6, 11, 51, 201, 206, 211];
const COLUMNAS = {
  fecha: 'Fecha de Emisión', tipo: 'Tipo de Comprobante', pv: 'Punto de Venta', desde: 'Número Desde', hasta: 'Número Hasta',
  cae: 'Cód. Autorización', docTipo: 'Tipo Doc. Receptor', docNro: 'Nro. Doc. Receptor', receptor: 'Denominación Receptor', total: 'Imp. Total',
};

// "122.278,10" → 12227810 centavos.
const centavos = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);

/** Filas del CSV (`;`, comillas, decimales con coma). Tira si no son los encabezados de Mis Comprobantes. */
export function leerCsv(texto: string) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  // ponytail: split simple por `;`; ARCA no pone `;` dentro de los campos (la razón social viene sin comillas internas).
  const campos = (l: string) => l.split(';').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  const encabezado = campos(lineas[0] ?? '');
  const col = Object.fromEntries(Object.entries(COLUMNAS).map(([k, nombre]) => [k, encabezado.indexOf(nombre)])) as Record<keyof typeof COLUMNAS, number>;
  const falta = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => COLUMNAS[k as keyof typeof COLUMNAS]);
  if (falta.length) throw new Error(`No es el CSV de Mis Comprobantes de ARCA: faltan las columnas ${falta.join(', ')}.`);
  return lineas.slice(1).map((l, i) => {
    const c = campos(l);
    const fila = {
      fecha: c[col.fecha], cbte_tipo: Number(c[col.tipo]), punto_venta: Number(c[col.pv]), numero: Number(c[col.desde]),
      numero_hasta: Number(c[col.hasta] || c[col.desde]), cae: c[col.cae] || null, doc_tipo: c[col.docTipo] ? Number(c[col.docTipo]) : null,
      doc_nro: c[col.docNro] || null, receptor: c[col.receptor] || null, importe: centavos(c[col.total] ?? ''),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fila.fecha ?? '') || ![fila.cbte_tipo, fila.punto_venta, fila.numero, fila.numero_hasta, fila.importe].every(Number.isSafeInteger)) {
      throw new Error(`La fila ${i + 2} del CSV no se entiende: revisá que sea el export de Mis Comprobantes sin editar.`);
    }
    return fila;
  });
}

/**
 * Importa el CSV de un emisor. Reimportar actualiza y conserva el vínculo con el pago. El nombre del archivo
 * de ARCA trae el CUIT: si es de otro, se rechaza.
 */
export function importarMisComprobantes(db: DatabaseSync, emisorId: number, nombre: string, texto: string) {
  const e = db.prepare('SELECT nombre, cuit FROM emisor WHERE id = ?').get(emisorId) as { nombre: string; cuit: string } | undefined;
  if (!e) throw new Error('No existe el emisor.');
  if (/recibidos/i.test(nombre)) throw new Error('Ese archivo es de comprobantes recibidos: hace falta el de Emitidos.');
  const cuit = nombre.match(/_(\d{11})_/)?.[1];
  if (cuit && cuit !== e.cuit) throw new Error(`El archivo es del CUIT ${cuit}, no del de ${e.nombre} (${e.cuit}).`);
  const filas = leerCsv(texto);
  const ahora = sello();
  const existe = db.prepare('SELECT 1 FROM comprobante_arca WHERE emisor_id = ? AND cbte_tipo = ? AND punto_venta = ? AND numero = ?');
  const guardar = db.prepare(`INSERT INTO comprobante_arca(emisor_id, fecha, cbte_tipo, punto_venta, numero, numero_hasta, cae, doc_tipo, doc_nro,
      receptor, importe, importado_en) VALUES (:emisor_id, :fecha, :cbte_tipo, :punto_venta, :numero, :numero_hasta, :cae, :doc_tipo, :doc_nro,
      :receptor, :importe, :importado_en)
    ON CONFLICT (emisor_id, cbte_tipo, punto_venta, numero) DO UPDATE SET fecha = excluded.fecha, numero_hasta = excluded.numero_hasta,
      cae = excluded.cae, doc_tipo = excluded.doc_tipo, doc_nro = excluded.doc_nro, receptor = excluded.receptor, importe = excluded.importe,
      importado_en = excluded.importado_en`);
  let nuevos = 0;
  db.exec('BEGIN');
  try {
    for (const f of filas) {
      if (!existe.get(emisorId, f.cbte_tipo, f.punto_venta, f.numero)) nuevos++;
      guardar.run({ ...f, emisor_id: emisorId, importado_en: ahora });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { leidos: filas.length, nuevos };
}

// Un documento comparable: el DNI dentro de un CUIT de persona física cuenta como ese DNI.
const clave = (nro: string | null) => {
  const s = (nro ?? '').replace(/\D/g, '');
  return s ? dniDeCuit(s) ?? s.replace(/^0+/, '') : null;
};

// Documentos de cada propietario: los fiscales, el CUIT y los números del "documento" del Excel.
function propietariosPorDoc(db: DatabaseSync) {
  const mapa = new Map<string, { id: number; nombre: string }>();
  const ps = db.prepare('SELECT id, nombre, fiscal_doc_nro, cuit, documento FROM propietario').all() as
    { id: number; nombre: string; fiscal_doc_nro: string | null; cuit: string | null; documento: string | null }[];
  for (const p of ps) {
    for (const nro of [p.fiscal_doc_nro, p.cuit, ...(p.documento?.match(/\d[\d.\-]{6,}\d/g) ?? [])]) {
      const k = clave(nro);
      if (k) mapa.set(k, { id: p.id, nombre: p.nombre });
    }
  }
  return mapa;
}

// Emitida desde Hornera: el mismo comprobante aprobado en producción (alias `ca`).
export const SQL_DE_HORNERA = `EXISTS (SELECT 1 FROM comprobante c WHERE c.emisor_id = ca.emisor_id AND c.cbte_tipo = ca.cbte_tipo
  AND c.punto_venta = ca.punto_venta AND c.numero = ca.numero AND c.estado = 'aprobado' AND c.ambiente = 'produccion')`;

const ultimoDiaDelMesSiguiente = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) + 1, 0)).toISOString().slice(0, 10);

/**
 * Facturas hechas por fuera de Hornera a este propietario que pueden ser de la liquidación de `mes`: sin vincular,
 * con fecha entre el 1.º de ese mes y el fin del siguiente (la liquidación se paga el mes siguiente).
 */
export function facturasExternas(db: DatabaseSync, propietarioId: number, mes: string) {
  const docs = propietariosPorDoc(db);
  const filas = db.prepare(`SELECT ca.id, ca.fecha, ca.cbte_tipo, ca.punto_venta, ca.numero, ca.importe, ca.doc_nro, ca.receptor, e.nombre AS emisor
      FROM comprobante_arca ca JOIN emisor e ON e.id = ca.emisor_id
      WHERE ca.movimiento_id IS NULL AND ca.cbte_tipo IN (${FACTURAS.join(',')}) AND ca.fecha BETWEEN ? AND ? AND NOT ${SQL_DE_HORNERA}
      ORDER BY ca.fecha, ca.id`).all(`${mes}-01`, ultimoDiaDelMesSiguiente(mes)) as
    { id: number; fecha: string; cbte_tipo: number; punto_venta: number; numero: number; importe: number; doc_nro: string | null; receptor: string | null; emisor: string }[];
  return filas.filter((f) => docs.get(clave(f.doc_nro) ?? '')?.id === propietarioId).map(({ doc_nro: _d, ...f }) => f);
}
export type FacturaExterna = ReturnType<typeof facturasExternas>[number];

/** La factura externa vinculada a un pago, o null. */
export const externaDePago = (db: DatabaseSync, movimientoId: number) =>
  (db.prepare(`SELECT ca.id, ca.cbte_tipo, ca.punto_venta, ca.numero, ca.importe, e.nombre AS emisor FROM comprobante_arca ca
      JOIN emisor e ON e.id = ca.emisor_id WHERE ca.movimiento_id = ?`).get(movimientoId) as
    { id: number; cbte_tipo: number; punto_venta: number; numero: number; importe: number; emisor: string } | undefined) ?? null;

/** "Es esta": la factura hecha por fuera queda como la factura del pago. */
export function vincular(db: DatabaseSync, id: number, cuerpo: unknown) {
  const movimientoId = Number((cuerpo as { movimiento_id?: unknown } | null)?.movimiento_id);
  const ca = db.prepare(`SELECT ca.*, ${SQL_DE_HORNERA} AS de_hornera FROM comprobante_arca ca WHERE ca.id = ?`).get(id) as
    { cbte_tipo: number; movimiento_id: number | null; de_hornera: number } | undefined;
  if (!ca) throw new Error('No existe ese comprobante de ARCA.');
  if (!FACTURAS.includes(ca.cbte_tipo)) throw new Error('Solo una factura se vincula a un pago.');
  if (ca.de_hornera) throw new Error('Ese comprobante se emitió desde Hornera: ya está con su pago.');
  if (ca.movimiento_id) throw new Error('Esa factura ya está vinculada a otro pago.');
  const m = db.prepare(`SELECT estado FROM movimiento WHERE id = ? AND tipo = 'liquidacion'`).get(movimientoId) as { estado: string } | undefined;
  if (!m) throw new Error('No existe ese pago de liquidación.');
  if (m.estado !== 'vigente') throw new Error('El pago está anulado.');
  if (externaDePago(db, movimientoId)) throw new Error('Ese pago ya tiene una factura hecha por fuera.');
  if (db.prepare(`SELECT 1 FROM comprobante c WHERE c.movimiento_id = ? AND c.ambiente = 'produccion' AND c.estado = 'aprobado'
      AND c.asociado_id IS NULL AND NOT EXISTS (SELECT 1 FROM comprobante nc WHERE nc.asociado_id = c.id AND nc.estado = 'aprobado')`).get(movimientoId)) {
    throw new Error('Ese pago ya tiene una factura emitida desde Hornera.');
  }
  db.prepare('UPDATE comprobante_arca SET movimiento_id = ? WHERE id = ?').run(movimientoId, id);
  auditar(db, 'comprobante_arca', id, 'modificacion', { movimiento_id: null }, { movimiento_id: movimientoId });
}

export function desvincular(db: DatabaseSync, id: number) {
  const ca = db.prepare('SELECT movimiento_id FROM comprobante_arca WHERE id = ?').get(id) as { movimiento_id: number | null } | undefined;
  if (!ca?.movimiento_id) throw new Error('Ese comprobante no está vinculado a un pago.');
  db.prepare('UPDATE comprobante_arca SET movimiento_id = NULL WHERE id = ?').run(id);
  auditar(db, 'comprobante_arca', id, 'modificacion', { movimiento_id: ca.movimiento_id }, { movimiento_id: null });
}

/** Lo importado con fecha en `mes`, con su relación con Hornera. */
export function listarMisComprobantes(db: DatabaseSync, mes: string) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido (AAAA-MM).');
  const docs = propietariosPorDoc(db);
  const filas = db.prepare(`SELECT ca.id, ca.fecha, ca.cbte_tipo, ca.punto_venta, ca.numero, ca.numero_hasta, ca.cae, ca.doc_tipo, ca.doc_nro,
      ca.receptor, ca.importe, ca.emisor_id, e.nombre AS emisor, ${SQL_DE_HORNERA} AS de_hornera, ca.movimiento_id,
      d.codigo AS pago_depto, p.mes AS pago_mes, m.estado = 'anulado' AS pago_anulado
    FROM comprobante_arca ca JOIN emisor e ON e.id = ca.emisor_id
    LEFT JOIN movimiento m ON m.id = ca.movimiento_id LEFT JOIN depto d ON d.id = m.depto_id LEFT JOIN periodo p ON p.id = m.periodo_id
    WHERE ca.fecha LIKE ? ORDER BY ca.fecha, ca.punto_venta, ca.numero`).all(`${mes}-%`) as any[];
  const importados = db.prepare(`SELECT e.id AS emisor_id, e.nombre AS emisor, MAX(ca.importado_en) AS ultima, MAX(ca.fecha) AS hasta
      FROM comprobante_arca ca JOIN emisor e ON e.id = ca.emisor_id GROUP BY e.id ORDER BY e.nombre`).all() as
    { emisor_id: number; emisor: string; ultima: string; hasta: string }[];
  return {
    importados,
    filas: filas.map((f) => {
      const propietario = docs.get(clave(f.doc_nro) ?? '') ?? null;
      // sin_vincular: factura a un propietario que Hornera no conoce; propietario: NC o ND a un propietario; ajena: a otro.
      const estado = f.de_hornera ? 'hornera' : f.movimiento_id ? 'vinculada' : !propietario ? 'ajena' : FACTURAS.includes(f.cbte_tipo) ? 'sin_vincular' : 'propietario';
      return {
        id: f.id as number, fecha: f.fecha as string, cbte_tipo: f.cbte_tipo as number, punto_venta: f.punto_venta as number, numero: f.numero as number,
        numero_hasta: f.numero_hasta as number, cae: f.cae as string | null, doc_tipo: f.doc_tipo as number | null, doc_nro: f.doc_nro as string | null,
        receptor: f.receptor as string | null, importe: f.importe as number, emisor_id: f.emisor_id as number, emisor: f.emisor as string,
        propietario: propietario?.nombre ?? null, estado: estado as 'hornera' | 'vinculada' | 'sin_vincular' | 'propietario' | 'ajena',
        pago: f.movimiento_id ? { depto: f.pago_depto as string, mes: f.pago_mes as string, anulado: !!f.pago_anulado } : null,
      };
    }),
  };
}
export type FilaMisComprobantes = ReturnType<typeof listarMisComprobantes>['filas'][number];
