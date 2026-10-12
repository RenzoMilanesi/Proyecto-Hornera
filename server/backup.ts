// Copia de seguridad como Roble: una copia por cierre, se conservan las últimas 15.
import type { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_BACKUPS = 15;

export function hacerBackup(db: DatabaseSync, carpeta: string, ahora = new Date()): string {
  mkdirSync(carpeta, { recursive: true });
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000); // hora de la PC, no UTC
  const sello = local.toISOString().slice(0, 23).replace(/[:.]/g, '-'); // con ms: VACUUM INTO falla si el archivo existe
  const destino = join(carpeta, `hornera-${sello}.db`);
  db.prepare('VACUUM INTO ?').run(destino); // copia consistente aunque haya WAL
  const viejos = readdirSync(carpeta).filter((f) => /^hornera-.*\.db$/.test(f)).sort().slice(0, -MAX_BACKUPS);
  for (const f of viejos) rmSync(join(carpeta, f));
  return destino;
}

// Copia en la carpeta configurable (Drive/OneDrive, `configuracion.backup.carpeta`).
// Si esa falla (Drive desmontado), la copia queda en la por defecto y se avisa con
// un error que dice dónde quedó: mejor una copia local que ninguna.
export function respaldar(db: DatabaseSync, porDefecto: string): string {
  const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'backup.carpeta'`).get() as { valor: string } | undefined;
  const carpeta = fila?.valor || porDefecto;
  try {
    return hacerBackup(db, carpeta);
  } catch (e) {
    if (carpeta === porDefecto) throw e;
    const destino = hacerBackup(db, porDefecto);
    throw new Error(`No se pudo copiar a ${carpeta} (${e instanceof Error ? e.message : e}). La copia quedó en ${destino}.`);
  }
}
