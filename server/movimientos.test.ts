// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from './db.ts';
import { anularMovimiento, crearMovimiento, editarMovimiento, transferir, type DatosMovimiento } from './movimientos.ts';
import { liquidarPeriodo } from './liquidacion/servicio.ts';

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-04', '2026-04-01', '2026-05-01', '2026-04-28', '2026-05-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'cerrado'),
      ('2026-05', '2026-05-01', '2026-06-01', '2026-05-28', '2026-06-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'abierto');
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Prueba', 'ARS'), ('Dólares Prueba', 'USD');`);
  return db;
}
const gasto = (cambios: Partial<DatosMovimiento> = {}): DatosMovimiento => ({
  mes: '2026-05', fecha: '2026-05-04', depto: 'AAA', tipo: 'gasto', concepto: 'Expensas', detalle: 'Expensas mayo',
  importe_ars: -5000000, importe_usd: 0, cuenta_id: 1, ...cambios,
});
const saldo = (db: ReturnType<typeof abrirDb>, cuenta: number) => (db.prepare('SELECT saldo FROM v_saldo_cuenta WHERE cuenta_id = ?').get(cuenta) as any).saldo;

test('un gasto entra en la cuenta y en la liquidación del depto, y queda auditado', () => {
  const db = base();
  const id = crearMovimiento(db, gasto());
  assert.equal(saldo(db, 1), -5000000);
  assert.equal(liquidarPeriodo(db, '2026-05').deptos[0].resultado.saldo.ars, -5000000);
  assert.equal((db.prepare(`SELECT count(*) n FROM concepto WHERE nombre = 'Expensas'`).get() as any).n, 1); // concepto nuevo
  crearMovimiento(db, gasto({ concepto: 'expensas' }));                                                     // no se duplica
  assert.equal((db.prepare(`SELECT count(*) n FROM concepto`).get() as any).n, 1);

  editarMovimiento(db, id, gasto({ importe_ars: -3000000 }));
  assert.equal(saldo(db, 1), -8000000);
  anularMovimiento(db, id);
  assert.equal(saldo(db, 1), -5000000);
  assert.equal(liquidarPeriodo(db, '2026-05').deptos[0].resultado.saldo.ars, -5000000);
  const acciones = (db.prepare(`SELECT accion FROM auditoria WHERE tabla = 'movimiento' AND registro_id = ? ORDER BY id`).all(id) as any[]).map((a) => a.accion);
  assert.deepEqual(acciones, ['alta', 'modificacion', 'anulacion']);
});

test('validaciones con mensajes claros', () => {
  const db = base();
  assert.throws(() => crearMovimiento(db, gasto({ importe_ars: 5000 })), /egreso: el importe va negativo/);
  assert.throws(() => crearMovimiento(db, gasto({ tipo: 'ingreso', importe_ars: -5000 })), /ingreso va positivo/);
  assert.throws(() => crearMovimiento(db, gasto({ importe_ars: 0 })), /Falta el importe/);
  assert.throws(() => crearMovimiento(db, gasto({ importe_ars: 0, importe_usd: -100 })), /es en ARS: el importe tiene que estar solo en ARS/);
  assert.throws(() => crearMovimiento(db, gasto({ mes: '2026-04', fecha: '2026-04-10' })), /2026-04 está cerrado/);
  assert.throws(() => crearMovimiento(db, gasto({ tipo: 'pre_liquidacion', depto: null })), /tiene que ser de un depto/);
  assert.throws(() => crearMovimiento(db, gasto({ tipo: 'liquidacion' })), /Tipo de movimiento inválido/);
  assert.throws(() => crearMovimiento(db, gasto({ depto: 'ZZZ' })), /No existe el depto ZZZ/);
  assert.throws(() => crearMovimiento(db, gasto({ fecha: '4/5/2026' })), /Fecha inválida/);
  // Gasto de la empresa (INT) sin cuenta: vale.
  crearMovimiento(db, gasto({ depto: null, cuenta_id: null }));
  assert.equal((db.prepare('SELECT count(*) n FROM movimiento').get() as any).n, 1);
});

test('transferencia entre cuentas (compra de dólares) y su anulación', () => {
  const db = base();
  crearMovimiento(db, gasto({ tipo: 'saldo_inicial', depto: null, concepto: null, importe_ars: 200000000 })); // saldo inicial de la cuenta
  const id = transferir(db, { mes: '2026-05', fecha: '2026-05-05', detalle: null, desde_cuenta_id: 1, importe_desde: 150000000, hacia_cuenta_id: 2, importe_hacia: 100000 });
  assert.deepEqual([saldo(db, 1), saldo(db, 2)], [50000000, 100000]);
  assert.equal(liquidarPeriodo(db, '2026-05').deptos[0].resultado.saldo.ars, 0); // no toca a ningún depto
  assert.throws(() => editarMovimiento(db, id, gasto()), /se anulan y se vuelven a cargar/);
  assert.throws(() => transferir(db, { mes: '2026-05', fecha: '2026-05-05', detalle: null, desde_cuenta_id: 1, importe_desde: 100, hacia_cuenta_id: 1, importe_hacia: 100 }), /misma/);

  anularMovimiento(db, id + 1); // anular cualquiera de las dos patas anula la transferencia entera
  assert.deepEqual([saldo(db, 1), saldo(db, 2)], [200000000, 0]);
});

