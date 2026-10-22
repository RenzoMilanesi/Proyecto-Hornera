// Correr: npm test. Un pedido "de otra PC" se simula con la IP de LAN de esta PC
// (remoteAddress no es 127.0.0.1); sin red, el test se saltea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { abrirDb } from './db.ts';
import { crearApp } from './app.ts';
import { nombresDeEstaPc } from './terminales.ts';

// Escucha en todas las interfaces, como el servidor real (con host, listen es asíncrono).
const levantar = (db = abrirDb(':memory:')) => new Promise<Server>((ok) => { const s = crearApp(db, '0.0.0').listen(0, '0.0.0.0', () => ok(s)); });

const ip = nombresDeEstaPc().find((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n));

test('una terminal necesita emparejarse; el código sirve una vez y se revoca', { skip: !ip && 'sin IPv4 de LAN' }, async () => {
  const db = abrirDb(':memory:');
  const server = await levantar(db);
  try {
    const { port } = server.address() as AddressInfo;
    const local = `http://127.0.0.1:${port}/api`;
    const lan = `http://${ip}:${port}/api`;
    const json = { 'Content-Type': 'application/json' };
    const emparejar = (codigo: string, cookie?: string) => fetch(`${lan}/terminales/emparejar`, {
      method: 'POST', headers: json, body: JSON.stringify({ codigo, nombre: 'PC Dos' }),
    }).then(async (r) => ({ status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], ...(await r.json()) }));

    // Sin emparejar: la API se niega, y lo de administrar terminales es solo local.
    assert.equal((await fetch(`${lan}/deptos`)).status, 401);
    assert.equal((await fetch(`${lan}/terminales/codigo`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${local}/estado`).then((r) => r.json())).local, true);

    assert.equal((await emparejar('123456')).status, 400); // no hay código vigente
    const { valor } = await (await fetch(`${local}/terminales/codigo`, { method: 'POST' })).json();
    const malo = valor === '000000' ? '000001' : '000000';
    assert.equal((await emparejar(malo)).error, 'Código incorrecto');
    const ok = await emparejar(valor);
    assert.equal(ok.status, 200);
    assert.match(ok.cookie!, /^hornera_terminal=/);
    assert.equal((await emparejar(valor)).status, 400); // ya se usó

    const conCookie = (ruta: string, init: RequestInit = {}) => fetch(`${lan}/${ruta}`, { ...init, headers: { ...init.headers, cookie: ok.cookie! } });
    assert.equal((await conCookie('deptos')).status, 200);
    assert.equal((await conCookie('estado').then((r) => r.json())).local, false);
    // Aun emparejada, no administra terminales ni carga la clave de Stays.
    assert.equal((await conCookie('terminales')).status, 403);
    assert.equal((await conCookie('stays/credenciales', { method: 'PUT', headers: json, body: '{"usuario":"u","clave":"c"}' })).status, 403);

    // La auditoría registra el nombre de la terminal.
    await conCookie('cuentas', { method: 'POST', headers: json, body: JSON.stringify({ nombre: 'Caja', moneda: 'ARS' }) });
    assert.equal((db.prepare(`SELECT pc FROM auditoria WHERE tabla = 'cuenta'`).get() as { pc: string }).pc, 'PC Dos');

    const { terminales } = await (await fetch(`${local}/terminales`)).json();
    assert.deepEqual(terminales.map((t: { nombre: string }) => t.nombre), ['PC Dos']);
    await fetch(`${local}/terminales/${terminales[0].id}/revocar`, { method: 'POST' });
    assert.equal((await conCookie('deptos')).status, 401);
    // Emparejar y revocar quedan en la auditoría.
    const terminal = db.prepare(`SELECT pc, accion, despues_json FROM auditoria WHERE tabla = 'terminal' ORDER BY id`).all() as { pc: string; accion: string; despues_json: string | null }[];
    assert.deepEqual(terminal.map((x) => [x.pc, x.accion]), [['PC Dos', 'alta'], [terminal[1]?.pc, 'anulacion']]);
    assert.equal(JSON.parse(terminal[0].despues_json!).direccion, ip);
  } finally {
    server.close();
  }
});

test('a los 5 intentos fallidos el código deja de servir', { skip: !ip && 'sin IPv4 de LAN' }, async () => {
  const server = await levantar();
  try {
    const { port } = server.address() as AddressInfo;
    const { valor } = await (await fetch(`http://127.0.0.1:${port}/api/terminales/codigo`, { method: 'POST' })).json();
    const probar = (codigo: string) => fetch(`http://${ip}:${port}/api/terminales/emparejar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo }),
    }).then((r) => r.status);
    const malo = valor === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) assert.equal(await probar(malo), 400);
    assert.equal(await probar(valor), 400);
  } finally {
    server.close();
  }
});
