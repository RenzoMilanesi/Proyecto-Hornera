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
import { carpetaBackups, elegirCarpeta, hacerBackup, respaldar, ultimasCopias, MAX_BACKUPS } from './backup.ts';

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
    assert.deepEqual(deptos.map((d: any) => [d.codigo, d.propietario, d.fotos]), [['AAA', 'Propietario Uno', []]]);
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
  // El esquema 1 es el actual con la tabla liquidacion como era antes de la migración 1 → 2
  // y sin la tabla terminal (3 → 4) ni las fotos del depto (4 → 5) ni el vínculo del propietario con Stays (5 → 6)
  // ni los datos nuevos de la reserva (6 → 7) ni el dueño de la liquidación (7 → 8)
  // ni la fecha de la cotización del período (8 → 9) ni la facturación ARCA (9 → 10)
  // ni lo importado de Mis Comprobantes (10 → 11) ni el origen de los gastos importados (11 → 12) ni la moneda de la liquidación (12 → 13)
  // ni la marca de saldado por fuera (16 → 17) ni los gastos ajenos (17 → 18) ni la ficha del depto (18 → 19) ni la limpieza (19 → 20).
  const actual = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const v1 = actual
    .replace(/^\s*(-- Datos para facturarle|-- que vienen del Excel en texto libre|fiscal_).*\r?\n/gm, '')
    .replace(/CREATE TABLE (emisor|comprobante|comprobante_arca) \([^;]*;/g, '')
    .replace(/CREATE (UNIQUE )?INDEX (ix|uq)_cbte_[^;]*;/g, '')
    .replace(/CREATE TABLE terminal \([^;]*;/, '')
    .replace(/^\s*conversion_usd .*\r?\n/m, '')
    .replace(/^\s*fotos .*\r?\n/m, '')
    .replace(/^\s*notas .*-- ficha:.*\r?\n/m, '')
    .replace(/CREATE TABLE depto_(servicio|clave|contacto) \([^;]*;|CREATE INDEX ix_(servicio|clave|contacto)_[^;]*;/g, '')
    .replace(/,\s*\r?\n\s*stays_owner_id .*\r?\n/, '\n')
    .replace(/CREATE UNIQUE INDEX uq_propietario_stays[^;]*;/, '')
    .replace(/^\s*propietario_id\s+INTEGER REFERENCES.*\r?\n/m, '')
    .replace(/CREATE INDEX ix_liq_propietario[^;]*;/, '')
    .replace(/^\s*(-- Cancelada en Stays|cancelada |-- Del detalle de la reserva|hora_llegada |hora_salida |desglose_json ).*\r?\n/gm, '')
    .replace(/^\s*(-- Día del valor de la API|usd_cotizacion_fecha |usd_cotizacion_provisoria ).*\r?\n/gm, '')
    .replace(/^\s*origen\s+TEXT,.*\r?\n/m, '')
    .replace(/CREATE UNIQUE INDEX uq_mov_origen[^;]*;/, '')
    .replace(/^\s*moneda .*-- en la que liquidaba el dueño al cerrar\r?\n/m, '')
    .replace(/^\s*(-- Saldado por fuera|saldado_fuera(_nota)? ).*\r?\n/gm, '')
    .replace(/CREATE TABLE gasto_ajeno \([^;]*;|CREATE INDEX ix_ajeno_periodo[^;]*;|CREATE TRIGGER tr_ajeno_[\s\S]*?END;/g, '')
    .replace(/CREATE TABLE (tarea_limpieza|liquidacion_limpieza|liquidacion_limpieza_operaria) \([^;]*;|CREATE INDEX ix_(tarea_limpieza|liq_limpieza)_[^;]*;|CREATE TRIGGER tr_(liq_limpieza_pisa|mov_anulado_libera_liq_limpieza)[\s\S]*?END;/g, '')
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
  v1.exec(`CREATE TABLE depto (id INTEGER PRIMARY KEY, propietario_id INTEGER) STRICT; -- lo tocan las migraciones 4 → 5 y 7 → 8
           CREATE TABLE propietario (id INTEGER PRIMARY KEY, moneda_liquidacion TEXT) STRICT; -- y la 5 → 6 (y la 12 → 13 la lee)
           CREATE TABLE reserva (id INTEGER PRIMARY KEY) STRICT; -- y la 6 → 7
           CREATE TABLE periodo (id INTEGER PRIMARY KEY, usd_cotizacion_fuente TEXT, fecha_cierre_reservas TEXT) STRICT; -- y la 8 → 9 (y la 13 → 14 las lee)
           CREATE TABLE movimiento (id INTEGER PRIMARY KEY) STRICT; -- y la 11 → 12
           CREATE TABLE liquidacion (id INTEGER PRIMARY KEY, depto_id INTEGER, conversion_ars INTEGER NOT NULL, saldo_final INTEGER NOT NULL) STRICT;
           CREATE TABLE auditoria (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, pc TEXT NOT NULL, tabla TEXT NOT NULL, registro_id INTEGER,
             accion TEXT NOT NULL, antes_json TEXT, despues_json TEXT) STRICT; -- y la 15 → 16 la rehace
           INSERT INTO auditoria VALUES (1, '2026-04-02 10:00:00', 'PC-1', 'movimiento', 1, 'alta', NULL, '{}');
           INSERT INTO liquidacion VALUES (1, NULL, 0, 500); PRAGMA user_version = 1;`);
  v1.close();
  const db = abrirDb(ruta);
  assert.deepEqual({ ...(db.prepare('SELECT saldo_final_ars, saldo_final_usd, conversion_usd FROM liquidacion').get() as any) },
    { saldo_final_ars: 500, saldo_final_usd: 0, conversion_usd: 0 });
  assert.equal((db.prepare('SELECT pc FROM auditoria').get() as any).pc, 'PC-1');
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

test('el ticket de acceso de ARCA no viaja en el backup', (t) => {
  const db = abrirDb(':memory:');
  db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('arca.ta.wsfe.homologacion.20111111112', '{"token":"T0K3N"}'), ('pdf.carpeta', 'x')`).run();
  const ruta = hacerBackup(db, temporal(t));
  const copia = new DatabaseSync(ruta);
  assert.deepEqual(copia.prepare('SELECT clave FROM configuracion ORDER BY clave').all().map((f) => f.clave), ['pdf.carpeta']);
  copia.close();
  assert.equal(readFileSync(ruta).includes('T0K3N'), false);
  assert.equal(db.prepare(`SELECT count(*) n FROM configuracion WHERE clave LIKE 'arca.ta.%'`).get()!.n, 1);
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

test('elegir la carpeta de las copias: se guarda solo si la copia de prueba anda', (t) => {
  const db = abrirDb(':memory:');
  const tmp = temporal(t);
  const porDefecto = join(tmp, 'backups');
  const drive = join(tmp, 'drive');

  const r = elegirCarpeta(db, ` ${drive} `);
  assert.equal(r.carpeta, drive);
  assert.equal(readdirSync(drive).length, 1); // la copia de prueba
  assert.deepEqual(carpetaBackups(db, porDefecto), { carpeta: drive, porDefecto, configurada: true });
  assert.ok(respaldar(db, porDefecto).startsWith(drive));

  const noEsCarpeta = join(tmp, 'archivo');
  writeFileSync(noEsCarpeta, '');
  for (const [ruta, error] of [['\\\\otra-pc\\copias', /otras PCs de la red/], ['copias', /ruta completa/], [noEsCarpeta, /No se pudo hacer una copia/]] as const) {
    assert.throws(() => elegirCarpeta(db, ruta), error);
    assert.equal(carpetaBackups(db, porDefecto).carpeta, drive); // la anterior sigue
  }

  assert.deepEqual(elegirCarpeta(db, ''), { carpeta: null });
  assert.deepEqual(carpetaBackups(db, porDefecto), { carpeta: porDefecto, porDefecto, configurada: false });
  assert.ok(respaldar(db, porDefecto).startsWith(porDefecto));
});

test('últimas copias: las 5 más nuevas primero; sin carpeta, ninguna', (t) => {
  const db = abrirDb(':memory:');
  const carpeta = temporal(t);
  for (let i = 0; i < 7; i++) hacerBackup(db, carpeta, new Date(2026, 0, 1, 0, 0, i));
  const copias = ultimasCopias(carpeta);
  assert.equal(copias.length, 5);
  assert.equal(copias[0].archivo, 'hornera-2026-01-01T00-00-06-000.db');
  assert.ok(copias[0].bytes > 0);
  assert.deepEqual(ultimasCopias(join(carpeta, 'no-existe')), []);
});

test('copias de seguridad por la API: carpeta en uso, elegir otra y hacer una copia', async (t) => {
  const db = abrirDb(':memory:');
  const tmp = temporal(t);
  const porDefecto = join(tmp, 'backups');
  await conApi(db, async (base) => {
    const estado = async () => (await fetch(`${base}/api/backup`)).json();
    assert.deepEqual(await estado(), { carpeta: porDefecto, porDefecto, configurada: false, copias: [] });
    const poner = (carpeta: string) => fetch(`${base}/api/backup/carpeta`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carpeta }) });
    assert.equal((await poner('\\\\otra-pc\\copias')).status, 400);
    assert.equal((await poner(join(tmp, 'drive'))).status, 200);
    assert.equal((await fetch(`${base}/api/backup`, { method: 'POST' })).status, 200);
    const e = await estado();
    assert.equal(e.carpeta, join(tmp, 'drive'));
    assert.equal(e.copias.length, 2); // la de prueba y la de "hacer una copia ahora"
  }, { carpetaBackups: porDefecto });
  await conApi(db, async (base) => assert.equal((await fetch(`${base}/api/backup`)).status, 404)); // sin carpeta, no hay rutas
});

test('ajustes de una reserva y cotización del período: validan y quedan en la auditoría', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-04', '2026-04-01', '2026-05-01');
  periodo(db, '2026-05', '2026-05-01', '2026-06-01');
  db.exec(`UPDATE periodo SET estado = 'cerrado' WHERE mes = '2026-04';
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en) VALUES ('R1', 1, '2026-05-02', '2026-05-04', 'ARS', '{}', 'x');`);
  return conApi(db, async (base) => {
    const json = { 'Content-Type': 'application/json' };
    const enviar = (ruta: string, cuerpo: unknown) => fetch(`${base}/api/${ruta}`, { method: 'PUT', headers: json, body: JSON.stringify(cuerpo) });
    const ajustes = { ajuste_ars: -50000, ajuste_usd: 0, ajuste_comision_ars: 1000, ajuste_comision_usd: 0, observacion: ' descuento ', excluida: 0 };

    assert.equal((await enviar('reservas/1', { ...ajustes, ajuste_ars: 1.5 })).status, 400); // centavos enteros
    assert.equal((await enviar('reservas/99', ajustes)).status, 404);
    // Reserva que viene de abril (cerrado): sus ajustes ya están en esa liquidación.
    db.exec(`INSERT INTO reserva(codigo, depto_id, llegada, salida, moneda, raw_json, sincronizada_en) VALUES ('R0', 1, '2026-04-29', '2026-05-02', 'ARS', '{}', 'x')`);
    const cerrada = await enviar('reservas/2', ajustes);
    assert.equal(cerrada.status, 400);
    assert.match((await cerrada.json()).error, /parte del mes cerrado 2026-04/);
    assert.equal((await enviar('reservas/1', ajustes)).status, 200);
    const r = db.prepare(`SELECT ajuste_ars, ajuste_comision_ars, observacion FROM reserva WHERE id = 1`).get() as any;
    assert.deepEqual({ ...r }, { ajuste_ars: -50000, ajuste_comision_ars: 1000, observacion: 'descuento' });

    assert.equal((await enviar('periodos/2026-05/cotizacion', { cotizacion: -1 })).status, 400);
    assert.equal((await enviar('periodos/2026-04/cotizacion', { cotizacion: 1500 })).status, 400); // cerrado
    assert.equal((await enviar('periodos/2026-05/cotizacion', { cotizacion: 1500 })).status, 200);
    assert.equal((db.prepare(`SELECT usd_cotizacion FROM periodo WHERE mes = '2026-05'`).get() as any).usd_cotizacion, 1500);

    const auditoria = db.prepare(`SELECT tabla, accion FROM auditoria ORDER BY id`).all().map((a: any) => `${a.tabla}:${a.accion}`);
    assert.deepEqual(auditoria, ['reserva:modificacion', 'periodo:modificacion']);

    const liq = await (await fetch(`${base}/api/liquidacion?mes=2026-05`)).json();
    assert.deepEqual(liq.deptos.map((d: any) => d.codigo), ['AAA']);
    assert.equal((await fetch(`${base}/api/liquidacion?mes=2030-01`)).status, 400);
  });
});

test('variables operativas del mes y del depto: validan, solo mes abierto y quedan en la auditoría', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-04', '2026-04-01', '2026-05-01');
  periodo(db, '2026-05', '2026-05-01', '2026-06-01');
  db.exec(`UPDATE periodo SET estado = 'cerrado' WHERE mes = '2026-04';
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);`);
  return conApi(db, async (base) => {
    const enviar = (ruta: string, cuerpo: unknown) => fetch(`${base}/api/${ruta}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

    assert.equal((await enviar('periodos/2026-05/parametros', { servicio_limpieza: 1.5 })).status, 400); // centavos enteros
    assert.equal((await enviar('periodos/2026-05/parametros', { noches_tramo_1: 0 })).status, 400);
    assert.equal((await enviar('periodos/2026-05/parametros', { usd_descuento_pct: 1 })).status, 400); // cambio 0
    assert.equal((await enviar('periodos/2026-05/parametros', { estado: 'cerrado' })).status, 400); // campo ajeno: nada que guardar
    assert.equal((await enviar('periodos/2026-04/parametros', { servicio_limpieza: 500000 })).status, 400); // cerrado
    assert.equal((await enviar('periodos/2026-05/parametros', { servicio_limpieza: 500000, usd_descuento_pct: 0.05 })).status, 200);
    const p = await (await fetch(`${base}/api/periodos/2026-05/parametros`)).json();
    assert.deepEqual([p.servicio_limpieza, p.usd_descuento_pct, p.tarifa_base], [500000, 0.05, 1]);

    assert.equal((await enviar('deptos/1', { comision_pct: 1.2 })).status, 400);
    assert.equal((await enviar('deptos/1', { comision_pct: 0.18, tarifa_base_override: 900000 })).status, 200);
    assert.equal((await enviar('deptos/1', { tarifa_base_override: null })).status, 200); // vuelve a la del mes
    const d = db.prepare(`SELECT comision_pct, tarifa_base_override FROM depto WHERE id = 1`).get() as any;
    assert.deepEqual({ ...d }, { comision_pct: 0.18, tarifa_base_override: null });

    const auditoria = db.prepare(`SELECT tabla, antes_json, despues_json FROM auditoria ORDER BY id`).all() as any[];
    assert.equal(auditoria.length, 3);
    assert.deepEqual(JSON.parse(auditoria[0].antes_json), { servicio_limpieza: 1, usd_descuento_pct: 0.06 });
  });
});

test('cotización: "Pedir a la API" pisa la manual; API caída da 502', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-05', '2026-05-01', '2026-06-01');
  db.exec(`UPDATE periodo SET usd_cotizacion = 1400, usd_cotizacion_fuente = 'manual'`);
  let caida = false;
  const fetchDolar = (async () => (caida ? Promise.reject(new Error('fetch failed')) : Response.json({ venta: 1612.31 }))) as unknown as typeof fetch;
  return conApi(db, async (base) => {
    const traer = (mes: string) => fetch(`${base}/api/periodos/${mes}/cotizacion/traer`, { method: 'POST' });
    const r = await traer('2026-05');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).cotizacion, 1612.31);
    const [p] = await (await fetch(`${base}/api/periodos`)).json();
    assert.equal(p.usd_cotizacion_fuente, 'api');
    assert.ok(p.usd_cotizacion_fecha);
    caida = true;
    assert.equal((await traer('2026-05')).status, 502);
    assert.equal((await traer('2030-01')).status, 400);
  }, { fetchDolar });
});

