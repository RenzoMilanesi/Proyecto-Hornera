// Correr: npm test. ARCA es un fetch falso: nada sale a la red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import forge from 'node-forge';
import { abrirDb } from './db.ts';
import { crearApp } from './app.ts';
import { hoyLocal, type Fetch } from './cotizacion.ts';
import { listarTransferencias } from './liquidacion/pagos.ts';
import { propuesta } from './facturacion.ts';

const json = { 'Content-Type': 'application/json' };
const restarDias = (dias: number) => new Date(Date.parse(`${hoyLocal()}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
const arca = (iso: string) => iso.replaceAll('-', '');
const entre = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];

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
const CERT = certificado('20111111112');

// ARCA falso: `estado` decide qué contesta cada método; `pedidos` guarda los FECAESolicitar.
function arcaFalso() {
  const estado = { ultimo: 7, fechaUltimo: restarDias(20), cae: 'ok' as 'ok' | 'rechazo' | 'timeout' };
  const pedidos: string[] = [];
  const fetchArca = (async (url: string, init: RequestInit) => {
    if (url.includes('wsaa')) {
      const expira = new Date(Date.now() + 12 * 3_600_000).toISOString();
      const ta = `<loginTicketResponse><token>TK</token><sign>SG</sign><expirationTime>${expira}</expirationTime></loginTicketResponse>`;
      return new Response(`<r><loginCmsReturn>${ta.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></r>`);
    }
    const accion = String((init.headers as Record<string, string>).SOAPAction);
    if (accion.endsWith('FECompUltimoAutorizado')) return new Response(`<r><CbteNro>${estado.ultimo}</CbteNro></r>`);
    if (accion.endsWith('FECompConsultar')) return new Response(`<r><CbteFch>${arca(estado.fechaUltimo)}</CbteFch></r>`);
    pedidos.push(String(init.body));
    if (estado.cae === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (estado.cae === 'rechazo') return new Response('<r><Resultado>R</Resultado><Err><Code>600</Code><Msg>ValidacionDeToken: token vencido</Msg></Err></r>');
    const n = entre(String(init.body), 'CbteDesde');
    estado.ultimo = Number(n);
    return new Response(`<r><Resultado>A</Resultado><CbteDesde>${n}</CbteDesde><CAE>7612345678901${n}</CAE><CAEFchVto>20261231</CAEFchVto></r>`);
  }) as unknown as Fetch;
  return { fetchArca, estado, pedidos };
}

// Mayo cerrado: AAA con honorarios de $1.000 y saldo de $10.000 a pagar; el propietario con datos fiscales.
function base() {
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
  return db;
}

async function conApi(fn: (llamar: (metodo: string, ruta: string, cuerpo?: unknown) => Promise<{ status: number; body: any }>, db: DatabaseSync) => Promise<void>, f: Fetch) {
  const db = base();
  const guardadas = new Map<string, string>();
  const claves = { leer: (c: string) => guardadas.get(c) ?? null, guardar: (c: string, k: string) => { guardadas.set(c, k); } };
  const server = crearApp(db, '0.0.0', { claves, fetchArca: f }).listen(0);
  const llamar = async (metodo: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/${ruta}`,
      { method: metodo, headers: json, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { status: r.status, body: await r.json() };
  };
  const error = console.error;
  console.error = () => {};  // arca.ts loguea las fallas de red
  try {
    await llamar('POST', 'emisores', { nombre: 'Emisor Uno', razon_social: 'PRUEBA UNO', cuit: '20111111112', condicion_iva: 'monotributista', punto_venta: 3, ambiente: 'homologacion' });
    await llamar('POST', 'emisores/1/certificado', CERT);
    await fn(llamar, db);
  } finally {
    console.error = error;
    server.close();
  }
  return db;
}
const pagar = async (llamar: any, importe: number, fecha = hoyLocal()) =>
  (await llamar('POST', 'liquidaciones/1/pagar', { cuenta_id: 1, fecha, importe })).body.id as number;

test('propuesta: proporcional al pago, avisa al pasar los honorarios y sin saldo no se ofrece', async () => {
  const { fetchArca } = arcaFalso();
  const db = await conApi(async (llamar) => {
    const p1 = await pagar(llamar, 500000);  // la mitad del saldo
    const a = (await llamar('GET', `pagos/${p1}/factura?emisor=1`)).body;
    assert.deepEqual([a.ofrece, a.honorarios, a.facturado, a.propuesto, a.aviso], [true, 100000, 0, 50000, null]);
    assert.equal((await llamar('POST', `pagos/${p1}/factura`, { emisor_id: 1, importe: 80000 })).status, 200);

    const p2 = await pagar(llamar, 250000);  // un cuarto: propone su cuarto, y con lo ya facturado pasa el tope
    const b = (await llamar('GET', `pagos/${p2}/factura?emisor=1`)).body;
    assert.deepEqual([b.facturado, b.propuesto], [80000, 25000]);
    assert.match(b.aviso, /pasa los honorarios/);
    assert.equal((await llamar('POST', `pagos/${p2}/factura`, { emisor_id: 1, importe: 25000 })).status, 200);
    // Lo de homologación no cuenta para producción.
    assert.equal((await llamar('GET', `pagos/${p2}/factura`)).body.facturado, 0);

    assert.match((await llamar('POST', `pagos/${p1}/factura`, { emisor_id: 1, importe: 1000 })).body.error, /ya tiene la factura 00003-00000008/);
  }, fetchArca);
  const filas = listarTransferencias(db, '2026-05')[0].pagos.map((p) => [p.factura?.estado, p.factura?.numero]);
  assert.deepEqual(filas, [['aprobado', 8], ['aprobado', 9]]);

  db.exec('UPDATE liquidacion SET saldo_final_ars = 0');
  assert.equal(propuesta(db, 1).ofrece, false);
});

test('emitir: Concepto 2 con el mes liquidado, FchVtoPago = CbteFch aunque el último autorizado sea posterior al pago', async () => {
  const falso = arcaFalso();
  falso.estado.fechaUltimo = restarDias(1);
  const db = await conApi(async (llamar) => {
    const p = await pagar(llamar, 1000000, restarDias(3));
    const r = await llamar('POST', `pagos/${p}/factura`, { emisor_id: 1, importe: 100000 });
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.fecha, restarDias(1));
  }, falso.fetchArca);
  const pedido = falso.pedidos[0];
  assert.deepEqual(['Concepto', 'CbteFch', 'FchVtoPago', 'FchServDesde', 'FchServHasta', 'CbteTipo', 'ImpTotal', 'DocNro'].map((t) => entre(pedido, t)),
    ['2', arca(restarDias(1)), arca(restarDias(1)), '20260501', '20260531', '11', '1000.00', '27222222228']);
  const c = db.prepare('SELECT * FROM comprobante').get() as any;
  assert.deepEqual([c.estado, c.numero, c.cae_vencimiento, c.serv_desde, c.serv_hasta, c.importe], ['aprobado', 8, '2026-12-31', '2026-05-01', '2026-05-31', 100000]);
  assert.doesNotMatch(c.request_json, /TK|SG/);
  assert.equal(JSON.parse(c.receptor_json).razon_social, 'PROPIETARIO UNO');
});

test('rechazo de ARCA: queda el intento rechazado, el pago intacto y el ticket descartado', async () => {
  const falso = arcaFalso();
  falso.estado.cae = 'rechazo';
  const db = await conApi(async (llamar) => {
    const p = await pagar(llamar, 1000000);
    const r = await llamar('POST', `pagos/${p}/factura`, { emisor_id: 1, importe: 100000 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /ARCA rechazó la factura: 600/);
  }, falso.fetchArca);
  const c = db.prepare('SELECT estado, numero, motivo FROM comprobante').get() as any;
  assert.deepEqual([c.estado, c.numero], ['rechazado', null]);
  assert.match(c.motivo, /token vencido/);
  assert.equal(db.prepare(`SELECT estado FROM movimiento WHERE tipo = 'liquidacion'`).get()!.estado, 'vigente');
  assert.equal(db.prepare(`SELECT count(*) n FROM configuracion WHERE clave LIKE 'arca.ta.%'`).get()!.n, 0);
  assert.equal(listarTransferencias(db, '2026-05')[0].pendiente, 0);
});

test('sin datos fiscales del propietario no se emite ni se guarda nada', async () => {
  const { fetchArca, pedidos } = arcaFalso();
  const db = await conApi(async (llamar) => {
    const p = await pagar(llamar, 1000000);
    const { body } = await llamar('PUT', 'propietarios/1/fiscal', { razon_social: 'PROPIETARIO UNO', doc_tipo: 80, doc_nro: '27222222228', condicion_iva: 'consumidor_final' });
    assert.equal(body.error, undefined);
    assert.match((await llamar('POST', `pagos/${p}/factura`, { emisor_id: 1, importe: 100000 })).body.error, /Faltan los datos fiscales de Propietario Uno/);
  }, fetchArca);
  assert.equal(pedidos.length, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM comprobante').get()!.n, 0);
});

test('CAE perdido: timeout al pedir el CAE y la numeración avanzó → no se pide otro sin revisar', async () => {
  const falso = arcaFalso();
  falso.estado.cae = 'timeout';
  const db = await conApi(async (llamar) => {
    const p = await pagar(llamar, 1000000);
    assert.equal((await llamar('POST', `pagos/${p}/factura`, { emisor_id: 1, importe: 100000 })).status, 502);

    falso.estado.ultimo = 8;  // ARCA sí lo había autorizado
    falso.estado.cae = 'ok';
    const r = await llamar('POST', `pagos/${p}/factura`, { emisor_id: 1, importe: 100000 });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /n\.º 00003-00000008: revisalo en Comprobantes en Línea/);
    assert.equal(falso.pedidos.length, 1);

    const revisado = await llamar('POST', `pagos/${p}/factura`, { emisor_id: 1, importe: 100000, revisado: true });
    assert.equal(revisado.body.numero, 9);
  }, falso.fetchArca);
  const intentos = db.prepare('SELECT estado, response_json IS NULL AS sin_respuesta FROM comprobante ORDER BY id').all() as any[];
  assert.deepEqual(intentos.map((i) => [i.estado, i.sin_respuesta]), [['rechazado', 1], ['aprobado', 0]]);
});

test('anulación: el pago facturado queda marcado hasta la NC, que lleva Concepto 2 y el período de la factura', async () => {
  const falso = arcaFalso();
  const db = await conApi(async (llamar, db) => {
    const p = await pagar(llamar, 1000000, restarDias(2));
    const { body: fac } = await llamar('POST', `pagos/${p}/factura`, { emisor_id: 1, importe: 100000 });
    assert.match((await llamar('POST', `comprobantes/${fac.id}/nota-credito`, {})).body.error, /este pago está vigente/);
    const { body: anulado } = await llamar('POST', `movimientos/${p}/anular`, {});
    assert.deepEqual([anulado.facturaVigente.id, anulado.facturaVigente.numero], [fac.id, 8]);

    // La marca: el pago anulado sigue en Transferencias con su factura, sin sumar a lo pagado.
    const [t] = listarTransferencias(db, '2026-05');
    assert.deepEqual([t.pagado, t.pendiente, t.pagos.length, t.pagos[0].anulado], [0, 1000000, 1, true]);

    const nc = await llamar('POST', `comprobantes/${fac.id}/nota-credito`, {});
    assert.equal(nc.status, 200, nc.body.error);
    assert.equal(nc.body.cbteTipo, 13);
    assert.equal(listarTransferencias(db, '2026-05')[0].pagos.length, 0);
    assert.match((await llamar('POST', `comprobantes/${fac.id}/nota-credito`, {})).body.error, /ya tiene su nota de crédito/);
  }, falso.fetchArca);
  const pedido = falso.pedidos[1];
  assert.deepEqual(['Concepto', 'CbteTipo', 'CbteFch', 'FchVtoPago', 'FchServDesde', 'FchServHasta', 'Nro', 'ImpTotal'].map((t) => entre(pedido, t)),
    ['2', '13', arca(hoyLocal()), arca(hoyLocal()), '20260501', '20260531', '8', '1000.00']);
  const c = db.prepare(`SELECT asociado_id, serv_desde, serv_hasta FROM comprobante WHERE cbte_tipo = 13`).get() as any;
  assert.deepEqual([c.asociado_id, c.serv_desde, c.serv_hasta], [1, '2026-05-01', '2026-05-31']);
  assert.equal(db.prepare(`SELECT estado FROM movimiento WHERE tipo = 'liquidacion'`).get()!.estado, 'anulado');
});
