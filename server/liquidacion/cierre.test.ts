// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { abrirDb } from '../db.ts';
import { crearMovimiento, anularMovimiento } from '../movimientos.ts';
import { cerrarPeriodo, reabrirPeriodo } from './cierre.ts';
import { excelTransferencias, listarTransferencias, pagarLiquidacion } from './pagos.ts';
import { liquidacionGuardada, liquidarPeriodo } from './servicio.ts';
import { hojaDepto } from './hoja.ts';

// Abril cerrado (sin liquidaciones) y mayo abierto con una reserva de AAA cobrada por MP.
function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-04', '2026-04-01', '2026-05-01', '2026-04-28', '2026-05-10', 1000, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 0, 'cerrado'),
      ('2026-05', '2026-05-01', '2026-06-01', '2026-05-28', '2026-06-10', 1000, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 0, 'abierto');
    INSERT INTO propietario(nombre, cbu) VALUES ('Propietario Uno', '0000000000000000000001');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Prueba', 'ARS'), ('Dólares Prueba', 'USD');
    INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda) VALUES ('mp', 'MP', 'mercadopago', 'ARS');
    INSERT INTO reserva(codigo, depto_id, llegada, salida, huespedes, moneda, raw_json, sincronizada_en, ajuste_comision_ars) VALUES
      ('R1', 1, '2026-05-10', '2026-05-15', 2, 'ARS', '{}', 'x', 50000);
    INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, raw_json) VALUES ('p1', 1, 1, 'credit', 'completed', 10000000, '{}');`);
  crearMovimiento(db, { mes: '2026-05', fecha: '2026-05-04', depto: 'AAA', tipo: 'gasto', concepto: 'EPE', detalle: null, importe_ars: -100000, importe_usd: 0, cuenta_id: 1 });
  return db;
}

test('cerrar el mes guarda la liquidación tal como se calculó y congela el período', () => {
  const db = base();
  const calculo = liquidarPeriodo(db, '2026-05').deptos[0].resultado;
  assert.deepEqual(cerrarPeriodo(db, '2026-05'), { liquidaciones: 1 });

  const l = db.prepare(`SELECT * FROM liquidacion`).get() as any;
  assert.equal(l.saldo_final_ars, calculo.saldo.ars);
  assert.equal(l.bruto, calculo.bruto);
  assert.equal(l.movimientos_ars, -100000);
  assert.equal(l.comisiones_ars, 50000);
  assert.equal(l.propietario_id, 1); // el dueño al cerrar
  const lr = db.prepare(`SELECT * FROM liquidacion_reserva`).all() as any[];
  assert.deepEqual(lr.map((x) => [x.codigo_interno.trim(), x.noches_periodo, x.importe_periodo_ars, x.comision_ars]), [['260510AAA2X05N', 5, 10000000, 50000]]);
  assert.equal((db.prepare(`SELECT estado FROM periodo WHERE mes = '2026-05'`).get() as any).estado, 'cerrado');

  assert.throws(() => crearMovimiento(db, { mes: '2026-05', fecha: '2026-05-04', depto: 'AAA', tipo: 'gasto', concepto: null, detalle: null, importe_ars: -1, importe_usd: 0, cuenta_id: null }), /cerrado/);
  assert.throws(() => cerrarPeriodo(db, '2026-05'), /ya está cerrado/);
});

test('no se cierra un mes con el anterior abierto ni se reabre uno con el siguiente cerrado', () => {
  const db = base();
  db.exec(`UPDATE periodo SET estado = 'abierto' WHERE mes = '2026-04'`);
  assert.throws(() => cerrarPeriodo(db, '2026-05'), /Primero hay que cerrar 2026-04/);
  cerrarPeriodo(db, '2026-04');
  cerrarPeriodo(db, '2026-05');
  assert.throws(() => reabrirPeriodo(db, '2026-04'), /Primero hay que reabrir 2026-05/);
});

test('transferencias: marcar pagado, pagos parciales, el Excel para el banco y la reapertura', () => {
  const db = base();
  cerrarPeriodo(db, '2026-05');
  const [t] = listarTransferencias(db, '2026-05');
  assert.ok(t.saldo > 0);
  assert.deepEqual([t.codigo, t.moneda, t.pagado, t.pendiente], ['AAA', 'ARS', 0, t.saldo]);

  assert.throws(() => pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 2, fecha: '2026-06-10', importe: 100 }), /liquida en ARS y la cuenta Dólares Prueba es en USD/);
  assert.throws(() => pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 1, fecha: '2026-06-10', importe: t.saldo + 100 }), /supera lo pendiente/);
  const p1 = pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 1, fecha: '2026-06-10', importe: 1000000 });
  pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 1, fecha: '2026-06-11', importe: t.saldo - 1000000, detalle: 'Diferencia' });
  const pagada = listarTransferencias(db, '2026-05')[0];
  assert.deepEqual([pagada.pagado, pagada.pendiente, pagada.pagos.length], [t.saldo, 0, 2]);
  assert.equal((db.prepare('SELECT movimiento_pago_id m FROM liquidacion').get() as any).m, p1);
  assert.equal((db.prepare('SELECT saldo FROM v_saldo_cuenta WHERE cuenta_id = 1').get() as any).saldo, -100000 - t.saldo);

  const hoja = XLSX.read(excelTransferencias(db, '2026-05'), { type: 'buffer' });
  const filas = XLSX.utils.sheet_to_json<any>(hoja.Sheets[hoja.SheetNames[0]]);
  assert.deepEqual(filas.map((f) => [f.Depto, f['CBU/CVU'], f.Pendiente]), [['AAA', '0000000000000000000001', 0]]);

  // Pagado: no se reabre hasta anular los pagos. Anulados, se reabre y el snapshot se borra.
  assert.throws(() => reabrirPeriodo(db, '2026-05'), /pagadas \(AAA\): anulá esos pagos/);
  for (const p of pagada.pagos) anularMovimiento(db, p.id);
  reabrirPeriodo(db, '2026-05');
  assert.equal((db.prepare('SELECT count(*) n FROM liquidacion').get() as any).n, 0);
  assert.equal((db.prepare(`SELECT estado FROM periodo WHERE mes = '2026-05'`).get() as any).estado, 'abierto');
  const acciones = (db.prepare(`SELECT accion FROM auditoria WHERE tabla = 'periodo' ORDER BY id`).all() as any[]).map((a) => a.accion);
  assert.deepEqual(acciones, ['cierre', 'reapertura']);
});

test('un mes importado del Excel no se reabre', () => {
  const db = base();
  db.exec(`INSERT INTO auditoria(fecha, pc, tabla, registro_id, accion, despues_json) VALUES ('x', 'pc', 'periodo', 1, 'alta', '{"importacion":"excel"}')`);
  assert.throws(() => reabrirPeriodo(db, '2026-04'), /se importó del Excel/);
});

test('la hoja del PDF da lo mismo con el mes abierto que cerrado, y su saldo final resta los pagos', () => {
  const db = base();
  db.exec(`INSERT INTO configuracion(clave, valor) VALUES ('empresa.administrador', 'Administradora de Prueba')`);
  const redondear = (h: ReturnType<typeof hojaDepto>) => JSON.parse(JSON.stringify({ ...h, estado: null }, (_k, v) => (typeof v === 'number' ? Math.round(v) : v)));
  const abierta = hojaDepto(db, '2026-05', 'AAA');
  assert.equal(abierta.empresa.administrador, 'Administradora de Prueba');
  assert.equal(abierta.reservas.length, 1);
  assert.equal(abierta.reservas[0].llegada, '2026-05-10');
  cerrarPeriodo(db, '2026-05');
  const cerrada = hojaDepto(db, '2026-05', 'AAA');
  assert.deepEqual(redondear(cerrada), redondear(abierta));

  const [t] = listarTransferencias(db, '2026-05');
  pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 1, fecha: '2026-06-10', importe: t.saldo });
  const pagada = hojaDepto(db, '2026-05', 'AAA');
  assert.deepEqual(pagada.detalle.saldo, { ars: 0, usd: 0 });
  assert.deepEqual(pagada.detalle.movimientos.map((m) => m.concepto), ['EPE', 'Liquidacion periodo']);
  assert.deepEqual(pagada.resumen, cerrada.resumen); // la cuenta no incluye los pagos de liquidación
});

test('no se paga un mes cuyo saldo ya pasó al mes siguiente cerrado (se pagaría dos veces)', () => {
  const db = base();
  db.exec(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd) VALUES
      ('2026-06', '2026-06-01', '2026-07-01', '2026-06-28', '2026-07-10', 1000, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 0)`);
  cerrarPeriodo(db, '2026-05');
  const mayo = listarTransferencias(db, '2026-05')[0];
  assert.equal(mayo.arrastradoA, null);
  cerrarPeriodo(db, '2026-06'); // mayo sin pagar: su saldo pasa a junio
  const [arrastrada] = listarTransferencias(db, '2026-05');
  assert.equal(arrastrada.arrastradoA, '2026-06');
  assert.throws(() => pagarLiquidacion(db, arrastrada.liquidacionId, { cuenta_id: 1, fecha: '2026-06-10', importe: 100 }), /ya pasó a 2026-06 \(cerrado\): pagalo desde 2026-06/);
  const [junio] = listarTransferencias(db, '2026-06');
  assert.equal(junio.saldo, mayo.saldo); // junio arrastra el saldo de mayo (sin reservas ni gastos propios)
});

