// Correr: npm test. Nada sale a la red: cada test inyecta un fetch falso.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import forge from 'node-forge';
import { condicionIvaDePadron, desglosarIva } from './fiscal.ts';
import type { Fetch } from './cotizacion.ts';
import {
  consultarComprobante, consultarPadron, entre, ErrorArca, errores, esErrorDeToken, esReintentable, obtenerTicketAcceso, observaciones, parsearPadron,
  solicitarCAE, todos, ultimoAutorizado,
} from './arca.ts';

// Responde siempre `xml` y guarda el último pedido.
function arcaFalso(xml: string, status = 200) {
  const pedidos: { url: string; body: string }[] = [];
  const fetchFn = (async (url: string, opts: RequestInit) => {
    pedidos.push({ url, body: String(opts.body) });
    return new Response(xml, { status });
  }) as unknown as Fetch;
  return { fetchFn, pedidos, ultimo: () => pedidos.at(-1)!.body };
}
// soap() loguea cada corte de red: en los tests es ruido.
mock.method(console, 'error', () => {});

const sinRed = (async () => { throw new Error('fetch failed'); }) as unknown as Fetch;

const TA = { token: 'TOKEN', sign: 'SIGN' };
const BASE = { ta: TA, cuit: '20111111112', ambiente: 'homologacion' as const, puntoVenta: 3 };

test('parseo: CAE no se confunde con CAEFchVto; atributos y repeticiones', () => {
  assert.equal(entre('<r><CAEFchVto>20261031</CAEFchVto><CAE>75123</CAE></r>', 'CAE'), '75123');
  assert.equal(entre('<r><CAE xmlns="http://x">75123</CAE></r>', 'CAE'), '75123');
  assert.equal(entre('<r/>', 'CAE'), undefined);
  assert.deepEqual(todos('<x><Obs>1</Obs><Obs>2</Obs></x>', 'Obs'), ['1', '2']);
});

test('Err es fatal y Obs no; los mensajes se desescapan', () => {
  assert.deepEqual(errores('<r><Err><Code>10016</Code><Msg>a &amp; b &lt;c&gt;</Msg></Err></r>'), ['10016: a & b <c>']);
  const obs = '<r><Obs><Code>10217</Code><Msg>Crédito fiscal</Msg></Obs></r>';
  assert.deepEqual(errores(obs), []);
  assert.deepEqual(observaciones(obs), ['10217: Crédito fiscal']);
});

test('ultimoAutorizado: número, 0 si no hay, y un Err tira con sus códigos', async () => {
  assert.equal(await ultimoAutorizado({ ...BASE, cbteTipo: 11, fetch: arcaFalso('<r><CbteNro>41</CbteNro></r>').fetchFn }), 41);
  assert.equal(await ultimoAutorizado({ ...BASE, cbteTipo: 11, fetch: arcaFalso('<r><CbteNro>0</CbteNro></r>').fetchFn }), 0);
  await assert.rejects(
    ultimoAutorizado({ ...BASE, cbteTipo: 11, fetch: arcaFalso('<r><Err><Code>600</Code><Msg>Token</Msg></Err></r>').fetchFn }),
    { name: 'ErrorArca', tipo: 'arca', codigos: [600] });
});

test('consultarComprobante: lee CbteFch; un Err da fecha null; la red sí tira', async () => {
  const a = arcaFalso('<r><ResultGet><CbteFch>20261015</CbteFch></ResultGet></r>');
  assert.deepEqual(await consultarComprobante({ ...BASE, cbteTipo: 11, numero: 41, fetch: a.fetchFn }), { fecha: '20261015' });
  assert.match(a.ultimo(), /<CbteTipo>11<\/CbteTipo><CbteNro>41<\/CbteNro><PtoVta>3<\/PtoVta>/);
  const err = arcaFalso('<r><Err><Code>602</Code><Msg>Sin resultados</Msg></Err></r>');
  assert.deepEqual(await consultarComprobante({ ...BASE, cbteTipo: 11, numero: 41, fetch: err.fetchFn }), { fecha: null });
  await assert.rejects(consultarComprobante({ ...BASE, cbteTipo: 11, numero: 41, fetch: sinRed }), { tipo: 'red' });
});

test('transporte: sin red y HTTP feo son "red"; un fault SOAP es "arca"', async () => {
  await assert.rejects(ultimoAutorizado({ ...BASE, cbteTipo: 11, fetch: sinRed }),
    (e: Error & { tipo: string }) => e.tipo === 'red' && e.message.includes('Transferencias') && !e.message.includes('fetch failed'));
  await assert.rejects(ultimoAutorizado({ ...BASE, cbteTipo: 11, fetch: arcaFalso('<html>502</html>', 502).fetchFn }), { tipo: 'red' });
  await assert.rejects(
    ultimoAutorizado({ ...BASE, cbteTipo: 11, fetch: arcaFalso('<s><faultstring>Computador no autorizado</faultstring></s>', 500).fetchFn }),
    { tipo: 'arca', message: 'Computador no autorizado' });
});

