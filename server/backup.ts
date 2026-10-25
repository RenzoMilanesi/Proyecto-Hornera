// Copia de seguridad: al salir (Salir de la bandeja o apagar Windows) y cada 6 h con la app abierta. Se conservan las últimas 60
// (unas 2 semanas aunque la app quede abierta día y noche).
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Express, Response } from 'express';
import { soloLocal } from './terminales.ts';
import { abrirDb } from './db.ts';

export const MAX_BACKUPS = 60;

// Copia consistente aunque haya WAL. `destino` no tiene que existir (VACUUM INTO falla si existe).
function copiarBase(db: DatabaseSync, destino: string) {
  db.prepare('VACUUM INTO ?').run(destino);
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
}

// ---- Restaurar y borrar todo (como en Roble). La base en uso no se toca con la app abierta:
// se deja lista al lado (`hornera.db.restaurar`), ya migrada y probada, y al reiniciar
// `aplicarRestauracion` la pone en lugar de la actual. Antes, siempre una copia de la actual.
const pendiente = (rutaDb: string) => `${rutaDb}.restaurar`;
const descartar = (rutaDb: string) => {
  for (const sufijo of ['', '-wal', '-shm']) rmSync(pendiente(rutaDb) + sufijo, { force: true });
};

export function prepararRestauracion(origen: string, rutaDb: string) {
  const destino = pendiente(rutaDb);
  descartar(rutaDb);
  try {
    // user_version 0 es una base que no es de Hornera (abrirDb le crearía las tablas).
    const prueba = new DatabaseSync(origen, { readOnly: true });
    try {
      const { user_version } = prueba.prepare('PRAGMA user_version').get() as { user_version: number };
      if (!user_version || !prueba.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'liquidacion'`).get()) throw new Error('no es una base de Hornera');
    } finally {
      prueba.close();
    }
    copyFileSync(origen, destino);
    abrirDb(destino).close(); // migra la copia: si una copia vieja no migra, falla acá y no al reiniciar
  } catch (e) {
    descartar(rutaDb);
    throw new Error(`Ese archivo no se puede restaurar: ${e instanceof Error ? e.message : e}`);
  }
}

// Base vacía, pero con la configuración de esta PC (carpeta de copias, PDFs, Stays) y las terminales emparejadas.
export function prepararBaseVacia(db: DatabaseSync, rutaDb: string) {
  descartar(rutaDb);
  const nueva = abrirDb(pendiente(rutaDb));
  try {
    nueva.prepare('ATTACH DATABASE ? AS actual').run(rutaDb);
    nueva.exec(`INSERT INTO configuracion SELECT * FROM actual.configuracion WHERE clave NOT LIKE 'arca.ta.%';
                INSERT INTO terminal SELECT * FROM actual.terminal; DETACH DATABASE actual;`);
  } catch (e) {
    nueva.close();
    descartar(rutaDb); // a medias no puede quedar: se aplicaría al reiniciar
    throw e;
  }
  nueva.close();
}

// Al arrancar, antes de abrir la base.
export function aplicarRestauracion(rutaDb: string) {
  if (!existsSync(pendiente(rutaDb))) return;
  rmSync(`${rutaDb}-wal`, { force: true });
  rmSync(`${rutaDb}-shm`, { force: true });
  renameSync(pendiente(rutaDb), rutaDb);
}

// Lo que solo puede hacer Electron (diálogos de Windows y reiniciar la app).
export interface Sistema {
  rutaDb: string;
  elegirArchivo(carpeta: string): Promise<string | undefined>;
  guardarComo(nombre: string): Promise<string | undefined>;
  reiniciar(): void;
}

// `prefijo` distinto de 'hornera': la copia no entra en la rotación (ni en la lista de últimas copias).
export function hacerBackup(db: DatabaseSync, carpeta: string, ahora = new Date(), prefijo = 'hornera'): string {
  mkdirSync(carpeta, { recursive: true });
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000); // hora de la PC, no UTC
  const sello = local.toISOString().slice(0, 23).replace(/[:.]/g, '-'); // con ms: VACUUM INTO falla si el archivo existe
  const destino = join(carpeta, `${prefijo}-${sello}.db`);
  copiarBase(db, destino);
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
// La falla queda en `backup.error` (fecha y mensaje) para la campanita (avisos.ts); la próxima que anda la borra.
export function respaldar(db: DatabaseSync, porDefecto: string, prefijo?: string): string {
  try {
    const destino = copiarDondeSe(db, porDefecto, prefijo);
    db.prepare(`DELETE FROM configuracion WHERE clave = 'backup.error'`).run();
    return destino;
  } catch (e) {
    db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('backup.error', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`)
      .run(JSON.stringify({ fecha: new Date().toLocaleDateString('sv'), mensaje: e instanceof Error ? e.message : String(e) }));
    throw e;
  }
}

function copiarDondeSe(db: DatabaseSync, porDefecto: string, prefijo?: string): string {
  const { carpeta } = carpetaBackups(db, porDefecto);
  try {
    // Una carpeta de otra PC de la red (ruta UNC, \\servidor\carpeta) haría que Windows se conecte a ella.
    if (carpeta.startsWith('\\\\') || carpeta.startsWith('//')) throw new Error('no se usan carpetas de otras PCs de la red');
    return hacerBackup(db, carpeta, undefined, prefijo);
  } catch (e) {
    if (carpeta === porDefecto) throw e;
    const destino = hacerBackup(db, porDefecto, undefined, prefijo);
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
export function rutasBackup(app: Express, db: DatabaseSync, porDefecto: string, sistema?: Sistema) {
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
  if (!sistema) return;
  // Copia manual donde el usuario elija (un pendrive, por ejemplo).
  app.post('/api/backup/guardar-como', soloLocal, async (_req, res) => {
    try {
      const destino = await sistema.guardarComo(`hornera-${new Date().toLocaleDateString('sv')}.db`);
      if (!destino) return res.json({ cancelado: true });
      rmSync(destino, { force: true }); // el diálogo ya preguntó si reemplazarlo
      copiarBase(db, destino);
      res.json({ copia: destino });
    } catch (e) {
      res.status(500).json(error(e));
    }
  });
  // Restaurar o borrar todo: copia de la actual, base nueva lista al lado y la app se reinicia.
  const reemplazar = async (res: Response, preparar: () => Promise<boolean>) => {
    try {
      if (!(await preparar())) return res.json({ cancelado: true });
      let copia: string;
      try {
        copia = respaldar(db, porDefecto, 'antes-de-reemplazar'); // fuera de la rotación: no se borra sola
      } catch (e) {
        descartar(sistema.rutaDb); // sin copia de la actual no se reemplaza
        throw e;
      }
      res.json({ copia });
      setTimeout(sistema.reiniciar, 500); // que la respuesta llegue antes de cerrar
    } catch (e) {
      res.status(500).json(error(e));
    }
  };
  app.post('/api/backup/restaurar', soloLocal, (_req, res) => reemplazar(res, async () => {
    const origen = await sistema.elegirArchivo(carpetaBackups(db, porDefecto).carpeta);
    if (origen) prepararRestauracion(origen, sistema.rutaDb);
    return !!origen;
  }));
  app.post('/api/backup/borrar-todo', soloLocal, (req, res) => reemplazar(res, async () => {
    if (req.body?.confirmacion !== 'BORRAR') throw new Error('Escribí BORRAR para confirmar.');
    prepararBaseVacia(db, sistema.rutaDb);
    return true;
  }));
}