test('cuentas, medios de pago y movimientos por la API', () => {
  const db = abrirDb(':memory:');
  periodo(db, '2026-05', '2026-05-01', '2026-06-01');
  db.exec(`INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda) VALUES ('mp', 'MP', 'mercadopago', 'ARS')`);
  return conApi(db, async (base) => {
    const json = { 'Content-Type': 'application/json' };
    const pedir = (metodo: string, ruta: string, cuerpo?: unknown) =>
      fetch(`${base}/api/${ruta}`, { method: metodo, headers: json, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });

    assert.equal((await pedir('POST', 'cuentas', { nombre: 'Banco Prueba', moneda: 'ARS' })).status, 200);
    assert.equal((await pedir('POST', 'cuentas', { nombre: 'Dólares Prueba', moneda: 'USD' })).status, 200);
    assert.match((await (await pedir('POST', 'cuentas', { nombre: 'banco prueba', moneda: 'ARS' })).json()).error, /Ya existe/);

    // El medio de pago en ARS no se asocia a una cuenta en USD.
    assert.match((await (await pedir('PUT', 'medios-pago/1', { cuenta_id: 2, moneda: 'ARS', descuenta_comision: 1 })).json()).error, /es en USD/);
    assert.equal((await pedir('PUT', 'medios-pago/1', { cuenta_id: 1, moneda: 'ARS', descuenta_comision: 1 })).status, 200);

    const mov = { mes: '2026-05', fecha: '2026-05-03', depto: null, tipo: 'saldo_inicial', concepto: null, detalle: 'Saldo al empezar', importe_ars: 100000, importe_usd: 0, cuenta_id: 1 };
    assert.match((await (await pedir('POST', 'movimientos', { ...mov, importe_ars: 0 })).json()).error, /Falta el importe/);
    assert.equal((await pedir('POST', 'movimientos', mov)).status, 200);
    const lista = await (await fetch(`${base}/api/movimientos?mes=2026-05`)).json();
    assert.deepEqual(lista.map((m: any) => [m.tipo, m.cuenta, m.importe_ars]), [['saldo_inicial', 'Banco Prueba', 100000]]);
    const cuentas = await (await fetch(`${base}/api/cuentas`)).json();
    assert.deepEqual(cuentas.map((c: any) => [c.nombre, c.saldo]), [['Banco Prueba', 100000], ['Dólares Prueba', 0]]);
  });
});