const APROBADO = '<FECAESolicitarResponse><FECAEDetResponse><Resultado>A</Resultado>'
  + '<CAE>75123456789012</CAE><CAEFchVto>20261029</CAEFchVto></FECAEDetResponse></FECAESolicitarResponse>';

const pedido = (fetchFn: Fetch, extra = {}) => ({
  ...BASE, cbteTipo: 11, numero: 42, docTipo: 80, docNro: '27222222228', condIvaReceptor: 6,
  imp: desglosarIva(121000, 'monotributista'), fecha: '20261019',
  servDesde: '20260901', servHasta: '20260930', vtoPago: '20261019', fetch: fetchFn, ...extra,
});

test('solicitarCAE Factura C de servicios: aprobada, en pesos, sin Iva y sin el token guardado', async () => {
  const a = arcaFalso(APROBADO);
  const r = await solicitarCAE(pedido(a.fetchFn));
  assert.deepEqual(r, { aprobado: true, cae: '75123456789012', vencimiento: '20261029', numero: 42, observaciones: [],
    request: r.request, response: APROBADO });
  const b = a.ultimo();
  assert.ok(b.includes('<Concepto>2</Concepto>') && b.includes('<ImpTotal>1210.00</ImpTotal>'));
  assert.ok(!b.includes('<Iva>') && !b.includes('<CbtesAsoc>'));
  assert.ok(b.includes('TOKEN') && !r.request.includes('TOKEN') && !r.request.includes('SIGN') && r.request.includes('<Auth/>'));
});

test('solicitarCAE: el orden de los elementos es el del esquema de wsfev1', async () => {
  const a = arcaFalso(APROBADO);
  await solicitarCAE(pedido(a.fetchFn, {
    cbteTipo: 8, imp: desglosarIva(121000, 'responsable_inscripto'),
    cbteAsoc: { tipo: 6, puntoVenta: 3, numero: 41, fecha: '20261001' },
  }));
  const b = a.ultimo();
  const orden = ['<CbteFch>2026', '<ImpIVA>', '<FchServDesde>20260901', '<FchServHasta>20260930', '<FchVtoPago>20261019',
    '<MonId>', '<CondicionIVAReceptorId>', '<CbtesAsoc>', '<Iva>'].map((t) => b.indexOf(t));
  assert.ok(orden.every((p, i) => p >= 0 && (i === 0 || p > orden[i - 1])), `orden: ${orden}`);
});

test('solicitarCAE: Concepto 1 no manda fechas de servicio; Concepto 2 sin ellas no sale', async () => {
  const a = arcaFalso(APROBADO);
  await solicitarCAE(pedido(a.fetchFn, { concepto: 1, servDesde: undefined, servHasta: undefined, vtoPago: undefined }));
  assert.ok(!a.ultimo().includes('FchServDesde'));
  await assert.rejects(solicitarCAE(pedido(a.fetchFn, { vtoPago: undefined })), { tipo: 'config' });
  assert.equal(a.pedidos.length, 1);
});

test('solicitarCAE: rechazos no tiran; una Obs sola no impide aprobar', async () => {
  const err = await solicitarCAE(pedido(arcaFalso('<r><Err><Code>10016</Code><Msg>Fecha anterior</Msg></Err></r>').fetchFn));
  assert.equal(err.aprobado, false);
  assert.ok(!err.aprobado && err.codigos[0] === 10016 && err.motivo.includes('Fecha anterior'));
  const r = await solicitarCAE(pedido(arcaFalso('<r><Resultado>R</Resultado><Obs><Code>10015</Code><Msg>No corresponde</Msg></Obs></r>').fetchFn));
  assert.ok(!r.aprobado && r.motivo.includes('No corresponde'));
  const obs = await solicitarCAE(pedido(arcaFalso(APROBADO.replace('</FECAEDetResponse>',
    '<Obs><Code>10217</Code><Msg>Crédito fiscal</Msg></Obs></FECAEDetResponse>')).fetchFn));
  assert.ok(obs.aprobado);
  assert.deepEqual(obs.observaciones, ['10217: Crédito fiscal']);
});

