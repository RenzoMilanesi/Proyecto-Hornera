// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { abrirDb } from './db.ts';
import { calcularAvisos } from './avisos.ts';

function certificado(vence: string) {
  const par = forge.pki.rsa.generateKeyPair(512);
  const c = forge.pki.createCertificate();
  c.publicKey = par.publicKey;
  c.validity.notBefore = new Date('2026-01-01');
  c.validity.notAfter = new Date(`${vence}T12:00:00Z`);
  c.setSubject([{ name: 'commonName', value: 'hornera' }]);
  c.setIssuer([{ name: 'commonName', value: 'hornera' }]);
  c.sign(par.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(c);
}

test('avisos: servicios, certificado, facturas trabadas, copia y lo importante de otras PCs; resuelto, se va', () => {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('OVL', 'Hornera Lagos', 1);
    INSERT INTO concepto(nombre) VALUES ('EPE'), ('Expensas'), ('Gas'), ('Pago');
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd) VALUES
      ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0);
    INSERT INTO depto_servicio(depto_id, concepto_id, paga, dia, cada_meses, mes_desde) VALUES
      (1, 1, 'hornera', 10, 1, 1), (1, 2, 'hornera', 26, 1, 1), (1, 3, 'hornera', 31, 1, 1);
    INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, concepto_id, importe_ars, estado, creado_en)
      VALUES (1, '2026-10-05', 1, 'ingreso', 4, 100, 'vigente', 'x');
    INSERT INTO auditoria(fecha, pc, tabla, registro_id, accion) VALUES
      ('2026-10-23T10:00:00-03:00', 'Lautaro', 'periodo', 1, 'cierre'),
      ('2026-10-23T11:00:00-03:00', 'Lautaro', 'movimiento', 1, 'alta'),
      ('2026-10-23T12:00:00-03:00', 'Oficina', 'periodo', 1, 'reapertura'),
      ('2026-10-10T12:00:00-03:00', 'Lautaro', 'periodo', 1, 'reapertura');
    INSERT INTO configuracion(clave, valor) VALUES ('backup.error', '{"fecha":"2026-10-23","mensaje":"Drive desmontado"}');`);
  db.prepare(`INSERT INTO emisor(nombre, razon_social, cuit, condicion_iva, punto_venta, ambiente, cert_pem)
    VALUES ('Emisor Uno', 'EMISOR UNO', '20111111112', 'monotributista', 1, 'produccion', ?), ('Prueba', 'PRUEBA', '27222222228', 'monotributista', 1, 'homologacion', ?)`)
    .run(certificado('2026-11-10'), certificado('2026-09-01'));
  db.exec(`INSERT INTO comprobante(periodo_id, depto_id, propietario_id, movimiento_id, emisor_id, cbte_tipo, punto_venta, fecha,
    serv_desde, serv_hasta, importe, receptor_json, estado, ambiente, creado_en)
    VALUES (1, 1, 1, 1, 1, 11, 1, '2026-10-05', '2026-09-01', '2026-09-30', 100, '{}', 'rechazado', 'produccion', 'x')`);

  const opciones = { pc: 'Oficina', local: true, desarrollo: false, hoy: '2026-10-24' };
  const a = calcularAvisos(db, opciones);
  assert.deepEqual(a.problemas.map((p) => [p.nivel, p.seccion]),
    [['rojo', 'vencimientos'], ['naranja', 'vencimientos'], ['naranja', 'emisores'], ['rojo', 'comprobantes'], ['rojo', 'copias']]);
  assert.match(a.problemas[0].texto, /Un servicio vencido sin pagar: OVL EPE/);
  assert.match(a.problemas[1].texto, /OVL Expensas$/); // el Gas (día 31) todavía no
  assert.match(a.problemas[2].texto, /vence el 10\/11\/2026/); // el de homologación (vencido) no, en la app instalada
  assert.deepEqual(a.problemas.map((p) => p.clave), ['venc:1@2026-10-10', 'prox:2@2026-10-26', 'cert:1@2026-11-10', 'fact:1', 'copia:2026-10-23']);
  assert.match(calcularAvisos(db, { ...opciones, desarrollo: true }).problemas.find((p) => p.clave === 'cert:2@2026-09-01')!.texto, /venció/);
  // Otras PCs: el cierre de Lautaro; ni su alta, ni lo de esta PC, ni lo de hace más de 7 días.
  assert.deepEqual(a.otrasPcs.map((c) => c.texto), ['Lautaro: Cierre · Mes · 2026-10']);
  // Una terminal no ve lo de las copias (las hace la PC servidor).
  assert.equal(calcularAvisos(db, { ...opciones, local: false }).problemas.some((p) => p.seccion === 'copias'), false);

  // Resuelto, se va: el EPE pagado, la factura aprobada, la copia que anduvo.
  db.exec(`
    INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, concepto_id, importe_ars, estado, creado_en) VALUES (1, '2026-10-20', 1, 'gasto', 1, -100, 'vigente', 'x');
    INSERT INTO comprobante(periodo_id, depto_id, propietario_id, movimiento_id, emisor_id, cbte_tipo, punto_venta, numero, cae, cae_vencimiento, fecha,
      serv_desde, serv_hasta, importe, receptor_json, estado, ambiente, creado_en)
      VALUES (1, 1, 1, 1, 1, 11, 1, 1, '123', '2026-11-01', '2026-10-06', '2026-09-01', '2026-09-30', 100, '{}', 'aprobado', 'produccion', 'x');
    DELETE FROM configuracion WHERE clave = 'backup.error';`);
  assert.deepEqual(calcularAvisos(db, opciones).problemas.map((p) => p.seccion), ['vencimientos', 'emisores']);
  // Anular el pago facturado deja la nota de crédito pendiente.
  db.exec(`UPDATE movimiento SET estado = 'anulado' WHERE id = 1`);
  assert.match(calcularAvisos(db, opciones).problemas.at(-1)!.texto, /Un pago con la factura o la nota de crédito sin salir \(10\/2026\)/);
});
