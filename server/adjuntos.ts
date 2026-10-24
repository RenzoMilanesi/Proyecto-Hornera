// Comprobantes (foto o PDF) de los movimientos (plan 068). Viven en la base: viajan en el backup y las terminales
// los ven por la API. Uno sin movimiento es uno subido al asistente que todavía no se confirmó.
import type { DatabaseSync } from 'node:sqlite';
import { sello } from './sello.ts';

export const MAX_ADJUNTO = 6 * 1024 * 1024; // las fotos llegan achicadas por el navegador; esto es para los PDF

// El tipo sale de los primeros bytes, no del nombre del archivo.
function tipoDe(b: Buffer) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export function guardarAdjunto(db: DatabaseSync, nombre: unknown, datos: Buffer): number {
  if (!datos.length) throw new Error('Falta el archivo.');
  if (datos.length > MAX_ADJUNTO) throw new Error('El archivo pesa más de 6 MB.');
  const tipo = tipoDe(datos);
  if (!tipo) throw new Error('Solo se pueden adjuntar fotos (JPG, PNG o WEBP) o PDF.');
  const n = (typeof nombre === 'string' && nombre.trim().slice(0, 120)) || 'comprobante';
  return Number(db.prepare('INSERT INTO adjunto(nombre, tipo, datos, bytes, creado_en) VALUES (?, ?, ?, ?, ?)')
    .run(n, tipo, datos, datos.length, sello()).lastInsertRowid);
}

export function leerAdjunto(db: DatabaseSync, id: number) {
  const a = db.prepare('SELECT nombre, tipo, datos FROM adjunto WHERE id = ?').get(id) as { nombre: string; tipo: string; datos: Uint8Array } | undefined;
  if (!a) throw new Error('No existe el comprobante.');
  return a;
}

export const adjuntoDe = (db: DatabaseSync, movimientoId: number) =>
  (db.prepare('SELECT id FROM adjunto WHERE movimiento_id = ?').get(movimientoId) as { id: number } | undefined)?.id ?? null;

// Un comprobante por movimiento: el nuevo reemplaza al anterior (que queda suelto y se borra con los viejos); null lo quita.
export function vincularAdjunto(db: DatabaseSync, movimientoId: number, adjuntoId: number | null) {
  if (adjuntoId != null) {
    const a = db.prepare('SELECT movimiento_id FROM adjunto WHERE id = ?').get(adjuntoId) as { movimiento_id: number | null } | undefined;
    if (!a) throw new Error('No existe el comprobante.');
    if (a.movimiento_id != null && a.movimiento_id !== movimientoId) throw new Error('Ese comprobante ya es de otro movimiento.');
  }
  db.prepare('UPDATE adjunto SET movimiento_id = NULL WHERE movimiento_id = ? AND id IS NOT ?').run(movimientoId, adjuntoId);
  if (adjuntoId != null) db.prepare('UPDATE adjunto SET movimiento_id = ? WHERE id = ?').run(movimientoId, adjuntoId);
}

// Los sueltos de más de 30 días: subidos al asistente y nunca confirmados, o reemplazados.
export function purgarAdjuntos(db: DatabaseSync, ahora = new Date()) {
  return Number(db.prepare('DELETE FROM adjunto WHERE movimiento_id IS NULL AND creado_en < ?')
    .run(sello(new Date(ahora.getTime() - 30 * 864e5))).changes);
}
