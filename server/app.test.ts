// Correr: npm test
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { abrirDb, VERSION_ESQUEMA } from './db.ts';
import { crearApp } from './app.ts';
import { hacerBackup, respaldar, MAX_BACKUPS } from './backup.ts';

// Carpeta temporal que se borra al terminar el test.
function temporal(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'hornera-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Levanta la API en un puerto libre, corre `fn` con la URL base y la cierra.
async function conApi(db: DatabaseSync, fn: (base: string, port: number) => Promise<void>, opciones?: Parameters<typeof crearApp>[2]) {
  const server = crearApp(db, '0.0.0', opciones).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`, port);
  } finally {
    server.close();
  }
}

// Pedido con headers que fetch no deja poner (Host, Sec-Fetch-Site).
const pedido = (port: number, metodo: string, ruta: string, headers: Record<string, string>) => new Promise<number>((ok, error) => {
  request({ port, host: '127.0.0.1', method: metodo, path: ruta, headers }, (res) => {
    res.resume();
    ok(res.statusCode!);
  }).on('error', error).end();
});

const periodo = (db: DatabaseSync, mes: string, inicio: string, cierre: string) => db.prepare(`
  INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, costo_hora_limpieza,
    servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base,
    adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd)
  VALUES (?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`).run(mes, inicio, cierre, cierre, cierre);

test('la API lista deptos con su propietario', () => {
  const db = abrirDb(':memory:');
  db.exec(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
           INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1)`);
  return conApi(db, async (base) => {
    const deptos = await (await fetch(`${base}/api/deptos`)).json();
    assert.deepEqual(deptos.map((d: any) => [d.codigo, d.propietario]), [['AAA', 'Propietario Uno']]);
  });
});

test('la API rechaza pedidos con un Host ajeno (DNS rebinding)', () => conApi(abrirDb(':memory:'), async (_base, port) => {
  assert.equal(await pedido(port, 'GET', '/api/estado', { host: 'atacante.com' }), 403);
  assert.equal(await pedido(port, 'GET', '/api/estado', { host: `atacante.com:${port}` }), 403);
  assert.equal(await pedido(port, 'GET', '/api/estado', { host: `127.0.0.1:${port}` }), 200);
  assert.equal(await pedido(port, 'GET', '/api/estado', { host: `localhost:${port}` }), 200);
}));

