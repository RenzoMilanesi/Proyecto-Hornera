// Correr: npm test
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirDb } from '../db.ts';
import { consultaSql, herramientas, MAX_FILAS } from './herramientas.ts';

// consulta_sql abre la base aparte en solo lectura: necesita un archivo.
function base(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'hornera-ia-'));
  const db = abrirDb(join(dir, 'h.db'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
           INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
           INSERT INTO terminal(nombre, token_hash, creada_en) VALUES ('PC Dos', 'hash', 'x');
           INSERT INTO configuracion(clave, valor) VALUES ('arca.ticket', 'secreto')`);
  return db;
}

test('consulta_sql: solo SELECT, sin las tablas ocultas y con tope de filas', (t) => {
  const db = base(t);
  assert.deepEqual(JSON.parse(JSON.stringify(consultaSql(db, `SELECT codigo, nombre FROM depto`))), { filas: [{ codigo: 'AAA', nombre: 'Depto A' }] });
  for (const sql of [
    `DELETE FROM depto`, `UPDATE depto SET nombre = 'x'`, `INSERT INTO concepto(nombre) VALUES ('x')`,
    `ATTACH DATABASE 'otra.db' AS otra`, `PRAGMA table_info(depto)`, `DROP TABLE depto`,
    `SELECT * FROM terminal`, `SELECT valor FROM configuracion`, `SELECT * FROM (SELECT token_hash FROM TERMINAL)`,
  ]) assert.throws(() => consultaSql(db, sql), /not authorized|prohibited|readonly/, sql);
  assert.equal((db.prepare('SELECT count(*) n FROM depto').get() as { n: number }).n, 1); // nada se borró

  const muchas = consultaSql(db, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500) SELECT i FROM n`);
  assert.equal(muchas.filas.length, MAX_FILAS);
  assert.match(muchas.aviso!, /primeras 200 filas/);
});

test('herramientas: la descripción del SQL no nombra las tablas ocultas y un depto desconocido se explica', (t) => {
  const db = base(t);
  const todas = herramientas(db);
  const sql = todas.find((x) => x.definicion.name === 'consulta_sql')!;
  assert.match(sql.definicion.description!, /depto\(id, codigo/);
  assert.doesNotMatch(sql.definicion.description!, /terminal\(|configuracion\(/);
  // Sin acciones de escritura en la lista: si se suma una herramienta, que sea a propósito.
  assert.deepEqual(todas.map((x) => x.definicion.name), ['listar_deptos', 'listar_propietarios', 'periodos', 'cuentas', 'liquidacion',
    'hoja_depto', 'reservas', 'resumen_mes', 'evolucion', 'resumen_hornera', 'movimientos', 'gastos_personales', 'transferencias',
    'historial_pagos', 'ficha_depto', 'vencimientos', 'limpieza_horas', 'limpieza_liquidaciones', 'comprobantes', 'mis_comprobantes', 'consulta_sql']);
  const ficha = todas.find((x) => x.definicion.name === 'ficha_depto')!;
  assert.throws(() => ficha.correr(db, { depto: 'ZZZ' }), /No existe el depto ZZZ/);
  assert.equal((ficha.correr(db, { depto: 'aaa' }) as { notas: null }).notas, null);
});
