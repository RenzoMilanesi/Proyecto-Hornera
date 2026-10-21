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
assert.equal(db.prepare('SELECT propietario_id FROM liquidacion').get().propietario_id, null); // NULL = dueño actual
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

// Fotos del depto: JSON válido o nada
falla(`UPDATE depto SET fotos = 'no es json' WHERE id = 1`, 'CHECK');
run(`UPDATE depto SET fotos = '["https://x.stays.net/image/1"]' WHERE id = 1`);

// Propietario: un mismo propietario de Stays no se vincula a dos de la app
run(`INSERT INTO propietario(nombre, stays_owner_id) VALUES ('Propietario Dos', 's1')`);
falla(`INSERT INTO propietario(nombre, stays_owner_id) VALUES ('Propietario Tres', 's1')`, 'UNIQUE');

// Reserva: desglose de Stays como JSON válido
falla(`UPDATE reserva SET desglose_json = 'no es json'`, 'CHECK');
falla(`UPDATE reserva SET cancelada = 2`, 'CHECK');

// Período: la fecha de la cotización es YYYY-MM-DD
falla(`UPDATE periodo SET usd_cotizacion_fecha = '16/10/2026'`, 'CHECK');
run(`UPDATE periodo SET usd_cotizacion_fecha = '2026-04-30'`);

// Terminal: un token por terminal
run(`INSERT INTO terminal(nombre, token_hash, creada_en) VALUES ('PC 2', 'h1', 'x')`);
falla(`INSERT INTO terminal(nombre, token_hash, creada_en) VALUES ('PC 3', 'h1', 'x')`, 'UNIQUE');

// Facturación: datos fiscales del propietario
falla(`UPDATE propietario SET fiscal_doc_tipo = 86 WHERE id = 1`, 'CHECK');
falla(`UPDATE propietario SET fiscal_condicion_iva = 'RM' WHERE id = 1`, 'CHECK');
run(`UPDATE propietario SET fiscal_razon_social = 'Propietario Uno', fiscal_doc_tipo = 80,
      fiscal_doc_nro = '20111111112', fiscal_condicion_iva = 'consumidor_final' WHERE id = 1`);

// Emisor: CUIT de 11 dígitos, único
const emisor = (cuit) => `INSERT INTO emisor(nombre, razon_social, cuit, condicion_iva, punto_venta)
  VALUES ('Emisor', 'Emisor Uno', '${cuit}', 'monotributista', 3)`;
falla(emisor('20-11111111-2'), 'CHECK');
run(emisor('20111111112'));
falla(emisor('20111111112'), 'UNIQUE');
assert.equal(db.prepare(`SELECT ambiente FROM emisor`).get().ambiente, 'homologacion');

// Comprobante: aprobado con número y CAE; rechazado sin ellos; número único por emisor y tipo
const cbte = (estado, numero, cae, tipo = 11, asociado = 'NULL') => `INSERT INTO comprobante(periodo_id, depto_id, propietario_id, movimiento_id,
  emisor_id, cbte_tipo, punto_venta, numero, cae, cae_vencimiento, fecha, serv_desde, serv_hasta, importe,
  receptor_json, estado, ambiente, asociado_id, creado_en)
  VALUES (1, 1, 1, ${pagoId}, 1, ${tipo}, 3, ${numero}, ${cae}, ${cae === 'NULL' ? 'NULL' : `'2026-05-20'`}, '2026-05-10',
  '2026-04-01', '2026-04-30', 1683400, '{}', '${estado}', 'homologacion', ${asociado}, 'x')`;
run(cbte('aprobado', 1, `'75123456789012'`));
run(cbte('rechazado', 'NULL', 'NULL'));
falla(cbte('aprobado', 'NULL', `'75123456789012'`), 'ck_comprobante_estado');
falla(cbte('rechazado', 2, 'NULL'), 'ck_comprobante_estado');
falla(cbte('aprobado', 1, `'75123456789013'`), 'UNIQUE');
// Nota de crédito: siempre con la factura que anula; una factura, sin asociado
falla(cbte('rechazado', 'NULL', 'NULL', 13), 'ck_comprobante_nc');
falla(cbte('rechazado', 'NULL', 'NULL', 11, 1), 'ck_comprobante_nc');
run(cbte('rechazado', 'NULL', 'NULL', 13, 1));

// Comprobante importado de Mis Comprobantes: uno por emisor, tipo, punto de venta y número
const arca = (fecha) => `INSERT INTO comprobante_arca(emisor_id, fecha, cbte_tipo, punto_venta, numero, numero_hasta, importe, importado_en)
  VALUES (1, '${fecha}', 11, 1, 316, 316, 12227810, 'x')`;
falla(arca('2026-10-32'), 'CHECK');
run(arca('2026-10-16'));
falla(arca('2026-10-16'), 'UNIQUE');

console.log('schema OK');
