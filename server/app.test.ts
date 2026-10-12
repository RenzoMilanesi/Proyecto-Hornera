// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { abrirDb, VERSION_ESQUEMA } from './db.ts';
import { crearApp } from './app.ts';
import { hacerBackup, respaldar, MAX_BACKUPS } from './backup.ts';

// Levanta la API en un puerto libre, corre `fn` con la URL base y la cierra.
async function conApi(db: DatabaseSync, fn: (base: string, port: number) => Promise<void>) {
  const server = crearApp(db, '0.0.0').listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`, port);
  } finally {
    server.close();
  }
}

test('la API lista deptos con su propietario', () => {
  const db = abrirDb(':memory:');
  db.exec(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
           INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('OVL', 'Hornera Lagos', 1)`);
  return conApi(db, async (base) => {
    const deptos = await (await fetch(`${base}/api/deptos`)).json();
    assert.deepEqual(deptos.map((d: any) => [d.codigo, d.propietario]), [['OVL', 'Propietario Uno']]);
  });
});

test('la API rechaza pedidos con un Host ajeno (DNS rebinding)', () => {
  // fetch no deja cambiar el Host: se usa http.request.
  const estado = (port: number, host: string) => new Promise<number>((ok, error) => {
    request({ port, host: '127.0.0.1', path: '/api/estado', headers: { host } }, (res) => {
      res.resume();
      ok(res.statusCode!);
    }).on('error', error).end();
  });
  return conApi(abrirDb(':memory:'), async (_base, port) => {
    assert.equal(await estado(port, 'atacante.com'), 403);
    assert.equal(await estado(port, `atacante.com:${port}`), 403);
    assert.equal(await estado(port, `127.0.0.1:${port}`), 200);
    assert.equal(await estado(port, `localhost:${port}`), 200);
  });
});

test('los errores de la API vuelven como JSON', () => {
  const db = abrirDb(':memory:');
  return conApi(db, async (base) => {
    const noExiste = await fetch(`${base}/api/nada`);
    assert.equal(noExiste.status, 404);
    assert.match((await noExiste.json()).error, /No existe GET \/api\/nada/);

    db.close(); // cualquier consulta falla
    const falla = await fetch(`${base}/api/deptos`);
    assert.equal(falla.status, 500);
    assert.equal(typeof (await falla.json()).error, 'string');
  });
});

test('credenciales de Stays: se guardan, la clave no vuelve y sin ellas no se sincroniza', async () => {
  let guardadas: { usuario: string; clave: string } | null = null;
  const credenciales = { leer: () => guardadas, guardar: (c: { usuario: string; clave: string }) => { guardadas = c; } };
  const server = crearApp(abrirDb(':memory:'), '0.0.0', { credenciales }).listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const json = { 'Content-Type': 'application/json' };
    const sincronizar = () => fetch(`${base}/stays/sincronizar`, { method: 'POST', headers: json, body: '{"mes":"2026-05"}' });

    assert.equal((await sincronizar()).status, 400);
    assert.equal((await fetch(`${base}/stays/credenciales`, { method: 'PUT', headers: json, body: '{"usuario":"u"}' })).status, 400);
    const put = await fetch(`${base}/stays/credenciales`, { method: 'PUT', headers: json, body: '{"usuario":" u ","clave":"secreta"}' });
    assert.deepEqual(await put.json(), { usuario: 'u' });
    assert.deepEqual(guardadas, { usuario: 'u', clave: 'secreta' });
    const estado = await (await fetch(`${base}/stays`)).text();
    assert.equal(estado, '{"usuario":"u"}');
    // Con credenciales pero sin períodos: el error es del negocio, no de credenciales.
    assert.match((await (await sincronizar()).json()).error, /importá primero el Excel/);
  } finally {
    server.close();
  }
});

test('abrir una base existente no vuelve a crear el esquema', () => {
  const ruta = join(mkdtempSync(join(tmpdir(), 'hornera-')), 'h.db');
  abrirDb(ruta).exec(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno')`);
  assert.equal((abrirDb(ruta).prepare('SELECT count(*) n FROM propietario').get() as any).n, 1);
});

test('una base del esquema 1 se migra a la versión actual', () => {
  const ruta = join(mkdtempSync(join(tmpdir(), 'hornera-')), 'v1.db');
  const v1 = new DatabaseSync(ruta);
  v1.exec(`CREATE TABLE liquidacion (id INTEGER PRIMARY KEY, conversion_ars INTEGER NOT NULL, saldo_final INTEGER NOT NULL) STRICT;
           INSERT INTO liquidacion VALUES (1, 0, 500); PRAGMA user_version = 1;`);
  v1.close();
  const db = abrirDb(ruta);
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, VERSION_ESQUEMA);
  assert.deepEqual({ ...(db.prepare('SELECT saldo_final_ars, saldo_final_usd, conversion_usd FROM liquidacion').get() as any) },
    { saldo_final_ars: 500, saldo_final_usd: 0, conversion_usd: 0 });
});

test('si una migración falla, la base queda como estaba', () => {
  const ruta = join(mkdtempSync(join(tmpdir(), 'hornera-')), 'v1-rara.db');
  const v1 = new DatabaseSync(ruta);
  // Sin la columna saldo_final: el RENAME de la migración 1 → 2 falla.
  v1.exec(`CREATE TABLE liquidacion (id INTEGER PRIMARY KEY, otra INTEGER) STRICT; PRAGMA user_version = 1;`);
  v1.close();
  assert.throws(() => abrirDb(ruta), /saldo_final/);
  const db = new DatabaseSync(ruta);
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, 1);
  assert.equal((db.prepare(`SELECT group_concat(name) c FROM pragma_table_info('liquidacion')`).get() as any).c, 'id,otra');
  db.close();
});

test('el backup conserva solo las últimas copias', () => {
  const db = abrirDb(':memory:');
  const carpeta = mkdtempSync(join(tmpdir(), 'hornera-bk-'));
  for (let i = 0; i < MAX_BACKUPS + 2; i++) hacerBackup(db, carpeta, new Date(2026, 0, 1, 0, 0, i));
  const copias = readdirSync(carpeta).sort();
  assert.equal(copias.length, MAX_BACKUPS);
  assert.equal(copias[0], 'hornera-2026-01-01T00-00-02-000.db');
});

test('si la carpeta de backup configurada falla, la copia queda en la por defecto', () => {
  const db = abrirDb(':memory:');
  const tmp = mkdtempSync(join(tmpdir(), 'hornera-bk-'));
  const noEsCarpeta = join(tmp, 'drive');
  writeFileSync(noEsCarpeta, ''); // un archivo donde debería haber una carpeta
  const porDefecto = join(tmp, 'backups');
  db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('backup.carpeta', ?)`).run(noEsCarpeta);

  assert.throws(() => respaldar(db, porDefecto), (e: Error) => e.message.includes(porDefecto));
  assert.equal(readdirSync(porDefecto).length, 1);

  db.prepare(`DELETE FROM configuracion`).run();
  assert.match(respaldar(db, porDefecto), /hornera-.*\.db$/); // sin configurar: va directo a la por defecto
});
