// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from './db.ts';
import { agregar, borrar, editar, ficha, vencimientos } from './ficha.ts';

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('OVL', 'Hornera Lagos', 1), ('BAL', 'Hornera Balcón', 1);
    INSERT INTO concepto(nombre) VALUES ('EPE'), ('Expensas');
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd) VALUES
      ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0);`);
  return db;
}
const gasto = (db: ReturnType<typeof base>, depto: number, concepto: number, fecha: string, estado = 'vigente') =>
  db.prepare(`INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, concepto_id, importe_ars, estado, creado_en)
    VALUES (1, ?, ?, 'gasto', ?, -100, ?, 'x')`).run(fecha, depto, concepto, estado);

test('vencimientos: toca según periodicidad, se paga con un gasto del depto y concepto en el mes, el día 31 cae al último', () => {
  const db = base();
  agregar(db, 'servicios', 1, { concepto: 'EPE', dia: 15, cada_meses: 2, mes_desde: 2 });   // EPE bimestral, meses pares
  agregar(db, 'servicios', 1, { concepto: 'Expensas', dia: 31, cada_meses: 1, mes_desde: 1 });   // Expensas mensual
  agregar(db, 'servicios', 2, { concepto: 'EPE', dia: 15, cada_meses: 2, mes_desde: 1 });   // EPE de BAL, meses impares
  agregar(db, 'servicios', 2, { concepto: 'Expensas', dia: 10, cada_meses: 1, mes_desde: 1, paga: 'propietario' }); // no avisa
  gasto(db, 1, 1, '2026-10-03');
  gasto(db, 2, 2, '2026-10-03');                   // gasto de otro depto: no paga las expensas de OVL
  gasto(db, 1, 2, '2026-10-04', 'anulado');        // anulado: no cuenta
  const v = vencimientos(db, '2026-11', '2026-11-20');
  assert.deepEqual(v.map((x) => [x.codigo, x.concepto, x.vence, x.estado]),
    [['BAL', 'EPE', '2026-11-15', 'vencido'], ['OVL', 'Expensas', '2026-11-30', 'pendiente']]);
  assert.deepEqual(vencimientos(db, '2026-10', '2026-10-20').map((x) => [x.codigo, x.concepto, x.vence, x.estado]),
    [['OVL', 'EPE', '2026-10-15', 'pagado'], ['OVL', 'Expensas', '2026-10-31', 'pendiente']]);
  assert.equal(vencimientos(db, '2026-10', '2026-11-01')[1].estado, 'vencido');
  db.exec(`UPDATE depto SET estado = 'finalizado' WHERE id = 1`);
  assert.deepEqual(vencimientos(db, '2026-10', '2026-10-20'), []);
  assert.throws(() => vencimientos(db, '2026-13'), /Mes inválido/);
});

test('validación: el vencimiento va completo y el concepto es obligatorio; lista desconocida, rechazada', () => {
  const db = base();
  assert.throws(() => agregar(db, 'servicios', 1, { concepto: 'EPE', dia: 15 }), /día, cada cuántos meses/);
  assert.throws(() => agregar(db, 'servicios', 1, { dia: 15, cada_meses: 1, mes_desde: 1 }), /concepto/);
  assert.throws(() => agregar(db, 'servicios', 1, { concepto: 'EPE', dia: 15, cada_meses: 5, mes_desde: 1 }), /1, 2, 3, 4, 6 o 12/);
  assert.throws(() => agregar(db, 'claves', 1, { clave: 'x' }), /Wifi/);
  assert.throws(() => agregar(db, 'propietario', 1, {}), /No existe la lista/);
  assert.throws(() => agregar(db, 'contactos', 99, { nombre: 'Portero' }), /No existe el depto/);
});

test('claves: quedan en la ficha y en la auditoría sin el valor de la clave', () => {
  const db = base();
  const id = agregar(db, 'claves', 1, { nombre: 'Wifi', usuario: 'Red-Ficticia', clave: 'secreta-1' });
  editar(db, 'claves', id, { nombre: 'Wifi', usuario: 'Red-Ficticia', clave: 'secreta-2' });
  assert.equal((ficha(db, 1).claves[0] as { clave: string }).clave, 'secreta-2');
  borrar(db, 'claves', id);
  assert.equal(ficha(db, 1).claves.length, 0);
  const auditoria = db.prepare(`SELECT accion, antes_json || despues_json AS j FROM auditoria WHERE tabla = 'depto_clave'`).all()
    .map((f) => `${f.accion} ${f.j ?? ''}`).join(' ');
  assert.match(auditoria, /alta.*modificacion.*anulacion/);
  assert.doesNotMatch(auditoria, /secreta/);
  agregar(db, 'contactos', 1, { nombre: 'Portero' });  // contactos y servicios no se auditan
  assert.equal((db.prepare(`SELECT count(*) n FROM auditoria`).get() as { n: number }).n, 3);
});