test('ficha del depto y vencimientos por la API', () => {
  const db = abrirDb(':memory:');
  db.exec(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('OVL', 'Hornera Lagos', 1);`);
  return conApi(db, async (base) => {
    const pedir = (metodo: string, ruta: string, cuerpo?: unknown) => fetch(`${base}/api/${ruta}`,
      { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });

    const { id } = await (await pedir('POST', 'deptos/1/ficha/claves', { nombre: 'Wifi', clave: 'demo-1' })).json();
    assert.equal((await pedir('PUT', `ficha/claves/${id}`, { nombre: 'Wifi', clave: 'demo-2' })).status, 200);
    assert.deepEqual((await (await pedir('GET', 'deptos/1/ficha')).json()).claves.map((c: any) => c.clave), ['demo-2']);
    assert.equal((await pedir('DELETE', `ficha/claves/${id}`, {})).status, 200);
    assert.deepEqual((await (await pedir('GET', 'deptos/1/ficha')).json()).claves, []);

    const mal = await pedir('GET', 'vencimientos?mes=2026-13');
    assert.equal(mal.status, 400);
    assert.match((await mal.json()).error, /Mes inválido/);
    const lista = await pedir('POST', 'deptos/1/ficha/propietario', {});
    assert.equal(lista.status, 400);
    assert.match((await lista.json()).error, /No existe la lista/);
  });
});
