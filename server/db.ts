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
  // 2 → 3: el saldo de una cuenta también suma los pagos de Stays de sus medios de pago.
  `DROP VIEW IF EXISTS v_saldo_cuenta;
-- El saldo arranca en la fecha del "Saldo inicial" de la cuenta (saldo_desde), si tiene:
-- lo cobrado o movido antes ya está incluido en ese saldo. Sin saldo inicial suma todo.
CREATE VIEW v_saldo_cuenta AS
SELECT c.id AS cuenta_id, c.nombre, c.moneda, c.activo, d.desde AS saldo_desde,
       -- Movimientos cargados en la app (gastos, transferencias, saldo inicial...)
       COALESCE((SELECT SUM(CASE c.moneda WHEN 'ARS' THEN m.importe_ars ELSE m.importe_usd END)
                 FROM movimiento m WHERE m.cuenta_id = c.id AND m.estado = 'vigente'
                   AND (d.desde IS NULL OR m.fecha >= d.desde)), 0)
       -- + lo que entró por los medios de pago de Stays asociados a la cuenta (neto de comisión)
     + COALESCE((SELECT SUM(CASE p.tipo WHEN 'debit' THEN -p.importe ELSE p.importe - COALESCE(p.comision, 0) END)
                 FROM pago p JOIN medio_pago mp ON mp.id = p.medio_pago_id
                 WHERE mp.cuenta_id = c.id AND mp.moneda = c.moneda AND p.estado = 'completed'
                   AND (d.desde IS NULL OR p.fecha_pago IS NULL OR p.fecha_pago >= d.desde)), 0) AS saldo
FROM cuenta c
LEFT JOIN (SELECT cuenta_id, MIN(fecha) AS desde FROM movimiento
           WHERE tipo = 'saldo_inicial' AND estado = 'vigente' AND cuenta_id IS NOT NULL
           GROUP BY cuenta_id) d ON d.cuenta_id = c.id;`,
  // 3 → 4: terminales de la red (fase 5d).
  `CREATE TABLE terminal (
      id          INTEGER PRIMARY KEY,
      nombre      TEXT    NOT NULL,
      token_hash  TEXT    NOT NULL UNIQUE,
      creada_en   TEXT    NOT NULL,
      revocada_en TEXT
  ) STRICT;`,
  // 4 → 5: fotos de cada depto, traídas de Stays.
  `ALTER TABLE depto ADD COLUMN fotos TEXT CHECK (fotos IS NULL OR json_valid(fotos));`,
  // 5 → 6: propietario vinculado con su par de Stays.
  `ALTER TABLE propietario ADD COLUMN stays_owner_id TEXT;
   CREATE UNIQUE INDEX uq_propietario_stays ON propietario(stays_owner_id);`,
  // 6 → 7: reservas canceladas, horarios y desglose de precio de Stays.
  `ALTER TABLE reserva ADD COLUMN cancelada INTEGER NOT NULL DEFAULT 0 CHECK (cancelada IN (0,1));
   ALTER TABLE reserva ADD COLUMN hora_llegada TEXT;
   ALTER TABLE reserva ADD COLUMN hora_salida TEXT;
   ALTER TABLE reserva ADD COLUMN desglose_json TEXT CHECK (desglose_json IS NULL OR json_valid(desglose_json));`,
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
      if (db.isTransaction) db.exec('ROLLBACK'); // la base queda como estaba
      db.close();
      throw e;
    }
  }
  return db;
}
