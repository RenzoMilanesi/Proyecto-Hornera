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
// Saldado por fuera: una fecha YYYY-MM-DD o nada
falla(`UPDATE liquidacion SET saldado_fuera = '21/10/2026'`, 'CHECK');
run(`UPDATE liquidacion SET saldado_fuera = '2026-10-21'`);
run(`UPDATE liquidacion SET saldado_fuera = NULL`);
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

// Gastos importados: una fila de origen, un movimiento
run(mov('tipo, importe_ars, origen', "'gasto', -100, 'gastos:x'"));
falla(mov('tipo, importe_ars, origen', "'gasto', -100, 'gastos:x'"), 'UNIQUE');

// Gastos ajenos: código conocido, importe positivo, una fila de origen; período cerrado = congelado
run(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, costo_hora_limpieza, servicio_limpieza,
      servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd)
     VALUES ('2026-09','2026-09-01','2026-10-01','2026-09-28','2026-10-10',1,1,1,1,1,1,1,1,1,1,0)`);
const ajenoPer = db.prepare(`SELECT id FROM periodo WHERE mes = '2026-09'`).get().id;
const ajeno = (codigo, importe, origen) => `INSERT INTO gasto_ajeno(periodo_id, fecha, codigo, importe, origen, creado_en)
  VALUES (${ajenoPer}, '2026-09-05', '${codigo}', ${importe}, ${origen}, 'x')`;
run(ajeno('CAY/LAU', 100, `'gastos:a'`));
falla(ajeno('BBVA', 100, 'NULL'), 'CHECK');
falla(ajeno('CAY', 0, 'NULL'), 'CHECK');
falla(ajeno('CAY', 100, `'gastos:a'`), 'UNIQUE');
run(`UPDATE periodo SET estado = 'cerrado' WHERE id = ${ajenoPer}`);
falla(`UPDATE gasto_ajeno SET importe = 200`, 'periodo cerrado');

// Auditoría: "traer mes" e importaciones van con la acción importacion; otra acción no entra
run(`INSERT INTO auditoria(fecha, pc, tabla, accion) VALUES ('x', 'Lautaro', 'stays', 'importacion')`);
falla(`INSERT INTO auditoria(fecha, pc, tabla, accion) VALUES ('x', 'Lautaro', 'stays', 'borrado')`, 'CHECK');

// Ficha del depto: el vencimiento va completo (día, cada cuántos meses y desde qué mes) o no va
run(`INSERT INTO concepto(nombre) VALUES ('EPE')`);
run(`INSERT INTO depto_servicio(depto_id, concepto_id, dia, cada_meses, mes_desde) VALUES (1, 1, 15, 2, 1)`);
run(`INSERT INTO depto_servicio(depto_id, concepto_id, paga) VALUES (1, 1, 'propietario')`);
falla(`INSERT INTO depto_servicio(depto_id, concepto_id, dia) VALUES (1, 1, 15)`, 'ck_servicio_vence');
falla(`INSERT INTO depto_servicio(depto_id, concepto_id, dia, cada_meses, mes_desde) VALUES (1, 1, 15, 5, 1)`, 'CHECK');
falla(`INSERT INTO depto_servicio(depto_id, concepto_id, paga) VALUES (1, 1, 'inquilino')`, 'CHECK');
falla(`INSERT INTO depto_clave(depto_id) VALUES (1)`, 'NOT NULL');

// Limpieza: los períodos no se pisan, el plus es JSON y anular el pago deja la liquidación pendiente
const liqLimp = (desde, hasta, plus = '{}') => `INSERT INTO liquidacion_limpieza(desde, hasta, precio_hora, plus_json, creado_en)
  VALUES ('${desde}', '${hasta}', 700000, '${plus}', 'x')`;
run(liqLimp('2026-09-10', '2026-09-22'));
falla(liqLimp('2026-09-22', '2026-10-07'), 'se pisa');
falla(liqLimp('2026-09-25', '2026-09-23'), 'CHECK');
falla(liqLimp('2026-09-23', '2026-10-07', 'no es json'), 'CHECK');
run(liqLimp('2026-09-23', '2026-10-07'));
falla(`UPDATE liquidacion_limpieza SET hasta = '2026-09-24' WHERE desde = '2026-09-10'`, 'se pisa');
run(`UPDATE periodo SET estado = 'abierto' WHERE id = 1`);
run(mov('tipo, importe_ars', `'gasto', -1000`));
const pagoLimp = db.prepare(`SELECT max(id) id FROM movimiento`).get().id;
run(`UPDATE liquidacion_limpieza SET movimiento_id = ${pagoLimp} WHERE desde = '2026-09-10'`);
run(`INSERT INTO liquidacion_limpieza_operaria VALUES (1, 'ANA', 3, 360, 1000)`);
run(`UPDATE movimiento SET estado = 'anulado' WHERE id = ${pagoLimp}`);
assert.equal(db.prepare(`SELECT movimiento_id m FROM liquidacion_limpieza WHERE id = 1`).get().m, null);
assert.equal(db.prepare(`SELECT count(*) n FROM liquidacion_limpieza_operaria`).get().n, 0);
falla(`INSERT INTO tarea_limpieza(fecha, operaria, tipo, minutos) VALUES ('2026-09-10', '', 'Limpieza', 60)`, 'CHECK');

// Asistente de IA: el historial es JSON y borrar la conversación borra sus respuestas
const conv = (json) => `INSERT INTO conversacion_ia(pc, titulo, mensajes_json, creada_en, actualizada_en)
  VALUES ('Lautaro', 'cuánto se liquidó', '${json}', 'x', 'x')`;
falla(conv('no es json'), 'CHECK');
run(conv('[]'));
const convId = db.prepare(`SELECT max(id) id FROM conversacion_ia`).get().id;
const resp = (json) => `INSERT INTO respuesta_ia(conversacion_id, modelo, esfuerzo, tokens_entrada, tokens_cache, tokens_salida,
  herramientas_json, creada_en) VALUES (${convId}, 'claude-sonnet-5-5', 'medium', 10, 0, 5, '${json}', 'x')`;
falla(resp('no es json'), 'CHECK');
run(resp('[]'));
run(`DELETE FROM conversacion_ia WHERE id = ${convId}`);
assert.equal(db.prepare(`SELECT count(*) n FROM respuesta_ia`).get().n, 0);

console.log('schema OK');
