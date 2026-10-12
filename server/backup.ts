// Copia de seguridad: al cerrar y cada 6 h con la app abierta. Se conservan las últimas 60
// (unas 2 semanas aunque la app quede abierta día y noche).
import type { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_BACKUPS = 60;

export function hacerBackup(db: DatabaseSync, carpeta: string, ahora = new Date()): string {
  mkdirSync(carpeta, { recursive: true });
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000); // hora de la PC, no UTC
  const sello = local.toISOString().slice(0, 23).replace(/[:.]/g, '-'); // con ms: VACUUM INTO falla si el archivo existe
  const destino = join(carpeta, `hornera-${sello}.db`);
  db.prepare('VACUUM INTO ?').run(destino); // copia consistente aunque haya WAL
  const viejos = readdirSync(carpeta).filter((f) => /^hornera-.*\.db$/.test(f)).sort().slice(0, -MAX_BACKUPS);
  // Si no se puede borrar una copia vieja (Drive la tiene bloqueada), la nueva igual quedó hecha.
  for (const f of viejos) {
    try {
      rmSync(join(carpeta, f));
    } catch (e) {
      console.error(`No se pudo borrar el backup viejo ${f}:`, e instanceof Error ? e.message : e);
    }
  }
  return destino;
}

// Copia en la carpeta configurable (Drive/OneDrive, `configuracion.backup.carpeta`).
// Si esa falla (Drive desmontado), la copia queda en la por defecto y se avisa con
// un error que dice dónde quedó: mejor una copia local que ninguna.
export function respaldar(db: DatabaseSync, porDefecto: string): string {
  const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'backup.carpeta'`).get() as { valor: string } | undefined;
  const carpeta = fila?.valor || porDefecto;
  try {
    // Una carpeta de otra PC de la red (ruta UNC, \\servidor\carpeta) haría que Windows se conecte a ella.
    if (carpeta.startsWith('\\\\') || carpeta.startsWith('//')) throw new Error('no se usan carpetas de otras PCs de la red');
    return hacerBackup(db, carpeta);
  } catch (e) {
    if (carpeta === porDefecto) throw e;
    const destino = hacerBackup(db, porDefecto);
    throw new Error(`No se pudo copiar a ${carpeta} (${e instanceof Error ? e.message : e}). La copia quedó en ${destino}.`);
  }
}