test('la API rechaza escrituras que el navegador marca como de otro sitio', () => conApi(abrirDb(':memory:'), async (_base, port) => {
  const host = `127.0.0.1:${port}`;
  assert.equal(await pedido(port, 'POST', '/api/stays/sincronizar', { host, 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await pedido(port, 'PUT', '/api/stays/credenciales', { host, 'sec-fetch-site': 'same-site' }), 403);
  // Desde la propia app (o sin el header, fuera de un navegador) pasa y responde según la ruta.
  assert.equal(await pedido(port, 'POST', '/api/stays/sincronizar', { host, 'sec-fetch-site': 'same-origin' }), 400);
  assert.equal(await pedido(port, 'GET', '/api/estado', { host, 'sec-fetch-site': 'cross-site' }), 200);
}));

test('los errores de la API vuelven como JSON', () => {
  const db = abrirDb(':memory:');
  return conApi(db, async (base) => {
    const noExiste = await fetch(`${base}/api/nada`);
    assert.equal(noExiste.status, 404);
    assert.match((await noExiste.json()).error, /No existe GET \/api\/nada/);

    const sinArchivo = await fetch(`${base}/api/importar/excel`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal(sinArchivo.status, 400);
    assert.match((await sinArchivo.json()).error, /Falta el archivo/);

    db.close(); // cualquier consulta falla
    const falla = await fetch(`${base}/api/deptos`);
    assert.equal(falla.status, 500);
    assert.equal(typeof (await falla.json()).error, 'string');
  });
});

test('reservas del período: las que tienen noches en él o llegan en él, con lo cobrado neto', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-05', '2026-05-01', '2026-06-01');
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda, descuenta_comision) VALUES ('mp', 'MP', 'mercadopago', 'ARS', 1);
    INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en) VALUES
      ('CRUZA', 1, '2026-04-28', '2026-05-03', 'ARS', '{}', 'x'),
      ('ABRIL', 1, '2026-04-20', '2026-05-01', 'ARS', '{}', 'x'),
      ('CANCELADA', 1, '2026-05-31', '2026-05-31', 'ARS', '{}', 'x'),
      ('JUNIO', 1, '2026-06-01', '2026-06-04', 'ARS', '{}', 'x');
    INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, comision, raw_json) VALUES
      ('p1', 1, 1, 'credit', 'completed', 100000, 5000, '{}'),
      ('p2', 1, 1, 'credit', 'pending', 70000, NULL, '{}');`);
  return conApi(db, async (base) => {
    const filas = await (await fetch(`${base}/api/reservas?mes=2026-05`)).json();
    assert.deepEqual(filas.map((r: any) => [r.codigo, r.cobrado_ars]), [['CRUZA', 95000], ['CANCELADA', 0]]);
    assert.deepEqual(await (await fetch(`${base}/api/reservas?mes=2030-01`)).json(), []);
  });
});

test('credenciales de Stays: se guardan, la clave no vuelve y sin ellas no se sincroniza', () => {
  let guardadas: { usuario: string; clave: string } | null = null;
  const credenciales = { leer: () => guardadas, guardar: (c: { usuario: string; clave: string }) => { guardadas = c; } };
  return conApi(abrirDb(':memory:'), async (base) => {
    const json = { 'Content-Type': 'application/json' };
    const sincronizar = () => fetch(`${base}/api/stays/sincronizar`, { method: 'POST', headers: json, body: '{"mes":"2026-05"}' });

    assert.equal((await sincronizar()).status, 400);
    assert.equal((await fetch(`${base}/api/stays/credenciales`, { method: 'PUT', headers: json, body: '{"usuario":"u"}' })).status, 400);
    const put = await fetch(`${base}/api/stays/credenciales`, { method: 'PUT', headers: json, body: '{"usuario":" u ","clave":"secreta"}' });
    assert.deepEqual(await put.json(), { usuario: 'u' });
    assert.deepEqual(guardadas, { usuario: 'u', clave: 'secreta' });
    assert.equal(await (await fetch(`${base}/api/stays`)).text(), '{"usuario":"u"}');
    // Con credenciales pero sin períodos: el error es del negocio, no de credenciales.
    assert.match((await (await sincronizar()).json()).error, /importá primero el Excel/);
  }, { credenciales });
});

test('"traer mes": uno por vez, y la clave solo viaja a una URL de Stays permitida', async (t) => {
  let pedidosAStays = 0;
  const staysLento = createServer((_req, res) => { pedidosAStays++; setTimeout(() => res.writeHead(401).end(), 300); }).listen(0);
  t.after(() => staysLento.close());
  const db = abrirDb(':memory:');
  periodo(db, '2026-04', '2026-04-01', '2026-05-01');
  const credenciales = { leer: () => ({ usuario: 'u', clave: 'c' }), guardar: () => {} };
  await conApi(db, async (base) => {
    const sincronizar = () => fetch(`${base}/api/stays/sincronizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"mes":"2026-05"}' });
    const estados = (await Promise.all([sincronizar(), sincronizar()])).map((r) => r.status).sort();
    assert.deepEqual(estados, [400, 409]); // el primero termina con "Stays rechazó…", el segundo ni arranca

    const antes = pedidosAStays;
    db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('stays.url', 'http://otro-sitio.com')`).run();
    const r = await sincronizar();
    assert.match((await r.json()).error, /URL de Stays no permitida/);
    assert.equal(pedidosAStays, antes);
  }, { credenciales, urlStays: `http://127.0.0.1:${(staysLento.address() as AddressInfo).port}` });
});

