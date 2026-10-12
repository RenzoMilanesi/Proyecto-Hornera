// Abre la base SQLite (node:sqlite, sin módulo nativo). Si es nueva crea el esquema;
// si es de una versión anterior, aplica las migraciones que le falten.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = new URL('../schema.sql', import.meta.url);

// MIGRACIONES[i] lleva una base de la versión i+1 a la i+2. schema.sql siempre
// está en la última versión: una migración nueva va acá Y en schema.sql.
const MIGRACIONES = [
  // 1 → 2: saldo final y cambio de moneda en ambas monedas (propietarios que liquidan en USD).
  `ALTER TABLE liquidacion RENAME COLUMN saldo_final TO saldo_final_ars;
   ALTER TABLE liquidacion ADD COLUMN saldo_final_usd INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE liquidacion ADD COLUMN conversion_usd INTEGER NOT NULL DEFAULT 0;`,
];
export const VERSION_ESQUEMA = MIGRACIONES.length + 1;

export function abrirDb(ruta: string): DatabaseSync {
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version > VERSION_ESQUEMA) {
    throw new Error(`La base es de una versión más nueva del programa (esquema ${version}).`);
  }
  if (version < VERSION_ESQUEMA) {
    const cambios = version === 0 ? readFileSync(SCHEMA, 'utf8') : MIGRACIONES.slice(version - 1).join('\n');
    db.exec('BEGIN');
    try {
      db.exec(`${cambios}; PRAGMA user_version = ${VERSION_ESQUEMA};`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK'); // la base queda como estaba
      db.close();
      throw e;
    }
  }
  return db;
}
