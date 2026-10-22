// Correr: npm test. ARCA es un fetch falso: nada sale a la red. Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import forge from 'node-forge';
import { abrirDb } from './db.ts';
import { crearApp } from './app.ts';
import type { Fetch } from './cotizacion.ts';

async function conApi(db: DatabaseSync, fn: (base: string) => Promise<void>, opciones?: Parameters<typeof crearApp>[2]) {
  const server = crearApp(db, '0.0.0', opciones).listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}
const llamar = async (base: string, metodo: string, ruta: string, cuerpo?: unknown) => {
  const r = await fetch(`${base}/api/${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return { status: r.status, body: await r.json() };
};

test('datos fiscales: propone lo del Excel, valida el CUIT y guarda', async () => {
  const db = abrirDb(':memory:');
  db.exec(`INSERT INTO propietario(nombre, documento, cuit, categoria_fiscal) VALUES
    ('Pérez, Ana', 'DNI N°11.111.111 / otro', '20-11111111-2', 'RM'),
    ('Gómez, Luis', 'DNI N°22.222.222', NULL, 'CF')`);
  await conApi(db, async (base) => {
    const uno = (await llamar(base, 'GET', 'propietarios/1/fiscal')).body;
    assert.deepEqual([uno.propuesto, uno.razon_social, uno.doc_tipo, uno.doc_nro, uno.condicion_iva], [true, 'Pérez, Ana', 80, '20111111112', 'monotributista']);
    const dos = (await llamar(base, 'GET', 'propietarios/2/fiscal')).body;
    assert.deepEqual([dos.doc_tipo, dos.doc_nro, dos.condicion_iva], [96, '22222222', 'consumidor_final']);

    const datos = { razon_social: 'PEREZ ANA', doc_tipo: 80, doc_nro: '20-11111111-3', condicion_iva: 'monotributista', domicilio: 'Calle Falsa 123' };
    assert.match((await llamar(base, 'PUT', 'propietarios/1/fiscal', datos)).body.error, /CUIT no es válido/);
    assert.match((await llamar(base, 'PUT', 'propietarios/1/fiscal', { ...datos, doc_tipo: 96, doc_nro: '11111111' })).body.error, /con CUIT, no con DNI/);
    assert.equal((await llamar(base, 'PUT', 'propietarios/1/fiscal', { ...datos, doc_nro: '20-11111111-2' })).status, 200);
    const guardado = (await llamar(base, 'GET', 'propietarios/1/fiscal')).body;
    assert.deepEqual([guardado.propuesto, guardado.razon_social, guardado.doc_nro], [false, 'PEREZ ANA', '20111111112']);
    assert.equal((db.prepare(`SELECT count(*) n FROM auditoria WHERE tabla = 'propietario'`).get() as { n: number }).n, 1);
  });
});

test('datos para pagarle: CBU o alias válidos, mails, moneda y comisión de cobro; Hornera no lleva CBU', async () => {
  const db = abrirDb(':memory:');
  db.exec(`INSERT INTO propietario(nombre, cbu, es_hornera) VALUES ('Pérez, Ana', NULL, 0), ('Nosotros', NULL, 1)`);
  await conApi(db, async (base) => {
    const datos = { cbu: '0110 1238 1234567890123-3', mails: 'ana@ejemplo.com,  otro@ejemplo.com', moneda_liquidacion: 'USD', comision_cobro_usd_pct: 0.04 };
    assert.match((await llamar(base, 'PUT', 'propietarios/1/pago', { ...datos, cbu: '0110123812345678901234' })).body.error, /dígito verificador/);
    assert.match((await llamar(base, 'PUT', 'propietarios/1/pago', { ...datos, mails: 'ana@ejemplo' })).body.error, /"ana@ejemplo" no es un mail/);
    assert.match((await llamar(base, 'PUT', 'propietarios/1/pago', { ...datos, moneda_liquidacion: 'EUR' })).body.error, /ARS o USD/);
    assert.equal((await llamar(base, 'PUT', 'propietarios/1/pago', datos)).status, 200);
    assert.deepEqual((await llamar(base, 'GET', 'propietarios/1/pago')).body,
      { cbu: '0110123812345678901233', es_hornera: 0, mails: 'ana@ejemplo.com; otro@ejemplo.com', moneda_liquidacion: 'USD', comision_cobro_usd_pct: 0.04 });

    // Alias; con pesos la comisión de cobro queda en 0.
    assert.equal((await llamar(base, 'PUT', 'propietarios/1/pago', { cbu: 'ana.perez.banco', mails: '', moneda_liquidacion: 'ARS', comision_cobro_usd_pct: 0.04 })).status, 200);
    assert.deepEqual({ ...(db.prepare('SELECT cbu, mails, comision_cobro_usd_pct FROM propietario WHERE id = 1').get() as object) },
      { cbu: 'ana.perez.banco', mails: null, comision_cobro_usd_pct: 0 });

    assert.equal((await llamar(base, 'PUT', 'propietarios/2/pago', { ...datos, cbu: '0110123812345678901233' })).status, 200);
    assert.equal((db.prepare('SELECT cbu FROM propietario WHERE id = 2').get() as { cbu: string | null }).cbu, null);
    assert.equal((db.prepare(`SELECT count(*) n FROM auditoria WHERE tabla = 'propietario'`).get() as { n: number }).n, 3);
  });
});

// Certificado autofirmado como los de ARCA: el CUIT va en el serialNumber del sujeto.
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

const PADRON_INSCRIPTO = '<soap:Envelope><soap:Body><ns2:getPersonaResponse><personaReturn><datosGenerales><apellido>GOMEZ</apellido>'
  + '<domicilioFiscal><codPostal>2000</codPostal><descripcionProvincia>SANTA FE</descripcionProvincia><direccion>CALLE FALSA 123</direccion>'
  + '<localidad>ROSARIO</localidad></domicilioFiscal><estadoClave>ACTIVO</estadoClave><nombre>ANA</nombre><tipoPersona>FISICA</tipoPersona>'
  + '</datosGenerales><datosRegimenGeneral><impuesto><descripcionImpuesto>IVA</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto>'
  + '<idImpuesto>30</idImpuesto></impuesto></datosRegimenGeneral></personaReturn></ns2:getPersonaResponse></soap:Body></soap:Envelope>';

test('padrón: solo en producción, devuelve los datos sin guardar', async () => {
  const db = abrirDb(':memory:');
  db.exec(`INSERT INTO propietario(nombre) VALUES ('Gómez, Ana')`);
  const guardadas = new Map<string, string>();
  const claves = { leer: (c: string) => guardadas.get(c) ?? null, guardar: (c: string, k: string) => { guardadas.set(c, k); } };
  let padron = PADRON_INSCRIPTO;
  const fetchArca = (async (url: string) => {
    if (url.includes('wsaa')) {
      const expira = new Date(Date.now() + 12 * 3_600_000).toISOString();
      const ta = `<loginTicketResponse><token>TK</token><sign>SG</sign><expirationTime>${expira}</expirationTime></loginTicketResponse>`;
      return new Response(`<r><loginCmsReturn>${ta.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></r>`);
    }
    return new Response(padron);
  }) as unknown as Fetch;
  await conApi(db, async (base) => {
    const emisor = { nombre: 'Emisor Uno', razon_social: 'PRUEBA UNO', cuit: '20111111112', condicion_iva: 'monotributista', punto_venta: 3, ambiente: 'homologacion' };
    const { body: { id } } = await llamar(base, 'POST', 'emisores', emisor);
    assert.match((await llamar(base, 'POST', 'propietarios/1/padron', { cuit: '27222222228' })).body.error, /solo está disponible en producción/);

    await llamar(base, 'PUT', `emisores/${id}`, { ...emisor, ambiente: 'produccion' });
    assert.match((await llamar(base, 'POST', 'propietarios/1/padron', { cuit: '27222222228' })).body.error, /Falta cargar el certificado/);
    await llamar(base, 'POST', `emisores/${id}/certificado`, certificado(emisor.cuit));
    assert.match((await llamar(base, 'POST', 'propietarios/1/padron', { cuit: '27222222229' })).body.error, /CUIT no es válido/);

    const r = await llamar(base, 'POST', 'propietarios/1/padron', { cuit: '27-22222222-8' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { razon_social: 'GOMEZ ANA', doc_tipo: 80, doc_nro: '27222222228', condicion_iva: 'responsable_inscripto',
      domicilio: 'CALLE FALSA 123, ROSARIO, SANTA FE, CP 2000', estado_clave: 'ACTIVO', dni: '22222222' });
    assert.equal((db.prepare('SELECT fiscal_razon_social FROM propietario').get() as { fiscal_razon_social: string | null }).fiscal_razon_social, null);

    padron = '<soap:Envelope><soap:Body><soap:Fault><faultstring>No existe persona con ese Id</faultstring></soap:Fault></soap:Body></soap:Envelope>';
    assert.match((await llamar(base, 'POST', 'propietarios/1/padron', { cuit: '27222222228' })).body.error, /no tiene registrado ese CUIT/);
  }, { claves, fetchArca });
});