test('obtenerTicketAcceso: firma el CMS con node-forge y lee el ticket escapado', async () => {
  const claves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = claves.publicKey;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'prueba' }]);
  cert.setIssuer([{ name: 'commonName', value: 'prueba' }]);
  cert.sign(claves.privateKey, forge.md.sha256.create());

  const ticket = '<loginTicketResponse><credentials><token>TK</token><sign>SG</sign></credentials>'
    + '<header><expirationTime>2026-10-20T08:00:00-03:00</expirationTime></header></loginTicketResponse>';
  const escapado = ticket.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const a = arcaFalso(`<r><loginCmsReturn>${escapado}</loginCmsReturn></r>`);
  const ta = await obtenerTicketAcceso({ certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(claves.privateKey), ambiente: 'homologacion', fetch: a.fetchFn });
  assert.deepEqual(ta, { token: 'TK', sign: 'SG', expira: '2026-10-20T08:00:00-03:00' });

  const cms = entre(a.ultimo(), 'in0')!;
  const firmado = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms))) as unknown as { rawCapture: { content: { value: { value: string }[] } } };
  assert.match(String(firmado.rawCapture.content.value[0].value), /<service>wsfe<\/service>/);
  await assert.rejects(obtenerTicketAcceso({ certPem: '', keyPem: '', ambiente: 'homologacion', fetch: a.fetchFn }), { tipo: 'config' });
});

const envolver = (persona: string) => '<soap:Envelope><soap:Body><ns2:getPersonaResponse>'
  + `<personaReturn>${persona}</personaReturn></ns2:getPersonaResponse></soap:Body></soap:Envelope>`;

test('padrón: doble escape, monotributo sin confundir la categoría, y solo producción', async () => {
  const xml = envolver('<datosGenerales><apellido>PE&amp;#209;A</apellido><nombre>JUAN</nombre>'
    + '<domicilioFiscal><direccion>CALLE FALSA 123</direccion><localidad>ROSARIO</localidad>'
    + '<descripcionProvincia>SANTA FE</descripcionProvincia><codPostal>2000</codPostal></domicilioFiscal>'
    + '<estadoClave>ACTIVO</estadoClave><tipoPersona>FISICA</tipoPersona></datosGenerales>'
    + '<datosMonotributo><categoriaMonotributo><idImpuesto>20</idImpuesto></categoriaMonotributo>'
    + '<impuesto><descripcionImpuesto>MONOTRIBUTO</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto>'
    + '<idImpuesto>20</idImpuesto></impuesto></datosMonotributo>');
  const p = parsearPadron(xml);
  assert.equal(p.apellido, 'PEÑA');
  assert.equal(p.domicilio.localidad, 'ROSARIO');
  assert.deepEqual(p.impuestos, [{ id: 20, descripcion: 'MONOTRIBUTO', estado: 'AC' }]);
  assert.equal(condicionIvaDePadron(p.impuestos), 'monotributista');
  assert.deepEqual(parsearPadron(envolver('<errorConstancia><error>La clave se encuentra inactiva</error></errorConstancia>')).errores,
    ['La clave se encuentra inactiva']);
  assert.throws(() => parsearPadron('<r/>'));

  const a = arcaFalso(xml);
  await assert.rejects(consultarPadron({ ta: TA, cuit: BASE.cuit, ambiente: 'homologacion', cuitConsultado: '27222222228', fetch: a.fetchFn }), { tipo: 'config' });
  assert.equal(await consultarPadron({ ta: TA, cuit: BASE.cuit, ambiente: 'produccion', cuitConsultado: '27222222228', fetch: a.fetchFn }), xml);
});

test('padrón: reintenta los cortes de red (solo lectura), no los rechazos', async () => {
  let n = 0;
  const intermitente = (async () => { if (++n < 3) throw new Error('fetch failed'); return new Response('<ok/>'); }) as unknown as Fetch;
  assert.equal(await consultarPadron({ ta: TA, cuit: BASE.cuit, ambiente: 'produccion', cuitConsultado: '1', fetch: intermitente }), '<ok/>');
  const rechazo = arcaFalso('<s><faultstring>No existe persona</faultstring></s>', 500);
  await assert.rejects(consultarPadron({ ta: TA, cuit: BASE.cuit, ambiente: 'produccion', cuitConsultado: '1', fetch: rechazo.fetchFn }), { tipo: 'arca' });
  assert.equal(rechazo.pedidos.length, 1);
});

test('ticket inválido y reintentables: red y token sí, rechazo por datos no', () => {
  assert.ok(esErrorDeToken(new ErrorArca('x', { codigos: [600] })));
  assert.ok(esErrorDeToken(new ErrorArca('El CEE ya posee un TA valido para el acceso al WSN solicitado')));
  assert.ok(!esErrorDeToken(new ErrorArca('10016: Fecha anterior', { codigos: [10016] })));
  assert.ok(esReintentable(new ErrorArca('sin red', { tipo: 'red' })));
  assert.ok(!esReintentable(new ErrorArca('10016: Fecha anterior', { codigos: [10016] })));
  assert.ok(!esReintentable(null));
});

// Sin esto, el WSFEv1 de producción corta con "dh key too small"; homologación no lo muestra.
test('TLS: Diffie-Hellman excluido de los ciphers por defecto', () => {
  assert.match(tls.DEFAULT_CIPHERS, /!DH/);
});
