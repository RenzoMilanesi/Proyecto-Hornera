// Correr: npm test
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirDb } from '../db.ts';
import { capitulosManual, consultaSql, herramientas, MAX_FILAS } from './herramientas.ts';

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

test('consulta_sql: solo SELECT, sin las tablas ocultas y con tope de filas', async (t) => {
  const db = base(t);
  assert.deepEqual((await consultaSql(db, `SELECT codigo, nombre FROM depto`)).filas.map((f) => ({ ...(f as object) })), [{ codigo: 'AAA', nombre: 'Depto A' }]);
  for (const sql of [
    `DELETE FROM depto`, `UPDATE depto SET nombre = 'x'`, `INSERT INTO concepto(nombre) VALUES ('x')`,
    `ATTACH DATABASE 'otra.db' AS otra`, `PRAGMA table_info(depto)`, `DROP TABLE depto`,
    `SELECT * FROM terminal`, `SELECT valor FROM configuracion`, `SELECT * FROM (SELECT token_hash FROM TERMINAL)`,
  ]) await assert.rejects(consultaSql(db, sql), /not authorized|prohibited|readonly/, sql);
  assert.equal((db.prepare('SELECT count(*) n FROM depto').get() as { n: number }).n, 1); // nada se borró

  const muchas = await consultaSql(db, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500) SELECT i FROM n`);
  assert.equal(muchas.filas.length, MAX_FILAS);
  assert.match(muchas.aviso!, /primeras 200 filas/);

  // Un texto largo (raw_json de Stays) se corta con aviso (plan 064).
  db.exec(`INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en)
           VALUES ('R1', 1, '2026-09-01', '2026-09-03', 'ARS', json_object('x', printf('%.5000c', 'a')), 'x')`);
  const [larga] = (await consultaSql(db, `SELECT raw_json FROM reserva`)).filas as { raw_json: string }[];
  assert.equal(larga.raw_json.length, 2000 + '… (cortado: 5008 caracteres)'.length);
  assert.ok(larga.raw_json.endsWith('a… (cortado: 5008 caracteres)'));
});

test('consulta_sql: una consulta sin fin se corta y el servidor sigue atendiendo mientras tanto', async (t) => {
  let ticks = 0;
  const reloj = setInterval(() => ticks++, 20);
  t.after(() => clearInterval(reloj));
  const db = base(t);
  const inicio = Date.now();
  await assert.rejects(consultaSql(db, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n`, 500),
    /tardó más de 0.5 s y se cortó/);
  assert.ok(Date.now() - inicio < 3000);
  assert.ok(ticks >= 5, `el hilo principal quedó libre (ticks: ${ticks})`);
});

test('herramientas: la descripción del SQL no nombra las tablas ocultas y un depto desconocido se explica', (t) => {
  const db = base(t);
  const todas = herramientas(db);
  const sql = todas.find((x) => x.definicion.name === 'consulta_sql')!;
  assert.match(sql.definicion.description!, /depto\(id, codigo/);
  assert.doesNotMatch(sql.definicion.description!, /terminal\(|configuracion\(/);
  // Si se suma una herramienta, que sea a propósito. Las proponer_* no escriben (plan 068): arman una tarjeta.
  assert.deepEqual(todas.map((x) => x.definicion.name), ['listar_deptos', 'listar_propietarios', 'periodos', 'cuentas', 'liquidacion',
    'hoja_depto', 'reservas', 'resumen_mes', 'evolucion', 'resumen_hornera', 'movimientos', 'gastos_personales', 'transferencias',
    'historial_pagos', 'ficha_depto', 'vencimientos', 'limpieza_horas', 'limpieza_liquidaciones', 'comprobantes', 'mis_comprobantes', 'manual',
    'proponer_movimiento', 'proponer_gasto_personal', 'proponer_ficha', 'proponer_mes', 'consulta_sql']);
  // La API rechaza la pregunta entera si un enum declara type ['string', 'null']: lo opcional va con anyOf (plan 068).
  const malos: string[] = [];
  const revisar = (nodo: unknown, ruta: string) => {
    if (!nodo || typeof nodo !== 'object') return;
    const o = nodo as Record<string, unknown>;
    if ('enum' in o && typeof o.type !== 'string') malos.push(ruta);
    for (const [k, v] of Object.entries(o)) revisar(v, `${ruta}.${k}`);
  };
  for (const x of todas) revisar(x.definicion.input_schema, x.definicion.name);
  assert.deepEqual(malos, []);
  const ficha = todas.find((x) => x.definicion.name === 'ficha_depto')!;
  assert.throws(() => ficha.correr(db, { depto: 'ZZZ' }), /No existe el depto ZZZ/);
  assert.equal((ficha.correr(db, { depto: 'aaa' }) as { notas: null }).notas, null);

  // Un mes cerrado que vino del Excel no tiene sus reservas: la herramienta lo avisa en vez de pasar una lista parcial.
  const reservas = todas.find((x) => x.definicion.name === 'reservas')!;
  db.exec(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, costo_hora_limpieza, servicio_limpieza,
             servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2,
             cm_fee_usd, estado)
             VALUES ('2026-09', '2026-09-01', '2026-10-01', '2026-09-28', '2026-10-10', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'cerrado');
           INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_ocupadas, cant_reservas, ingresos_ars,
             ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars, saldo_anterior_usd,
             movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
             VALUES (1, 1, 1000, 0.2, 30, 20, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'x')`);
  const r = reservas.correr(db, { mes: '2026-09', depto: null }) as { filas: unknown[]; aviso: string };
  assert.deepEqual(r.filas, []);
  assert.match(r.aviso, /vino del Excel.*registró 7/);
});

test('manual: va por capítulo, a pedido', (t) => {
  const db = base(t);
  const manual = herramientas(db).find((x) => x.definicion.name === 'manual')!;
  assert.equal(capitulosManual()[6].titulo, '7. Liquidación');
  assert.match(manual.correr(db, { capitulo: 7 }) as string, /^7\. Liquidación\n[\s\S]*Cerrar el mes/);
  assert.throws(() => manual.correr(db, { capitulo: 99 }), /No existe el capítulo 99/);
});
