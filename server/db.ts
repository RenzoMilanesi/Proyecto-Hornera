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
  // 7 → 8: dueño del depto al cerrar cada liquidación (historial por propietario).
  `ALTER TABLE liquidacion ADD COLUMN propietario_id INTEGER REFERENCES propietario(id);
   UPDATE liquidacion SET propietario_id = (SELECT propietario_id FROM depto WHERE depto.id = liquidacion.depto_id);
   CREATE INDEX ix_liq_propietario ON liquidacion(propietario_id);`,
  // 8 → 9: día de la cotización traída de la API (provisoria si es anterior al cierre).
  `ALTER TABLE periodo ADD COLUMN usd_cotizacion_fecha TEXT
     CHECK (usd_cotizacion_fecha IS NULL OR date(usd_cotizacion_fecha) IS usd_cotizacion_fecha);`,
  // 9 → 10: facturación ARCA (plan 031): datos fiscales del propietario, emisores y comprobantes.
  `ALTER TABLE propietario ADD COLUMN fiscal_razon_social TEXT;
   ALTER TABLE propietario ADD COLUMN fiscal_doc_tipo INTEGER CHECK (fiscal_doc_tipo IN (80, 96));
   ALTER TABLE propietario ADD COLUMN fiscal_doc_nro TEXT;
   ALTER TABLE propietario ADD COLUMN fiscal_condicion_iva TEXT CHECK (fiscal_condicion_iva IN ('responsable_inscripto','monotributista','exento','consumidor_final'));
   ALTER TABLE propietario ADD COLUMN fiscal_domicilio TEXT;
   CREATE TABLE emisor (
       id                 INTEGER PRIMARY KEY,
       nombre             TEXT    NOT NULL,
       razon_social       TEXT    NOT NULL,
       cuit               TEXT    NOT NULL UNIQUE CHECK (length(cuit) = 11 AND cuit NOT GLOB '*[^0-9]*'),
       condicion_iva      TEXT    NOT NULL CHECK (condicion_iva IN ('monotributista','responsable_inscripto','exento')),
       punto_venta        INTEGER NOT NULL CHECK (punto_venta BETWEEN 1 AND 99999),
       domicilio          TEXT,
       ingresos_brutos    TEXT,
       inicio_actividades TEXT    CHECK (inicio_actividades IS NULL OR date(inicio_actividades) IS inicio_actividades),
       ambiente           TEXT    NOT NULL DEFAULT 'homologacion' CHECK (ambiente IN ('homologacion','produccion')),
       cert_pem           TEXT,
       activo             INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
   ) STRICT;
   CREATE TABLE comprobante (
       id               INTEGER PRIMARY KEY,
       periodo_id       INTEGER NOT NULL REFERENCES periodo(id),
       depto_id         INTEGER NOT NULL REFERENCES depto(id),
       propietario_id   INTEGER NOT NULL REFERENCES propietario(id),
       movimiento_id    INTEGER NOT NULL REFERENCES movimiento(id),
       emisor_id        INTEGER NOT NULL REFERENCES emisor(id),
       cbte_tipo        INTEGER NOT NULL CHECK (cbte_tipo IN (1, 3, 6, 8, 11, 13)),
       punto_venta      INTEGER NOT NULL,
       numero           INTEGER,
       cae              TEXT,
       cae_vencimiento  TEXT,
       fecha            TEXT    NOT NULL CHECK (date(fecha) IS fecha),
       serv_desde       TEXT    NOT NULL CHECK (date(serv_desde) IS serv_desde),
       serv_hasta       TEXT    NOT NULL CHECK (date(serv_hasta) IS serv_hasta),
       importe          INTEGER NOT NULL CHECK (importe > 0),
       receptor_json    TEXT    NOT NULL CHECK (json_valid(receptor_json)),
       estado           TEXT    NOT NULL CHECK (estado IN ('aprobado','rechazado')),
       ambiente         TEXT    NOT NULL CHECK (ambiente IN ('homologacion','produccion')),
       motivo           TEXT,
       observaciones    TEXT,
       request_json     TEXT,
       response_json    TEXT,
       asociado_id      INTEGER REFERENCES comprobante(id),
       creado_en        TEXT    NOT NULL,
       CONSTRAINT ck_comprobante_estado CHECK (
           (estado = 'aprobado'  AND numero IS NOT NULL AND cae IS NOT NULL AND cae_vencimiento IS NOT NULL) OR
           (estado = 'rechazado' AND numero IS NULL     AND cae IS NULL     AND cae_vencimiento IS NULL)),
       CONSTRAINT ck_comprobante_nc CHECK ((cbte_tipo IN (3, 8, 13)) = (asociado_id IS NOT NULL))
   ) STRICT;
   CREATE INDEX ix_cbte_periodo_depto ON comprobante(periodo_id, depto_id);
   CREATE INDEX ix_cbte_movimiento ON comprobante(movimiento_id);
   CREATE INDEX ix_cbte_asociado ON comprobante(asociado_id);
   CREATE UNIQUE INDEX uq_cbte_numero ON comprobante(emisor_id, ambiente, cbte_tipo, punto_venta, numero) WHERE numero IS NOT NULL;`,
  // 10 → 11: comprobantes emitidos en ARCA por cualquier medio, importados de Mis Comprobantes (plan 036).
  `CREATE TABLE comprobante_arca (
       id             INTEGER PRIMARY KEY,
       emisor_id      INTEGER NOT NULL REFERENCES emisor(id),
       fecha          TEXT    NOT NULL CHECK (date(fecha) IS fecha),
       cbte_tipo      INTEGER NOT NULL,                     -- código de ARCA (11 Factura C, 13 NC C...)
       punto_venta    INTEGER NOT NULL,
       numero         INTEGER NOT NULL,                     -- Número Desde
       numero_hasta   INTEGER NOT NULL,
       cae            TEXT,
       doc_tipo       INTEGER,                              -- 80 CUIT, 96 DNI, 99 consumidor final...
       doc_nro        TEXT,
       receptor       TEXT,
       importe        INTEGER NOT NULL,                     -- centavos ARS (Imp. Total)
       movimiento_id  INTEGER REFERENCES movimiento(id),    -- pago al que se vinculó a mano (factura hecha por fuera)
       importado_en   TEXT    NOT NULL,
       CONSTRAINT uq_cbte_arca UNIQUE (emisor_id, cbte_tipo, punto_venta, numero)
   ) STRICT;
   CREATE INDEX ix_cbte_arca_movimiento ON comprobante_arca(movimiento_id);`,
  // 11 → 12: fila de origen de los gastos varios importados, para no duplicarlos al reimportar (plan 038).
  `ALTER TABLE movimiento ADD COLUMN origen TEXT;
   CREATE UNIQUE INDEX uq_mov_origen ON movimiento(origen) WHERE origen IS NOT NULL;`,
  // 12 → 13: la moneda de la liquidación queda en el snapshot; antes se leía la del dueño de hoy.
  // Las que ya están: la moneda en la que quedó el saldo (la otra queda en 0 al convertir); si las dos dan 0, la del dueño.
  `ALTER TABLE liquidacion ADD COLUMN moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD'));
   UPDATE liquidacion SET moneda = CASE
     WHEN saldo_final_ars = 0 AND saldo_final_usd <> 0 THEN 'USD'
     WHEN saldo_final_usd = 0 AND saldo_final_ars <> 0 THEN 'ARS'
     ELSE COALESCE((SELECT pr.moneda_liquidacion FROM propietario pr
       WHERE pr.id = COALESCE(liquidacion.propietario_id, (SELECT d.propietario_id FROM depto d WHERE d.id = liquidacion.depto_id))), 'ARS') END;`,
  // 13 → 14: si la cotización de la API es provisoria se guarda aparte. Antes salía de la fecha, y una tomada el mismo
  // día del cierre (o después, si faltaba el histórico) pasaba por definitiva.
  `ALTER TABLE periodo ADD COLUMN usd_cotizacion_provisoria INTEGER NOT NULL DEFAULT 0 CHECK (usd_cotizacion_provisoria IN (0,1));
   UPDATE periodo SET usd_cotizacion_provisoria = 1
     WHERE usd_cotizacion_fuente = 'api' AND usd_cotizacion_fecha IS NOT date(fecha_cierre_reservas, '-1 day');`,
  // 14 → 15: la identidad de un gasto importado deja afuera el depto y el monto (corregirlos en el Excel lo duplicaba):
  // "gastos:<mensaje>:<código>:<monto>:<n>" pasa a "gastos:<mensaje>:<n.º dentro del mensaje>" (en el orden en que entraron).
  `UPDATE movimiento SET origen = n.nuevo FROM (
     SELECT id, 'gastos:' || msg || ':' || row_number() OVER (PARTITION BY msg ORDER BY id) AS nuevo
     FROM (SELECT id, substr(origen, 8, instr(substr(origen, 8), ':') - 1) AS msg FROM movimiento WHERE origen LIKE 'gastos:%:%:%:%')) n
   WHERE movimiento.id = n.id;`,
  // 15 → 16: "traer mes" e importaciones quedan en la auditoría con la acción importacion (un CHECK no se altera: se rehace la tabla;
  // sin RENAME, que revalida las vistas).
  `CREATE TEMP TABLE auditoria_vieja AS SELECT * FROM auditoria;
   DROP TABLE auditoria;
   CREATE TABLE auditoria (
       id          INTEGER PRIMARY KEY,
       fecha       TEXT    NOT NULL,
       pc          TEXT    NOT NULL,
       tabla       TEXT    NOT NULL,
       registro_id INTEGER,
       accion      TEXT    NOT NULL CHECK (accion IN ('alta','modificacion','anulacion','cierre','reapertura','importacion')),
       antes_json  TEXT,
       despues_json TEXT
   ) STRICT;
   INSERT INTO auditoria SELECT * FROM auditoria_vieja;
   DROP TABLE auditoria_vieja;
   CREATE INDEX ix_auditoria_registro ON auditoria(tabla, registro_id);`,
  // 16 → 17: una liquidación se puede marcar como saldada por fuera del sistema (deudas iniciales ya resueltas).
  `ALTER TABLE liquidacion ADD COLUMN saldado_fuera TEXT CHECK (saldado_fuera IS NULL OR date(saldado_fuera) IS saldado_fuera);
   ALTER TABLE liquidacion ADD COLUMN saldado_fuera_nota TEXT;`,
  // 17 → 18: gastos ajenos guardados aparte de los movimientos (plan 047).
  `CREATE TABLE gasto_ajeno (
       id          INTEGER PRIMARY KEY,
       periodo_id  INTEGER NOT NULL,
       fecha       TEXT    NOT NULL CHECK (date(fecha) IS fecha),
       codigo      TEXT    NOT NULL CHECK (codigo IN ('CAY','LAU','CAY/LAU','CASEST','CASA')),
       descripcion TEXT,
       importe     INTEGER NOT NULL CHECK (importe > 0),   -- centavos: lo que se gastó
       estado      TEXT    NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulado')),
       origen      TEXT    UNIQUE,                         -- fila del Excel (como movimiento.origen), NULL = cargado a mano
       creado_en   TEXT    NOT NULL,
       CONSTRAINT fk_ajeno_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT ON UPDATE CASCADE
   ) STRICT;
   CREATE INDEX ix_ajeno_periodo ON gasto_ajeno(periodo_id);
   CREATE TRIGGER tr_ajeno_periodo_cerrado_upd BEFORE UPDATE ON gasto_ajeno
   WHEN (SELECT estado FROM periodo WHERE id = OLD.periodo_id) = 'cerrado'
     OR (SELECT estado FROM periodo WHERE id = NEW.periodo_id) = 'cerrado'
   BEGIN
       SELECT RAISE(ABORT, 'periodo cerrado: reabrirlo para modificar gastos ajenos');
   END;`,
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
