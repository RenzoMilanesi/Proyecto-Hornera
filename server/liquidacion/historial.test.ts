// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from '../db.ts';
import { anularMovimiento } from '../movimientos.ts';
import { cerrarPeriodo } from './cierre.ts';
import { listarTransferencias, pagarLiquidacion } from './pagos.ts';
import { historial } from './historial.ts';

// Abril cerrado (sin liquidaciones), mayo y junio abiertos. AAA (de Propietario Uno) con una reserva cobrada en mayo.
function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-04', '2026-04-01', '2026-05-01', '2026-04-28', '2026-05-10', 1000, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 0, 'cerrado'),
      ('2026-05', '2026-05-01', '2026-06-01', '2026-05-28', '2026-06-10', 1000, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 0, 'abierto'),
      ('2026-06', '2026-06-01', '2026-07-01', '2026-06-28', '2026-07-10', 1000, 1, 1, 1, 1, 1, 1, 1000000, 100000, 100000, 100000, 0, 'abierto');
    INSERT INTO propietario(nombre, cbu) VALUES ('Propietario Uno', '0000000000000000000001'), ('Propietario Dos', '0000000000000000000002');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Prueba', 'ARS');
    INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda) VALUES ('mp', 'MP', 'mercadopago', 'ARS');
    INSERT INTO reserva(codigo, depto_id, llegada, salida, huespedes, moneda, raw_json, sincronizada_en) VALUES
      ('R1', 1, '2026-05-10', '2026-05-15', 2, 'ARS', '{}', 'x');
    INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, raw_json) VALUES ('p1', 1, 1, 'credit', 'completed', 10000000, '{}');`);
  return db;
}
const mayo = (db: ReturnType<typeof base>, f: { deptoId?: number; propietarioId?: number }, anulados = false) =>
  historial(db, f, anulados).find((x) => x.mes === '2026-05')!;

test('historial: mes pagado completo', () => {
  const db = base();
  cerrarPeriodo(db, '2026-05');
  const [t] = listarTransferencias(db, '2026-05');
  pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 1, fecha: '2026-06-10', importe: t.saldo });
  const f = mayo(db, { deptoId: 1 });
  assert.deepEqual([f.estado, f.pendiente, f.pagado, f.pagos.length], ['pagado', 0, t.saldo, 1]);
});

test('historial: pago parcial y anulados ocultos o visibles sin sumar', () => {
  const db = base();
  cerrarPeriodo(db, '2026-05');
  const [t] = listarTransferencias(db, '2026-05');
  pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 1, fecha: '2026-06-10', importe: 1000000 });
  const errado = pagarLiquidacion(db, t.liquidacionId, { cuenta_id: 1, fecha: '2026-06-11', importe: 500000 });
  anularMovimiento(db, errado);
  const sin = mayo(db, { deptoId: 1 });
  assert.deepEqual([sin.estado, sin.pagado, sin.pagos.length], ['parcial', 1000000, 1]);
  const con = mayo(db, { deptoId: 1 }, true);
  assert.equal(con.pagado, 1000000);
  assert.deepEqual(con.pagos.map((p) => p.anulado), [false, true]);
});

test('historial: cada mes va al dueño que tenía el depto al cerrarlo', () => {
  const db = base();
  cerrarPeriodo(db, '2026-05');
  db.exec('UPDATE depto SET propietario_id = 2');
  cerrarPeriodo(db, '2026-06');
  const meses = (propietarioId: number) => historial(db, { propietarioId }, false).map((x) => x.mes);
  assert.deepEqual(meses(1), ['2026-05']);
  assert.deepEqual(meses(2), ['2026-06']);
  assert.equal(listarTransferencias(db, '2026-05')[0].propietario, 'Propietario Uno');
});

test('historial: el mes abierto va primero, en curso y sin liquidación', () => {
  const db = base();
  cerrarPeriodo(db, '2026-05');
  const [primera] = historial(db, { deptoId: 1 }, false);
  assert.deepEqual([primera.mes, primera.estado, primera.liquidacionId, primera.pagos.length], ['2026-06', 'en_curso', null, 0]);
});

test('historial: un mes sin pagar cuyo saldo pasó al siguiente cerrado', () => {
  const db = base();
  cerrarPeriodo(db, '2026-05');
  cerrarPeriodo(db, '2026-06');
  const f = mayo(db, { deptoId: 1 });
  assert.deepEqual([f.estado, f.arrastradoA], ['arrastrado', '2026-06']);
});

test('historial: sin depto ni propietario no responde', () => {
  assert.throws(() => historial(base(), {}, false), /Elegí un depto o un propietario/);
});