test('no se anula un pago de un mes cuyo saldo ya pasó al mes siguiente cerrado (la plata quedaría sin deberse)', () => {
  const db = base();
  db.exec(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd) VALUES
      ('2026-06', '2026-06-01', '2026-07-01', '2026-06-28', '2026-07-10', 1000, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 0)`);
  cerrarPeriodo(db, '2026-05');
  const [mayo] = listarTransferencias(db, '2026-05');
  const pago = pagarLiquidacion(db, mayo.liquidacionId, { cuenta_id: 1, fecha: '2026-06-10', importe: Math.round(mayo.saldo / 2) });
  cerrarPeriodo(db, '2026-06');
  assert.throws(() => anularMovimiento(db, pago), /ya pasó a 2026-06 \(cerrado\): reabrí 2026-06/);
  reabrirPeriodo(db, '2026-06');
  anularMovimiento(db, pago); // con junio abierto sí: su arrastre se recalcula
});

test('la moneda de un mes cerrado es la del cierre, aunque después el dueño pase a liquidar en otra', () => {
  const db = base();
  cerrarPeriodo(db, '2026-05');
  const antes = listarTransferencias(db, '2026-05')[0];
  db.exec(`UPDATE propietario SET moneda_liquidacion = 'USD'`);
  const despues = listarTransferencias(db, '2026-05')[0];
  assert.deepEqual([despues.moneda, despues.saldo, despues.pendiente], ['ARS', antes.saldo, antes.saldo]);
  assert.equal(hojaDepto(db, '2026-05', 'AAA').propietario.moneda, 'ARS');
});

test('la pantalla de un mes cerrado muestra lo guardado: igual que al cerrar, aunque después cambien la comisión o la moneda', () => {
  const db = base();
  const redondear = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'number' ? Math.round(v) : v)));
  const abierta = liquidarPeriodo(db, '2026-05');
  cerrarPeriodo(db, '2026-05');
  const guardada = liquidacionGuardada(db, '2026-05');
  assert.equal(guardada.estado, 'cerrado');
  assert.equal(guardada.cambio, abierta.cambio);
  assert.deepEqual(redondear(guardada.deptos), redondear(abierta.deptos));

  db.exec(`UPDATE depto SET comision_pct = 0.5; UPDATE propietario SET moneda_liquidacion = 'USD'`);
  assert.deepEqual(liquidacionGuardada(db, '2026-05').deptos, guardada.deptos);
  assert.notDeepEqual(redondear(liquidarPeriodo(db, '2026-05').deptos), redondear(guardada.deptos)); // "Comparar con el Excel" sigue recalculando
  // La cuenta de la pantalla es la del PDF.
  assert.deepEqual(guardada.deptos[0].cuenta, hojaDepto(db, '2026-05', 'AAA').resumen);
  assert.throws(() => liquidacionGuardada(db, '2026-06'), /No existe el período/);
});

test('con el mes abierto la cuenta de la pantalla es la del PDF, y con el redondeo cierra con el saldo', () => {
  const db = base();
  const [d] = liquidarPeriodo(db, '2026-05').deptos;
  assert.deepEqual(d.cuenta, hojaDepto(db, '2026-05', 'AAA').resumen);
  assert.equal(d.cuenta.valorFinal + d.saldoAnterior.ars + d.redondeo, d.resultado.saldo.ars);
});
