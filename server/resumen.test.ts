// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { abrirDb } from './db.ts';
import { evolucion, metricas, resumenDelMes } from './resumen.ts';

const periodo = (db: DatabaseSync, mes: string, inicio: string, cierre: string, estado: string) => db.prepare(`
  INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, usd_descuento_pct,
    costo_hora_limpieza, servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento,
    tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado)
  VALUES (?, ?, ?, ?, ?, 1000, 0, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 2500, ?) RETURNING id`)
  .get(mes, inicio, cierre, cierre, cierre, estado) as { id: number };

// Liquidación cerrada mínima: honorarios se guardan negativos (vista del propietario).
const liquidacion = (db: DatabaseSync, periodoId: number, deptoId: number, ocupadas: number, bruto: number, costos: number, honorarios: number) => db.prepare(`
  INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_ocupadas, cant_reservas,
    ingresos_ars, ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars,
    saldo_anterior_usd, movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
  VALUES (?, ?, 1000, 0.2, 30, ?, 2, 0, 0, ?, 0, 0, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 'x')`).run(periodoId, deptoId, ocupadas, costos, bruto, honorarios);

test('resumen de un mes cerrado: KPIs por depto, resultado de Hornera y saldos de cuentas', () => {
  const db = abrirDb(':memory:');
  const abril = periodo(db, '2026-04', '2026-04-01', '2026-05-01', 'abierto').id;
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1), ('BBB', 'Depto B', 1);
    INSERT INTO cuenta(nombre, moneda) VALUES ('Banco A', 'ARS'), ('Caja USD', 'USD');`);
  liquidacion(db, abril, 1, 20, 10000000, 1000000, -2000000);
  liquidacion(db, abril, 2, 10, 5000000, 500000, -1000000);
  const mov = db.prepare(`INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, importe_ars, importe_usd, cuenta_id, creado_en) VALUES (?, '2026-04-10', ?, ?, ?, ?, ?, 'x')`);
  mov.run(abril, null, 'gasto', -400000, 0, 1);        // gasto de la empresa: resta
  mov.run(abril, null, 'ingreso', 0, 5000, 2);         // ingreso de la empresa en USD
  mov.run(abril, 1, 'gasto', -300000, 0, 1);           // gasto de un depto: lo paga el propietario, no cuenta
  mov.run(abril, null, 'saldo_inicial', 9000000, 0, 1); // no es resultado
  db.exec(`UPDATE periodo SET estado = 'cerrado'`);

  const r = resumenDelMes(db, '2026-04');
  assert.equal(r.estado, 'cerrado');
  assert.deepEqual(r.deptos.map((d) => [d.codigo, d.noches_ocupadas, d.honorarios]), [['AAA', 20, 2000000], ['BBB', 10, 1000000]]);
  // Sin detalle de reservas (mes del Excel), el alojamiento es bruto − costos operativos.
  assert.deepEqual(r.totales, {
    noches_disponibles: 60, noches_ocupadas: 30, noches_propietario: 0, reservas: 4, bruto: 15000000, alojamiento: 13500000,
    valor_inicial: 10500000, noches_venta: 60, noches_vendidas: 30, ocupacion: 0.5, adr: 450000, revpar: 225000, neto_noche: 350000,
    revpar_mediana: 225000, honorario_efectivo: 0.2,
  });
  // 30.000 honorarios + 15.000 costos operativos − 4.000 de gastos de la empresa
  assert.deepEqual(r.resultado, { honorarios: 3000000, costos_operativos: 1500000, empresa: { ars: -400000, usd: 5000 }, total_ars: 4100000 });
  assert.deepEqual(r.cuentas.map((c: any) => [c.nombre, c.saldo]), [['Banco A', 9000000 - 400000 - 300000], ['Caja USD', 5000]]);
});

test('resumen del mes abierto sin cotización: avisa y no tiene deptos', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-05', '2026-05-01', '2026-06-01', 'abierto');
  db.exec(`UPDATE periodo SET usd_cotizacion = NULL`);
  const r = resumenDelMes(db, '2026-05');
  assert.equal(r.deptos.length, 0);
  assert.match(r.avisos[0], /Falta la cotización/);
  assert.throws(() => resumenDelMes(db, '2030-01'), /No existe el período/);
});

test('evolución: meses cerrados con su resultado y, antes, solo las noches del histórico', () => {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1), ('BBB', 'Depto B', 1);
    INSERT INTO historico_mensual(depto_id, mes, noches_ocupadas) VALUES (1, '2024-10', 12), (2, '2024-10', 8), (1, '2026-04', 99);`);
  const abril = periodo(db, '2026-04', '2026-04-01', '2026-05-01', 'abierto').id;
  periodo(db, '2026-05', '2026-05-01', '2026-06-01', 'abierto'); // abierto: no entra
  liquidacion(db, abril, 1, 20, 10000000, 1000000, -2000000);
  db.prepare(`INSERT INTO movimiento(periodo_id, fecha, tipo, importe_ars, creado_en) VALUES (?, '2026-04-10', 'gasto', -400000, 'x')`).run(abril);
  db.exec(`UPDATE periodo SET estado = 'cerrado' WHERE mes = '2026-04'`);

  assert.deepEqual(evolucion(db).map((f: any) => ({ ...f })), [
    { mes: '2024-10', noches_disponibles: null, noches_ocupadas: 20, ocupacion: null, adr: null, revpar: null, reservas: null, bruto: null, honorarios: null, resultado_ars: null },
    // 2026-04 sale de la liquidación, no del histórico (99)
    { mes: '2026-04', noches_disponibles: 30, noches_ocupadas: 20, ocupacion: 20 / 30, adr: 450000, revpar: 300000, reservas: 2, bruto: 10000000, honorarios: 2000000, resultado_ars: 2600000 },
  ]);
});

test('métricas: la estadía del propietario no es noche vendida ni a la venta', () => {
  // 30 disponibles (sin bloqueos), 20 ocupadas de las que 5 son del propietario.
  const m = metricas({ noches_disponibles: 30, noches_ocupadas: 20, noches_propietario: 5, alojamiento: 1500000, valor_inicial: 900000 });
  assert.deepEqual(m, { noches_venta: 25, noches_vendidas: 15, ocupacion: 0.6, adr: 100000, revpar: 60000, neto_noche: 60000 });
  assert.equal(m.revpar, (m.adr ?? 0) * (m.ocupacion ?? 0)); // RevPAR = ADR × ocupación
  assert.deepEqual(metricas({ noches_disponibles: 0, noches_ocupadas: 0, noches_propietario: 0, alojamiento: 0, valor_inicial: 0 }),
    { noches_venta: 0, noches_vendidas: 0, ocupacion: null, adr: null, revpar: null, neto_noche: null });
});
