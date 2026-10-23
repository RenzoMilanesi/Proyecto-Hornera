// Asistente con IA (plan 061): contesta preguntas con Claude, solo lectura.
import type { DatabaseSync } from 'node:sqlite';

// Dónde vive la API key de Anthropic. En Electron, cifrada con safeStorage fuera de la base (no viaja en los backups).
export interface AlmacenClaveIa {
  leer(): string | null;
  guardar(clave: string): void;
}

export const MODELOS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
export const ESFUERZOS = ['low', 'medium', 'high'];

const leerValor = (db: DatabaseSync, clave: string) =>
  (db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave) as { valor: string } | undefined)?.valor;

export function configIa(db: DatabaseSync) {
  return { modelo: leerValor(db, 'ia.modelo') ?? 'claude-sonnet-5-5', esfuerzo: leerValor(db, 'ia.esfuerzo') ?? 'medium' };
}

export function guardarConfigIa(db: DatabaseSync, cuerpo: unknown) {
  const { modelo, esfuerzo } = (cuerpo ?? {}) as Record<string, unknown>;
  if (modelo !== undefined && !MODELOS.includes(modelo as string)) throw new Error('Modelo desconocido');
  if (esfuerzo !== undefined && !ESFUERZOS.includes(esfuerzo as string)) throw new Error('Esfuerzo desconocido');
  const poner = db.prepare('INSERT INTO configuracion(clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
  if (modelo !== undefined) poner.run('ia.modelo', modelo as string);
  if (esfuerzo !== undefined) poner.run('ia.esfuerzo', esfuerzo as string);
  return configIa(db);
}
