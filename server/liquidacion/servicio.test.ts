// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { abrirDb } from '../db.ts';
import { importarExcel } from '../importador/excel.ts';
import { liquidarPeriodo } from './servicio.ts';
import { armarAbrilEnBase } from './abril-en-base.ts';

const periodo = (db: DatabaseSync, mes: string, inicio: string, cierre: string, estado: string, cotizacion: number | null) => db.prepare(`
  INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, usd_descuento_pct,
    costo_hora_limpieza, servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento,
    tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado)
  VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 2500, ?) RETURNING id`)
  .get(mes, inicio, cierre, cierre, cierre, cotizacion, estado) as { id: number };

test('arma la liquidación del mes abierto desde la base', () => {
  const db = abrirDb(':memory:');
  const abril = periodo(db, '2026-04', '2026-04-01', '2026-05-01', 'cerrado', 1000).id;
  const mayo = periodo(db, '2026-05', '2026-05-01', '2026-06-01', 'abierto', null).id;
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id, estado) VALUES
      ('AAA', 'Depto A', 1, 'activo'), ('BBB', 'Depto B', 1, 'finalizado'), ('CCC', 'Depto C', 1, 'pausado');
    INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda, descuenta_comision) VALUES ('mp', 'MP', 'mercadopago', 'ARS', 1);
    INSERT INTO reserva(codigo, depto_id, llegada, salida, huespedes, moneda, raw_json, sincronizada_en,
                        ajuste_ars, ajuste_comision_ars, excluida) VALUES
      ('R1', 1, '2026-05-10', '2026-05-15', 2, 'ARS', '{}', 'x', -500000, 100000, 0),
      ('R2', 1, '2026-05-20', '2026-05-22', 2, 'ARS', '{}', 'x', 0, 0, 1);
    INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, comision, raw_json) VALUES
      ('p1', 1, 1, 'credit', 'completed', 10000000, 500000, '{}'),
      ('p2', 2, 1, 'credit', 'completed', 9900000, 1, '{}');
    INSERT INTO bloqueo(depto_id, desde, hasta) VALUES (1, '2026-05-28', '2026-06-05');
    -- Cancelada en Stays: no suma noches, reservas ni cobros.
    INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en, cancelada)
      VALUES ('R3', 1, '2026-05-23', '2026-05-25', 'ARS', '{}', 'x', 1);
    INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, comision, raw_json)
      VALUES ('p3', 3, 1, 'credit', 'completed', 7700000, 1, '{}');`);
  // Abril cerrado: AAA quedó con $1.500 a favor y se le pagaron $1.000 → arrastra $500.
  db.prepare(`
    INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_ocupadas, cant_reservas,
      ingresos_ars, ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars,
      saldo_anterior_usd, movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
    VALUES (?, 1, 1, 0.2, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 150000, 0, 'x')`).run(abril);
  db.prepare(`INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, importe_ars, creado_en) VALUES (?, '2026-05-10', 1, 'liquidacion', -100000, 'x')`).run(abril);
  db.prepare(`INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, importe_ars, creado_en) VALUES (?, '2026-05-03', 1, 'gasto', -200000, 'x'), (?, '2026-05-03', 3, 'gasto', -300000, 'x')`).run(mayo, mayo);

  const sinCotizacion = liquidarPeriodo(db, '2026-05');
  assert.deepEqual([sinCotizacion.cambio, sinCotizacion.deptos.length], [null, 0]);
  assert.match(sinCotizacion.avisos[0], /Falta la cotización/);

  db.exec(`UPDATE periodo SET usd_cotizacion = 1000 WHERE mes = '2026-05'`);
  const l = liquidarPeriodo(db, '2026-05');
  assert.deepEqual(l.deptos.map((d) => d.codigo), ['AAA', 'CCC']); // BBB finalizado y sin nada: no aparece
  const a = l.deptos[0];
  assert.deepEqual(a.saldoAnterior, { ars: 50000, usd: 0 });
  assert.deepEqual(a.reservas.map((r) => r.codigo), ['R1']); // R2 excluida
  assert.equal(a.resultado.ingresos.ars, 9000000);          // 100.000 − 5.000 de comisión MP − 5.000 de ajuste
  assert.equal(a.resultado.nochesDisponibles, 27);          // 31 − 4 bloqueadas (28 al 31)
  // Gastos directos = −(tarifa + comisiones): tarifa 10.000 + 1.000 de ajuste de comisión + USD 25 × 1000.
  assert.equal(a.resultado.gastosDirectos, -(1000000 + 100000 + 2500000));
  const c = l.deptos[1];
  assert.equal(c.resultado.gastosDirectos, 0);              // pausado y sin reservas: sin fee del channel manager
  assert.deepEqual(c.resultado.saldo, { ars: -300000, usd: 0 });
});

// Abril 2026 armado en la base como si viniera de Stays (ver abril-en-base.ts): el servicio tiene
// que dar lo mismo que el Excel. RIO y AND tienen costos editados a mano en el Excel: solo ingresos.
const ARCHIVO = new URL('../../Archivos Originales/2026-04.xlsx', import.meta.url);

test('abril 2026 armado en la base da lo mismo que el Excel', { skip: !existsSync(ARCHIVO) && 'falta Archivos Originales/2026-04.xlsx' }, () => {
  const contenido = readFileSync(ARCHIVO);
  const db = abrirDb(':memory:');
  importarExcel(db, contenido);
  armarAbrilEnBase(db, contenido);

  const calculado = new Map(liquidarPeriodo(db, '2026-04').deptos.map((d) => [d.codigo, d.resultado]));
  const errores: string[] = [];
  for (const x of db.prepare(`SELECT d.codigo, l.* FROM liquidacion l JOIN depto d ON d.id = l.depto_id`).all() as any[]) {
    const r = calculado.get(x.codigo);
    if (!r) { errores.push(`${x.codigo}: no está en el cálculo`); continue; }
    const campos: [string, number, number, number][] = [
      ['ingresosArs', r.ingresos.ars, x.ingresos_ars, 1], ['ingresosUsd', r.ingresos.usd, x.ingresos_usd, 1],
      ['nochesOcupadas', r.nochesOcupadas, x.noches_ocupadas, 0], ['nochesDisponibles', r.nochesDisponibles, x.noches_disponibles, 0],
    ];
    if (x.codigo !== 'RIO' && x.codigo !== 'AND') {
      campos.push(['bruto', r.bruto, x.bruto, 0], ['honorarios', r.honorarios, x.honorarios, 0],
        ['saldoArs', r.saldo.ars, x.saldo_final_ars, 0], ['saldoUsd', r.saldo.usd, x.saldo_final_usd, 0]);
    }
    for (const [campo, app, excel, tol] of campos) if (Math.abs(app - excel) > tol) errores.push(`${x.codigo}.${campo}: app ${app} ≠ Excel ${excel}`);
  }
  assert.deepEqual(errores, []);
});

test('la comisión de una reserva que cruza de mes se cobra solo en el mes en que llega', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-04', '2026-04-01', '2026-05-01', 'abierto', 1000);
  periodo(db, '2026-05', '2026-05-01', '2026-06-01', 'abierto', 1000);
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO reserva(codigo, depto_id, llegada, salida, huespedes, moneda, raw_json, sincronizada_en, ajuste_comision_ars) VALUES
      ('CRUZA', 1, '2026-04-28', '2026-05-03', 2, 'ARS', '{}', 'x', 1000000),
      ('MAYO', 1, '2026-05-10', '2026-05-12', 2, 'ARS', '{}', 'x', 2000000);`);
  const comisiones = (mes: string) => liquidarPeriodo(db, mes).deptos[0].comisiones;
  assert.deepEqual(comisiones('2026-04'), { ars: 1000000, usd: 2500 });
  assert.deepEqual(comisiones('2026-05'), { ars: 2000000, usd: 2500 });
});

test('avisa si el saldo se arrastra desde un mes que no es el anterior', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-04', '2026-04-01', '2026-05-01', 'cerrado', 1000);
  periodo(db, '2026-06', '2026-06-01', '2026-07-01', 'abierto', 1000);
  assert.ok(liquidarPeriodo(db, '2026-06').avisos.includes('Se arrastra el saldo de 2026-04: falta cargar 2026-05.'));
  periodo(db, '2027-01', '2027-01-01', '2027-02-01', 'abierto', 1000);
  periodo(db, '2026-12', '2026-12-01', '2027-01-01', 'cerrado', 1000);
  assert.ok(!liquidarPeriodo(db, '2027-01').avisos.some((a) => a.startsWith('Se arrastra')));
});
