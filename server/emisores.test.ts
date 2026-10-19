// Correr: npm test. ARCA es un fetch falso: nada sale a la red.
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
const json = { 'Content-Type': 'application/json' };
const llamar = async (base: string, metodo: string, ruta: string, cuerpo?: unknown) => {
  const r = await fetch(`${base}/api/${ruta}`, { method: metodo, headers: json, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return { status: r.status, body: await r.json() };
};

// Certificado autofirmado como los de ARCA: el CUIT va en el serialNumber del sujeto.
function certificado(cuit: string, dias = 365) {
  const par = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = par.publicKey;
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + dias * 86_400_000);
  const sujeto = [{ name: 'commonName', value: 'hornera' }, { name: 'serialNumber', value: `CUIT ${cuit}` }];
  c.setSubject(sujeto);
  c.setIssuer(sujeto);
  c.sign(par.privateKey, forge.md.sha256.create());
  return { crt: forge.pki.certificateToPem(c), key: forge.pki.privateKeyToPem(par.privateKey) };
}

function almacen() {
  const guardadas = new Map<string, string>();
  return { guardadas, leer: (cuit: string) => guardadas.get(cuit) ?? null, guardar: (cuit: string, k: string) => { guardadas.set(cuit, k); } };
}

const EMISOR = { nombre: 'Emisor Uno', razon_social: 'PRUEBA UNO', cuit: '20111111112', condicion_iva: 'monotributista',
  punto_venta: 3, ambiente: 'homologacion' };

// ARCA falso: el WSAA da un ticket que vence en 12 h; el WSFE contesta `wsfe`. Cuenta los logins.
function arcaFalso(wsfe = '<r><CbteNro>7</CbteNro></r>') {
  const llamadas = { login: 0, wsfe: 0 };
  const fetchArca = (async (url: string) => {
    if (url.includes('wsaa')) {
      llamadas.login++;
      const expira = new Date(Date.now() + 12 * 3_600_000).toISOString();
      const ta = `<loginTicketResponse><token>TK</token><sign>SG</sign><expirationTime>${expira}</expirationTime></loginTicketResponse>`;
      return new Response(`<r><loginCmsReturn>${ta.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></r>`);
    }
    llamadas.wsfe++;
    return new Response(wsfe);
  }) as unknown as Fetch;
  return { fetchArca, llamadas };
}

test('emisores: alta validada, el CUIT no cambia y cambiar de ambiente borra el certificado', async () => {
  const db = abrirDb(':memory:');
  const claves = almacen();
  await conApi(db, async (base) => {
    assert.match((await llamar(base, 'POST', 'emisores', { ...EMISOR, cuit: '20111111113' })).body.error, /CUIT no es válido/);
    assert.match((await llamar(base, 'POST', 'emisores', { ...EMISOR, punto_venta: 0 })).body.error, /punto de venta/);
    const { body: { id } } = await llamar(base, 'POST', 'emisores', EMISOR);
    assert.match((await llamar(base, 'POST', 'emisores', EMISOR)).body.error, /Ya hay un emisor/);

    assert.equal((await llamar(base, 'POST', `emisores/${id}/certificado`, certificado(EMISOR.cuit))).status, 200);
    const [e] = (await llamar(base, 'GET', 'emisores')).body;
    assert.equal(e.tiene_clave, true);
    assert.equal(e.certificado.alias, 'hornera');
    assert.equal(e.cert_pem, undefined);

    assert.equal((await llamar(base, 'PUT', `emisores/${id}`, { ...EMISOR, cuit: '27222222228', nombre: 'Otro nombre' })).status, 200);
    const editado = (await llamar(base, 'GET', 'emisores')).body[0];
    assert.deepEqual([editado.cuit, editado.nombre, !!editado.certificado], [EMISOR.cuit, 'Otro nombre', true]);

    const cambio = await llamar(base, 'PUT', `emisores/${id}`, { ...EMISOR, ambiente: 'produccion' });
    assert.equal(cambio.body.certificado_borrado, true);
    assert.equal((await llamar(base, 'GET', 'emisores')).body[0].certificado, null);
  }, { claves });
  // La clave privada nunca queda en la base (ni en la auditoría).
  assert.equal(db.prepare(`SELECT count(*) n FROM auditoria WHERE despues_json LIKE '%PRIVATE KEY%' OR antes_json LIKE '%PRIVATE KEY%'`).get()!.n, 0);
  assert.equal(db.prepare(`SELECT count(*) n FROM emisor WHERE cert_pem LIKE '%PRIVATE KEY%'`).get()!.n, 0);
});

test('certificado: la clave tiene que ser del certificado y el certificado del CUIT del emisor', async () => {
  const db = abrirDb(':memory:');
  const claves = almacen();
  await conApi(db, async (base) => {
    const { body: { id } } = await llamar(base, 'POST', 'emisores', EMISOR);
    const a = certificado(EMISOR.cuit);
    const b = certificado(EMISOR.cuit);
    assert.match((await llamar(base, 'POST', `emisores/${id}/certificado`, { crt: a.crt, key: b.key })).body.error, /no corresponde/);
    assert.match((await llamar(base, 'POST', `emisores/${id}/certificado`, certificado('27222222228'))).body.error, /CUIT 27222222228/);
    assert.match((await llamar(base, 'POST', `emisores/${id}/certificado`, certificado(EMISOR.cuit, -2))).body.error, /venció/);
    assert.match((await llamar(base, 'POST', `emisores/${id}/certificado`, { crt: 'basura', key: a.key })).body.error, /no es un certificado/);
    assert.equal(claves.guardadas.size, 0);
  }, { claves });
  await conApi(db, async (base) => {
    assert.match((await llamar(base, 'POST', 'emisores/1/certificado', certificado(EMISOR.cuit))).body.error, /no puede guardar la clave/);
  });
});

test('probar: login + último autorizado; el ticket se reusa y uno rechazado se descarta', async () => {
  const db = abrirDb(':memory:');
  const claves = almacen();
  const ok = arcaFalso();
  await conApi(db, async (base) => {
    const { body: { id } } = await llamar(base, 'POST', 'emisores', EMISOR);
    assert.match((await llamar(base, 'POST', `emisores/${id}/probar`)).body.error, /Falta cargar el certificado/);
    await llamar(base, 'POST', `emisores/${id}/certificado`, certificado(EMISOR.cuit));

    assert.deepEqual((await llamar(base, 'POST', `emisores/${id}/probar`)).body, { cbteTipo: 11, ultimo: 7 });
    await llamar(base, 'POST', `emisores/${id}/probar`);
    assert.deepEqual(ok.llamadas, { login: 1, wsfe: 2 });
  }, { claves, fetchArca: ok.fetchArca });

  const rechazado = arcaFalso('<r><Err><Code>600</Code><Msg>ValidacionDeToken: no aparecio CUIT</Msg></Err></r>');
  await conApi(db, async (base) => {
    const r = await llamar(base, 'POST', 'emisores/1/probar');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /600/);
    assert.equal(db.prepare(`SELECT count(*) n FROM configuracion WHERE clave LIKE 'arca.ta.%'`).get()!.n, 0);
  }, { claves, fetchArca: rechazado.fetchArca });

  const sinRed = (async () => { throw new Error('fetch failed'); }) as unknown as Fetch;
  const error = console.error;
  console.error = () => {};
  try {
    await conApi(db, async (base) => {
      assert.equal((await llamar(base, 'POST', 'emisores/1/probar')).status, 502);
    }, { claves, fetchArca: sinRed });
  } finally {
    console.error = error;
  }
});
