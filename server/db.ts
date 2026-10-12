// Abre la base SQLite (node:sqlite, sin módulo nativo) y crea el esquema si es nueva.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = new URL('../schema.sql', import.meta.url);
const VERSION_ESQUEMA = 1; // subir junto con cada migración

export function abrirDb(ruta: string): DatabaseSync {
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (user_version === 0) {
    db.exec(`BEGIN; ${readFileSync(SCHEMA, 'utf8')}; PRAGMA user_version = ${VERSION_ESQUEMA}; COMMIT;`);
  } else if (user_version > VERSION_ESQUEMA) {
    throw new Error(`La base es de una versión más nueva del programa (esquema ${user_version}).`);
  }
  // ponytail: sin migraciones todavía; se agregan cuando cambie el esquema con datos reales cargados.
  return db;
}
