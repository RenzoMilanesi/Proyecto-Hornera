// Verifica schema.sql y sus reglas. Correr: node schema.check.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const run = (sql) => db.exec(sql);
const falla = (sql, msg) => assert.throws(() => run(sql), new RegExp(msg));
const mov = (cols, vals) =>
  `INSERT INTO movimiento(periodo_id, fecha, creado_en, ${cols}) VALUES (1, '2026-04-02', 'x', ${vals})`;

run(`INSERT INTO cuenta(nombre, moneda) VALUES ('Galicia A','ARS'), ('Payoneer A','USD')`);
run(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno')`);
run(`INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('OVL','Hornera Lagos',1)`);
run(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago,
      costo_hora_limpieza, servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa,
      mantenimiento, tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd)
     VALUES ('2026-04','2026-04-01','2026-05-01','2026-04-28','2026-05-10',
      740300,1036420,1036420,829136,1036420,760000,6978520,1036420,1036420,1036420,2500)`);

// Moneda de la cuenta
run(mov('tipo, importe_ars, cuenta_id, depto_id', `'gasto', -1000000, 1, 1`));
falla(mov('tipo, importe_usd, cuenta_id', `'gasto', -500, 1`), 'moneda de la cuenta');
falla(mov('tipo, importe_ars, cuenta_id', `'gasto', -500, 2`), 'moneda de la cuenta');
falla(`UPDATE movimiento SET importe_usd = 1 WHERE id = 1`, 'moneda de la cuenta');
run(mov('tipo, importe_usd, depto_id', `'pago_directo', -43178, 1`)); // sin cuenta: ambas monedas ok
assert.equal(db.prepare(`SELECT saldo FROM v_saldo_cuenta WHERE cuenta_id = 1`).get().saldo, -1000000);

// Bloqueo
falla(`INSERT INTO bloqueo(depto_id, desde, hasta) VALUES (1, '2026-04-10', '2026-04-10')`, 'ck_bloqueo_fechas');

// Período cerrado
run(`INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_ocupadas,
      cant_reservas, ingresos_ars, ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto,
      honorarios, saldo_anterior_ars, saldo_anterior_usd, movimientos_ars, movimientos_usd, conversion_ars,
      conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
     VALUES (1,1,1400.6,0.2,30,29,2,0,0,0,0,0,0,0,0,0,0,0,0,0,84171700,0,'x')`);
run(`UPDATE periodo SET estado = 'cerrado' WHERE id = 1`);
falla(mov('tipo, importe_ars', `'gasto', -1`), 'periodo cerrado');
falla(`UPDATE movimiento SET detalle = 'x' WHERE id = 1`, 'periodo cerrado');
falla(`DELETE FROM movimiento WHERE id = 1`, 'periodo cerrado');
run(mov('tipo, importe_ars, cuenta_id, depto_id', `'liquidacion', -84171700, 1, 1`)); // pago post-cierre: permitido
const pagoId = db.prepare(`SELECT max(id) id FROM movimiento`).get().id;
run(`UPDATE liquidacion SET movimiento_pago_id = ${pagoId}`);

// Liquidación pagada: no se borra hasta anular el pago
run(`UPDATE periodo SET estado = 'abierto' WHERE id = 1`);
falla(`DELETE FROM liquidacion`, 'liquidacion pagada');
run(`UPDATE movimiento SET estado = 'anulado' WHERE id = ${pagoId}`);
assert.equal(db.prepare(`SELECT movimiento_pago_id m FROM liquidacion`).get().m, null);
run(`DELETE FROM liquidacion`);

// Pago sin medio: rechazado (la moneda sale del medio)
run(`INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en)
     VALUES ('PI08J', 1, '2026-04-01', '2026-04-06', 'USD', '{}', 'x')`);
falla(`INSERT INTO pago(stays_id, reserva_id, tipo, estado, importe, raw_json)
       VALUES ('p1', 1, 'credit', 'completed', 100, '{}')`, 'NOT NULL');

// Terminal: un token por terminal
run(`INSERT INTO terminal(nombre, token_hash, creada_en) VALUES ('PC 2', 'h1', 'x')`);
falla(`INSERT INTO terminal(nombre, token_hash, creada_en) VALUES ('PC 3', 'h1', 'x')`, 'UNIQUE');

console.log('schema OK');
