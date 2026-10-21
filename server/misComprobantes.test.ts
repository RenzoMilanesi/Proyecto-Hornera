// Correr: npm test. CSV de Mis Comprobantes con datos ficticios (plan 036).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import forge from 'node-forge';
import { abrirDb } from './db.ts';
import { crearApp } from './app.ts';
import type { Fetch } from './cotizacion.ts';
import { listarTransferencias } from './liquidacion/pagos.ts';
import { leerCsv } from './misComprobantes.ts';

const ENCABEZADO = '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";'
  + '"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Denominación Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado Total";"Imp. Total"';
// Propietario Uno tiene CUIT 27222222228: la primera va a su DNI (dentro del CUIT), la segunda es de otro, la
// tercera es una NC, la cuarta queda fuera de la ventana de mayo (fin de junio).
const CSV = [ENCABEZADO,
  '2026-06-03;11;1;45;45;86000000000001;96;22222222;PROPIETARIO UNO;1,00;$;0,00;1.000,50',
  '2026-06-04;11;1;46;46;86000000000002;80;30711111110;EMPRESA AJENA SA;1,00;$;0,00;500,00',
  '2026-06-05;13;1;3;3;86000000000003;80;27222222228;PROPIETARIO UNO;1,00;$;0,00;100,00',
  '2026-07-01;11;1;47;47;86000000000004;80;27222222228;PROPIETARIO UNO;1,00;$;0,00;100,00', ''].join('\r\n');
const NOMBRE = 'comprobantes_consulta_csv_emitidos_123456789_20111111112_20261021-1519 (montos expresados en pesos).csv';

function certificado(cuit: string) {
  const par = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = par.publicKey;
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const sujeto = [{ name: 'commonName', value: 'hornera' }, { name: 'serialNumber', value: `CUIT ${cuit}` }];
  c.setSubject(sujeto);
  c.setIssuer(sujeto);
  c.sign(par.privateKey, forge.md.sha256.create());
  return { crt: forge.pki.certificateToPem(c), key: forge.pki.privateKeyToPem(par.privateKey) };
}

// ARCA falso que aprueba todo.
const fetchArca = (async (url: string, init: RequestInit) => {
  if (url.includes('wsaa')) {
    const ta = `<loginTicketResponse><token>TK</token><sign>SG</sign><expirationTime>${new Date(Date.now() + 3_600_000).toISOString()}</expirationTime></loginTicketResponse>`;
    return new Response(`<r><loginCmsReturn>${ta.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></r>`);
  }
  const accion = String((init.headers as Record<string, string>).SOAPAction);
  if (accion.endsWith('FECompUltimoAutorizado')) return new Response('<r><CbteNro>0</CbteNro></r>');
  return new Response('<r><Resultado>A</Resultado><CbteDesde>1</CbteDesde><CAE>76123456789012</CAE><CAEFchVto>20261231</CAEFchVto></r>');
}) as unknown as Fetch;

// Mayo cerrado: AAA de Propietario Uno con honorarios de $1.000 y saldo de $10.000.
async function conApi(fn: (llamar: (metodo: string, ruta: string, cuerpo?: unknown, csv?: string) => Promise<{ status: number; body: any }>, db: DatabaseSync) => Promise<void>) {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-05', '2026-05-01', '2026-06-01', '2026-05-28', '2026-06-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'cerrado');
    INSERT INTO propietario(nombre, cbu, fiscal_razon_social, fiscal_doc_tipo, fiscal_doc_nro, fiscal_condicion_iva, fiscal_domicilio)
      VALUES ('Propietario Uno', '0000000000000000000001', 'PROPIETARIO UNO', 80, '27222222228', 'consumidor_final', 'Calle Falsa 123, Rosario');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Prueba', 'ARS');
    INSERT INTO liquidacion(periodo_id, depto_id, propietario_id, cambio, comision_pct, noches_disponibles, noches_ocupadas, cant_reservas,
      ingresos_ars, ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars, saldo_anterior_usd,
      movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
      VALUES (1, 1, 1, 1000, 0.2, 31, 10, 1, 0, 0, 0, 0, 0, 0, -100000, 0, 0, 0, 0, 0, 0, 1000000, 0, 'x');`);
  const guardadas = new Map<string, string>();
  const claves = { leer: (c: string) => guardadas.get(c) ?? null, guardar: (c: string, k: string) => { guardadas.set(c, k); } };
  const server = crearApp(db, '0.0.0', { claves, fetchArca }).listen(0);
  const llamar = async (metodo: string, ruta: string, cuerpo?: unknown, csv?: string) => {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/${ruta}`, csv !== undefined
      ? { method: metodo, headers: { 'Content-Type': 'text/csv' }, body: csv }
      : { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { status: r.status, body: await r.json() };
  };
  try {
    await llamar('POST', 'emisores', { nombre: 'Emisor Uno', razon_social: 'PRUEBA UNO', cuit: '20111111112', condicion_iva: 'monotributista', punto_venta: 3, ambiente: 'homologacion' });
    await llamar('POST', 'emisores/1/certificado', certificado('20111111112'));
    await fn(llamar, db);
  } finally {
    server.close();
  }
}
const importar = (llamar: any, nombre = NOMBRE, csv = CSV) => llamar('POST', `emisores/1/mis-comprobantes?nombre=${encodeURIComponent(nombre)}`, undefined, csv);

