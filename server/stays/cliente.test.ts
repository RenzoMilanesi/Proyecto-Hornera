// Correr: npm test. Sin red: fetch falso.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearClienteStays } from './cliente.ts';

// Error como el de undici cuando la conexión no abre.
const sinConexion = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
const cliente = crearClienteStays({ usuario: 'u', clave: 'c' }, 'https://prueba.stays.net/external/v1');

test('Stays: un corte de conexión se reintenta; si sigue, el error dice qué pasó y no "fetch failed"', async (t) => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++n < 3) throw sinConexion();
    return Response.json([{ _id: 'p1' }]);
  });
  assert.deepEqual(await cliente.pagos('AB01C'), [{ _id: 'p1' }]);
  assert.equal(n, 3);

  n = 0;
  mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { n++; throw sinConexion(); });
  await assert.rejects(cliente.pagos('AB01C'), (e: Error) =>
    /No se pudo conectar con Stays \(UND_ERR_CONNECT_TIMEOUT\)/.test(e.message) && !e.message.includes('fetch failed'));
  assert.equal(n, 3);
});

test('Stays: el timeout de 60 s y una clave rechazada no se reintentan', async (t) => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => { n++; throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); });
  await assert.rejects(cliente.pagos('AB01C'), /No se pudo conectar con Stays/);
  assert.equal(n, 1);

  n = 0;
  mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { n++; return new Response('', { status: 401 }); });
  await assert.rejects(cliente.pagos('AB01C'), /rechazó el usuario o la clave/);
  assert.equal(n, 1);
});
