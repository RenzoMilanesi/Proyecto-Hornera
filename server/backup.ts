// Copia de seguridad: al cerrar y cada 6 h con la app abierta. Se conservan las últimas 60
// (unas 2 semanas aunque la app quede abierta día y noche).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Express } from 'express';
import { soloLocal } from './terminales.ts';

export const MAX_BACKUPS = 60;

export function hacerBackup(db: DatabaseSync, carpeta: string, ahora = new Date()): string {
  mkdirSync(carpeta, { recursive: true });
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000); // hora de la PC, no UTC
  const sello = local.toISOString().slice(0, 23).replace(/[:.]/g, '-'); // con ms: VACUUM INTO falla si el archivo existe
  const destino = join(carpeta, `hornera-${sello}.db`);
  db.prepare('VACUUM INTO ?').run(destino); // copia consistente aunque haya WAL
  // El ticket de acceso de ARCA (token + sign, 12 h) factura en nombre del emisor: no viaja a Drive.
  // VACUUM para que el borrado no quede en páginas libres del archivo.
  if (db.prepare(`SELECT 1 FROM configuracion WHERE clave LIKE 'arca.ta.%'`).get()) {
    const copia = new DatabaseSync(destino);
    try {
      copia.exec(`DELETE FROM configuracion WHERE clave LIKE 'arca.ta.%'; VACUUM;`);
    } finally {
      copia.close();
    }
  }
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
  const { carpeta } = carpetaBackups(db, porDefecto);
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

// Carpeta en uso: la configurada en "Copias de seguridad" o la por defecto (%APPDATA%\hornera\backups).
export function carpetaBackups(db: DatabaseSync, porDefecto: string) {
  const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'backup.carpeta'`).get() as { valor: string } | undefined;
  return { carpeta: fila?.valor || porDefecto, porDefecto, configurada: !!fila?.valor };
}

// Las últimas copias de una carpeta, la más nueva primero. Carpeta inexistente o ilegible: ninguna.
export function ultimasCopias(carpeta: string, n = 5) {
  try {
    return readdirSync(carpeta).filter((f) => /^hornera-.*\.db$/.test(f)).sort().reverse().slice(0, n).map((archivo) => {
      const s = statSync(join(carpeta, archivo));
      return { archivo, fecha: s.mtime.toISOString(), bytes: s.size };
    });
  } catch {
    return [];
  }
}

// Vacía: vuelve a la por defecto. Si no, se guarda solo después de una copia de prueba que anduvo:
// nunca queda configurada una carpeta donde no se puede copiar.
export function elegirCarpeta(db: DatabaseSync, carpeta: unknown) {
  const ruta = typeof carpeta === 'string' ? carpeta.trim() : '';
  if (!ruta) {
    db.prepare(`DELETE FROM configuracion WHERE clave = 'backup.carpeta'`).run();
    return { carpeta: null };
  }
  if (ruta.startsWith('\\\\') || ruta.startsWith('//')) {
    throw new Error('No se usan carpetas de otras PCs de la red: elegí una carpeta de esta PC (por ejemplo la de Google Drive u OneDrive).');
  }
  if (!isAbsolute(ruta)) throw new Error('Escribí la ruta completa de la carpeta, por ejemplo C:\\Users\\…\\Google Drive\\Hornera.');
  let copia: string;
  try {
    copia = hacerBackup(db, ruta);
  } catch (e) {
    throw new Error(`No se pudo hacer una copia en ${ruta}: ${e instanceof Error ? e.message : e}`);
  }
  db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('backup.carpeta', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(ruta);
  return { carpeta: ruta, copia };
}

// Pantalla Herramientas → Copias de seguridad: solo en la PC servidor, que es la que hace las copias.
export function rutasBackup(app: Express, db: DatabaseSync, porDefecto: string) {
  const error = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });
  app.get('/api/backup', soloLocal, (_req, res) => {
    const c = carpetaBackups(db, porDefecto);
    res.json({ ...c, copias: ultimasCopias(c.carpeta) });
  });
  app.put('/api/backup/carpeta', soloLocal, (req, res) => {
    try {
      res.json(elegirCarpeta(db, req.body?.carpeta));
    } catch (e) {
      res.status(400).json(error(e));
    }
  });
  // Si la carpeta configurada falla, respaldar deja la copia en la por defecto y el error dice dónde.
  app.post('/api/backup', soloLocal, (_req, res) => {
    try {
      res.json({ copia: respaldar(db, porDefecto) });
    } catch (e) {
      res.status(500).json(error(e));
    }
  });
}