test('abrir una base existente no vuelve a crear el esquema', (t) => {
  const ruta = join(temporal(t), 'h.db');
  const a = abrirDb(ruta);
  a.exec(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno')`);
  a.close();
  const b = abrirDb(ruta);
  assert.equal((b.prepare('SELECT count(*) n FROM propietario').get() as any).n, 1);
  b.close();
});

test('una base del esquema 1 migrada queda igual que una base nueva', (t) => {
  // El esquema 1 es el actual con la tabla liquidacion como era antes de la migración 1 → 2.
  const actual = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const v1 = actual
    .replace(/^\s*conversion_usd .*\r?\n/m, '')
    .replace(/saldo_final_ars\s+INTEGER NOT NULL,\s*\r?\n\s*saldo_final_usd\s+INTEGER NOT NULL,/, 'saldo_final INTEGER NOT NULL,');
  assert.notEqual(v1, actual);
  const ruta = join(temporal(t), 'v1.db');
  const vieja = new DatabaseSync(ruta);
  vieja.exec(`${v1}; PRAGMA user_version = 1;`);
  vieja.close();

  const forma = (db: DatabaseSync) => JSON.stringify(db.prepare(`
    SELECT s.type, s.name, (SELECT group_concat(c.name || ':' || c."notnull", ',') FROM
      (SELECT name, "notnull" FROM pragma_table_info(s.name) ORDER BY name) c) AS columnas
    FROM sqlite_schema s WHERE s.name NOT LIKE 'sqlite_%' ORDER BY s.type, s.name`).all());
  const migrada = abrirDb(ruta);
  const nueva = abrirDb(':memory:');
  assert.equal((migrada.prepare('PRAGMA user_version').get() as any).user_version, VERSION_ESQUEMA);
  assert.equal(forma(migrada), forma(nueva));
  migrada.close();
});

test('una base del esquema 1 conserva sus datos al migrar', (t) => {
  const ruta = join(temporal(t), 'v1.db');
  const v1 = new DatabaseSync(ruta);
  v1.exec(`CREATE TABLE liquidacion (id INTEGER PRIMARY KEY, conversion_ars INTEGER NOT NULL, saldo_final INTEGER NOT NULL) STRICT;
           INSERT INTO liquidacion VALUES (1, 0, 500); PRAGMA user_version = 1;`);
  v1.close();
  const db = abrirDb(ruta);
  assert.deepEqual({ ...(db.prepare('SELECT saldo_final_ars, saldo_final_usd, conversion_usd FROM liquidacion').get() as any) },
    { saldo_final_ars: 500, saldo_final_usd: 0, conversion_usd: 0 });
  db.close();
});

test('si una migración falla, la base queda como estaba', (t) => {
  const ruta = join(temporal(t), 'v1-rara.db');
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

test('el backup conserva solo las últimas copias', (t) => {
  const db = abrirDb(':memory:');
  const carpeta = temporal(t);
  for (let i = 0; i < MAX_BACKUPS + 2; i++) hacerBackup(db, carpeta, new Date(2026, 0, 1, 0, 0, i));
  const copias = readdirSync(carpeta).sort();
  assert.equal(copias.length, MAX_BACKUPS);
  assert.equal(copias[0], 'hornera-2026-01-01T00-00-02-000.db');
});

test('si la carpeta de backup configurada falla o es de otra PC, la copia queda en la por defecto', (t) => {
  const db = abrirDb(':memory:');
  const tmp = temporal(t);
  const porDefecto = join(tmp, 'backups');
  const configurar = (carpeta: string) => db.prepare(`INSERT OR REPLACE INTO configuracion(clave, valor) VALUES ('backup.carpeta', ?)`).run(carpeta);

  const noEsCarpeta = join(tmp, 'drive');
  writeFileSync(noEsCarpeta, ''); // un archivo donde debería haber una carpeta
  configurar(noEsCarpeta);
  assert.throws(() => respaldar(db, porDefecto), (e: Error) => e.message.includes(porDefecto));
  assert.equal(readdirSync(porDefecto).length, 1);

  configurar('\\\\servidor\\backups'); // \\servidor\backups: no se toca la red
  assert.throws(() => respaldar(db, porDefecto), (e: Error) => e.message.includes('otras PCs de la red') && e.message.includes(porDefecto));
  assert.equal(readdirSync(porDefecto).length, 2);

  db.prepare(`DELETE FROM configuracion`).run();
  assert.match(respaldar(db, porDefecto), /hornera-.*\.db$/); // sin configurar: va directo a la por defecto
});