test('CSV de Mis Comprobantes: decimales con coma y miles con punto; otro archivo no se lee', () => {
  const [f] = leerCsv(`﻿${CSV}`);
  assert.deepEqual([f.fecha, f.cbte_tipo, f.punto_venta, f.numero, f.doc_tipo, f.doc_nro, f.importe], ['2026-06-03', 11, 1, 45, 96, '22222222', 100050]);
  assert.throws(() => leerCsv('"Fecha";"Total"\n2026-01-01;1'), /No es el CSV de Mis Comprobantes/);
  assert.throws(() => leerCsv(`${ENCABEZADO}\nayer;11;1;1;1;;;;;;;;1`), /fila 2/);
});

test('importar: el CUIT del archivo tiene que ser el del emisor; reimportar no duplica', async () => {
  await conApi(async (llamar) => {
    assert.match((await importar(llamar, NOMBRE.replace('20111111112', '20333333334'))).body.error, /CUIT 20333333334/);
    assert.match((await importar(llamar, NOMBRE.replace('emitidos', 'recibidos'))).body.error, /recibidos/);
    assert.deepEqual((await importar(llamar)).body, { leidos: 4, nuevos: 4 });
    assert.deepEqual((await importar(llamar)).body, { leidos: 4, nuevos: 0 });
    const junio = (await llamar('GET', 'mis-comprobantes?mes=2026-06')).body;
    assert.deepEqual(junio.filas.map((f: any) => [f.numero, f.estado, f.propietario]),
      [[45, 'sin_vincular', 'Propietario Uno'], [46, 'ajena', null], [3, 'propietario', 'Propietario Uno']]);
    assert.equal(junio.importados[0].hasta, '2026-07-01');
  });
});

test('facturar: avisa la factura hecha por fuera; vinculada, el pago queda facturado', async () => {
  await conApi(async (llamar, db) => {
    await importar(llamar);
    const pago = (await llamar('POST', 'liquidaciones/1/pagar', { cuenta_id: 1, fecha: '2026-06-10', importe: 1000000 })).body.id;
    const p = (await llamar('GET', `pagos/${pago}/factura?emisor=1`)).body;
    assert.deepEqual(p.externas.map((x: any) => x.numero), [45]);  // ni la ajena, ni la NC, ni la de julio
    assert.match((await llamar('POST', `pagos/${pago}/factura`, { emisor_id: 1, importe: 100000 })).body.error, /ya hay una factura a Propietario Uno/);

    assert.equal((await llamar('POST', `mis-comprobantes/${p.externas[0].id}/vincular`, { movimiento_id: pago })).status, 200);
    assert.match((await llamar('POST', `mis-comprobantes/${p.externas[0].id}/vincular`, { movimiento_id: pago })).body.error, /ya está vinculada/);
    const q = (await llamar('GET', `pagos/${pago}/factura`)).body;
    assert.deepEqual([q.ofrece, q.motivo], [false, 'Ya tiene la factura 00001-00000045 de Emisor Uno, hecha por fuera de Hornera.']);
    assert.match((await llamar('POST', `pagos/${pago}/factura`, { emisor_id: 1, importe: 100000, ignorar_externas: true })).body.error, /hecha por fuera/);
    assert.equal(listarTransferencias(db, '2026-05')[0].pagos[0].externa?.numero, 45);
    assert.match((await llamar('DELETE', 'emisores/1')).body.error, /vinculadas a pagos/);

    assert.equal((await llamar('POST', `mis-comprobantes/${p.externas[0].id}/desvincular`)).status, 200);
    // Confirmado que no es de este pago: se emite igual.
    const r = await llamar('POST', `pagos/${pago}/factura`, { emisor_id: 1, importe: 100000, ignorar_externas: true });
    assert.equal(r.status, 200, r.body.error);
  });
});
