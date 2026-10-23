// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from './db.ts';
import { anularMovimiento, editarMovimiento } from './movimientos.ts';
import { calcular, crearLiquidacion, editarLiquidacion, guardarPlus, horas, listarLiquidaciones, pagarLiquidacion, verLiquidacion } from './limpieza.ts';

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'abierto');
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('OVL', 'Depto Uno', 1);
    INSERT INTO tarea_limpieza(fecha, depto_id, operaria, tipo, minutos) VALUES
      ('2026-10-02', 1, 'ANA', 'Limpieza', 120),
      ('2026-10-03', 1, 'ANA', 'Check-Out', 0),
      ('2026-10-03', 1, 'BEA', 'Limpieza', 150),
      ('2026-10-04', NULL, 'BEA', 'Oficina', 600),
      ('2026-10-20', 1, 'ANA', 'Limpieza', 120);`);
  return db;
}

test('calcular: plus en horas y en pesos, redondeo por chica y total = suma de las chicas', () => {
  const plus = { 'Check-Out': { modo: 'horas' as const, valor: 30 }, 'Check-In': { modo: 'pesos' as const, valor: 50000 } };
  const r = calcular([
    { operaria: 'ANA', tipo: 'Limpieza', minutos: 120 },
    { operaria: 'ANA', tipo: 'Check-Out', minutos: 0 },
    { operaria: 'BEA', tipo: 'Check-In', minutos: 20 },
  ], 786979, plus); // $7.869,79 la hora
  assert.deepEqual(r.porOperaria, [
    { operaria: 'ANA', tareas: 2, minutos: 150, importe: 1967448 },          // 2,5 h × 7.869,79 = 19.674,475 → 19.674,48
    { operaria: 'BEA', tareas: 1, minutos: 20, importe: 262326 + 50000 },    // 1/3 h = 2.623,26 + $500 de plus
  ]);
  assert.equal(r.importe, 1967448 + 312326);
  assert.equal(r.minutos, 170);
});

test('liquidación: toma las tareas del período, no se pisa, pagar crea el gasto y la foto, anular el pago la libera', () => {
  const db = base();
  const id = crearLiquidacion(db, { desde: '2026-10-01', hasta: '2026-10-15', precio_hora: 600000 });
  assert.throws(() => crearLiquidacion(db, { desde: '2026-10-15', hasta: '2026-10-31', precio_hora: 600000 }), /Se pisa con el período 01\/10–15\/10/);
  let l = verLiquidacion(db, id);
  // ANA: 120 + 0 + 30 de plus = 150 min; BEA: 150 + 600 = 750 min
  assert.deepEqual(l.porOperaria.map((o) => [o.operaria, o.minutos, o.importe]), [['BEA', 750, 7500000], ['ANA', 150, 1500000]]);
  assert.deepEqual(l.porDepto, [{ depto: 'INT', tareas: 1, minutos: 600 }, { depto: 'OVL', tareas: 3, minutos: 300 }]);
  assert.throws(() => editarLiquidacion(db, id, { desde: '2026-10-01', hasta: '2026-10-15', precio_hora: 600000, ajuste: 100 }), /nota/);
  editarLiquidacion(db, id, { desde: '2026-10-01', hasta: '2026-10-15', precio_hora: 600000, ajuste: 25000, ajuste_nota: 'Horas pagadas de más' });

  const { movimiento_id } = pagarLiquidacion(db, id, { fecha: '2026-10-16', cuenta_id: null });
  const m = db.prepare(`SELECT m.importe_ars, m.depto_id, m.tipo, c.nombre concepto, m.detalle FROM movimiento m JOIN concepto c ON c.id = m.concepto_id
    WHERE m.id = ?`).get(movimiento_id) as Record<string, unknown>;
  assert.deepEqual({ ...m }, { importe_ars: -9025000, depto_id: null, tipo: 'gasto', concepto: 'Limpieza', detalle: 'Limpieza 01/10–15/10' });
  assert.throws(() => pagarLiquidacion(db, id, { fecha: '2026-10-16', cuenta_id: null }), /ya está pagada/);
  assert.throws(() => editarLiquidacion(db, id, { desde: '2026-10-01', hasta: '2026-10-14', precio_hora: 1 }), /pagada/);

  // Reimportar cambia las tareas: lo pagado queda igual y avisa que difiere.
  db.exec(`INSERT INTO tarea_limpieza(fecha, depto_id, operaria, tipo, minutos) VALUES ('2026-10-05', 1, 'CAMI', 'Limpieza', 60)`);
  l = verLiquidacion(db, id);
  assert.equal(l.total, 9025000);
  assert.equal(l.difiere, true);
  assert.equal(listarLiquidaciones(db)[0].fecha_pago, '2026-10-16');

  assert.throws(() => editarMovimiento(db, movimiento_id, {
    mes: '2026-10', fecha: '2026-10-16', depto: null, tipo: 'gasto', concepto: 'Limpieza', detalle: null, importe_ars: -1, importe_usd: 0, cuenta_id: null,
  }), /liquidación de limpieza/);
  anularMovimiento(db, movimiento_id);
  l = verLiquidacion(db, id);
  assert.equal(l.pagada, false);
  assert.equal(l.porOperaria.length, 3); // vuelve a calcular con las tareas de hoy
});

test('las reglas nuevas valen para las liquidaciones que se crean después; horas suma por chica, depto y mes', () => {
  const db = base();
  const vieja = crearLiquidacion(db, { desde: '2026-10-01', hasta: '2026-10-15', precio_hora: 600000 });
  assert.throws(() => guardarPlus(db, { 'Check-Out': { modo: 'dolares', valor: 1 } }), /horas o en pesos/);
  guardarPlus(db, { 'Check-Out': { modo: 'pesos', valor: 100000 } });
  const nueva = crearLiquidacion(db, { desde: '2026-10-16', hasta: '2026-10-31', precio_hora: 600000 });
  assert.deepEqual(verLiquidacion(db, vieja).plus, { 'Check-In': { modo: 'horas', valor: 60 }, 'Cambio Blanqueria': { modo: 'horas', valor: 60 }, 'Check-Out': { modo: 'horas', valor: 30 } });
  assert.deepEqual(verLiquidacion(db, nueva).plus, { 'Check-Out': { modo: 'pesos', valor: 100000 } });

  const h = horas(db, '2026-10-01', '2026-10-31');
  assert.deepEqual(h.porOperaria, [{ clave: 'BEA', tareas: 2, minutos: 750 }, { clave: 'ANA', tareas: 3, minutos: 240 }]);
  assert.deepEqual(h.porMes, [{ clave: '2026-10', tareas: 5, minutos: 990 }]);
});