test('el saldo de la cuenta suma lo cobrado por los medios de pago de Stays asociados', () => {
  const db = base();
  db.exec(`
    INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda, descuenta_comision, cuenta_id) VALUES ('mp', 'MP', 'mercadopago', 'ARS', 1, 1);
    INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en) VALUES ('R1', 1, '2026-05-02', '2026-05-04', 'ARS', '{}', 'x');
    INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, comision, raw_json) VALUES
      ('p1', 1, 1, 'credit', 'completed', 10000000, 500000, '{}'),   -- entra neto de comisión
      ('p2', 1, 1, 'credit', 'pending', 7000000, NULL, '{}'),        -- pendiente: todavía no entró
      ('p3', 1, 1, 'debit', 'completed', 1000000, NULL, '{}');       -- devolución: sale`);
  assert.equal(saldo(db, 1), 10000000 - 500000 - 1000000);
});

test('el saldo de la cuenta arranca en su saldo inicial: lo anterior ya está incluido ahí', () => {
  const db = base();
  db.exec(`
    INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda, cuenta_id) VALUES ('banco', 'Banco', 'bank', 'ARS', 1);
    INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en) VALUES ('R1', 1, '2026-05-02', '2026-05-04', 'ARS', '{}', 'x');
    INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, fecha_pago, raw_json) VALUES
      ('antes', 1, 1, 'credit', 'completed', 300000, '2026-05-05', '{}'),
      ('despues', 1, 1, 'credit', 'completed', 700000, '2026-05-12', '{}');`);
  crearMovimiento(db, gasto({ fecha: '2026-05-03', importe_ars: -50000 }));             // anterior al saldo inicial
  assert.equal(saldo(db, 1), 300000 + 700000 - 50000);                                     // sin saldo inicial: todo
  crearMovimiento(db, gasto({ tipo: 'saldo_inicial', depto: null, concepto: null, fecha: '2026-05-10', importe_ars: 10000000 }));
  assert.equal(saldo(db, 1), 10000000 + 700000);                                           // desde el 10/5
  assert.equal((db.prepare('SELECT saldo_desde FROM v_saldo_cuenta WHERE cuenta_id = 1').get() as any).saldo_desde, '2026-05-10');
});

test('comprobante: se sube suelto, se vincula al guardar, se reemplaza o se quita; los sueltos viejos se borran (plan 068)', async () => {
  const { guardarAdjunto, adjuntoDe, purgarAdjuntos } = await import('./adjuntos.ts');
  const db = base();
  const pdf = Buffer.from('%PDF-1.4 ficticio');
  assert.throws(() => guardarAdjunto(db, 'x.pdf', Buffer.from('<html>')), /Solo se pueden adjuntar/); // el nombre no manda
  const uno = guardarAdjunto(db, 'ticket.pdf', pdf);
  const id = crearMovimiento(db, gasto({ adjunto_id: uno }));
  assert.equal(adjuntoDe(db, id), uno);

  editarMovimiento(db, id, gasto({ detalle: 'Otro detalle' })); // sin adjunto_id: no lo toca
  assert.equal(adjuntoDe(db, id), uno);
  const dos = guardarAdjunto(db, 'foto.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  editarMovimiento(db, id, gasto({ adjunto_id: dos }));
  assert.equal(adjuntoDe(db, id), dos);
  const otro = crearMovimiento(db, gasto());
  assert.throws(() => editarMovimiento(db, otro, gasto({ adjunto_id: dos })), /ya es de otro movimiento/);
  editarMovimiento(db, id, gasto({ adjunto_id: null }));
  assert.equal(adjuntoDe(db, id), null);

  const audit = db.prepare(`SELECT despues_json FROM auditoria WHERE tabla = 'movimiento' AND registro_id = ? ORDER BY id`).all(id) as { despues_json: string }[];
  assert.deepEqual(audit.map((a) => JSON.parse(a.despues_json).adjunto_id), [uno, undefined, dos, null]);

  // Los dos quedaron sueltos: dentro de 30 días siguen, después se borran.
  assert.equal(purgarAdjuntos(db), 0);
  assert.equal(purgarAdjuntos(db, new Date(Date.now() + 31 * 864e5)), 2);
});
