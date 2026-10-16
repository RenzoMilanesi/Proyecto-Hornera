// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from './db.ts';
import { actualizarCotizacion, diaDeCierre, type Fetch } from './cotizacion.ts';

// fetch falso: responde por URL y anota lo que se pidió. Sin red.
function apiFalsa(respuestas: Record<string, number | 'caida'>) {
  const pedidas: string[] = [];
  const fetchFn = (async (url: string) => {
    pedidas.push(url);
    const r = respuestas[url];
    if (r === 'caida') throw new Error('fetch failed');
    if (r === undefined) return new Response('', { status: 404 });
    return Response.json({ casa: 'cripto', compra: r - 2, venta: r });
  }) as Fetch;
  return { fetchFn, pedidas };
}
const HIST = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/cripto/2026/05/31';
const ACTUAL = 'https://dolarapi.com/v1/dolares/cripto';

function base(estado = 'abierto') {
  const db = abrirDb(':memory:');
  db.prepare(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, estado,
      costo_hora_limpieza, servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa,
      mantenimiento, tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd)
    VALUES ('2026-05', '2026-05-01', '2026-06-01', '2026-05-28', '2026-06-10', ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`).run(estado);
  return db;
}
const periodo = (db: ReturnType<typeof base>) => ({ ...db.prepare(`SELECT usd_cotizacion c, usd_cotizacion_fuente f, usd_cotizacion_fecha d FROM periodo`).get() as object });

test('día de cierre: el anterior a fecha_cierre_reservas', () => {
  assert.equal(diaDeCierre('2026-06-01'), '2026-05-31');
  assert.equal(diaDeCierre('2026-03-01'), '2026-02-28');
});

test('mes terminado: venta del día de cierre, auditada', async () => {
  const db = base();
  const { fetchFn, pedidas } = apiFalsa({ [HIST]: 1485.2 });
  assert.deepEqual(await actualizarCotizacion(db, '2026-05', false, fetchFn, '2026-06-02'),
    { cotizacion: 1485.2, fecha: '2026-05-31', provisoria: false, aviso: undefined });
  assert.deepEqual(periodo(db), { c: 1485.2, f: 'api', d: '2026-05-31' });
  assert.deepEqual(pedidas, [HIST]);
  assert.equal((db.prepare(`SELECT count(*) n FROM auditoria`).get() as { n: number }).n, 1);
  // Ya es la del cierre: otro "traer mes" no vuelve a pedirla.
  await actualizarCotizacion(db, '2026-05', false, fetchFn, '2026-06-03');
  assert.equal(pedidas.length, 1);
});

test('mes en curso: la de hoy, provisoria; el cierre todavía sin publicar avisa', async () => {
  const db = base();
  const { fetchFn, pedidas } = apiFalsa({ [ACTUAL]: 1500 });
  const r = await actualizarCotizacion(db, '2026-05', false, fetchFn, '2026-05-20');
  assert.deepEqual(r, { cotizacion: 1500, fecha: '2026-05-20', provisoria: true, aviso: undefined });
  assert.deepEqual(pedidas, [ACTUAL]);

  const r2 = await actualizarCotizacion(db, '2026-05', false, fetchFn, '2026-06-01'); // histórico da 404
  assert.equal(r2.provisoria, true);
  assert.match(r2.aviso!, /Todavía no está la cotización del dólar del 2026-05-31/);
  assert.deepEqual(periodo(db), { c: 1500, f: 'api', d: '2026-06-01' });
});

test('la manual manda salvo que se fuerce', async () => {
  const db = base();
  db.exec(`UPDATE periodo SET usd_cotizacion = 1400, usd_cotizacion_fuente = 'manual'`);
  const { fetchFn, pedidas } = apiFalsa({ [HIST]: 1485.2 });
  const r = await actualizarCotizacion(db, '2026-05', false, fetchFn, '2026-06-02');
  assert.match(r.aviso!, /cargada a mano \(\$ 1400\)/);
  assert.deepEqual(pedidas, []);
  assert.deepEqual(periodo(db), { c: 1400, f: 'manual', d: null });

  await actualizarCotizacion(db, '2026-05', true, fetchFn, '2026-06-02');
  assert.deepEqual(periodo(db), { c: 1485.2, f: 'api', d: '2026-05-31' });
});

test('una manual guardada mientras se espera a la API no se pisa', async () => {
  const db = base();
  const fetchFn = (async () => {
    db.exec(`UPDATE periodo SET usd_cotizacion = 1400, usd_cotizacion_fuente = 'manual'`);
    return Response.json({ venta: 1500 });
  }) as unknown as Fetch;
  const r = await actualizarCotizacion(db, '2026-05', false, fetchFn, '2026-05-20');
  assert.match(r.aviso!, /se dejó la manual/);
  assert.deepEqual(periodo(db), { c: 1400, f: 'manual', d: null });
  assert.equal((db.prepare(`SELECT count(*) n FROM auditoria`).get() as { n: number }).n, 0);
});

test('API caída o período cerrado: error y la cotización queda como estaba', async () => {
  const db = base();
  db.exec(`UPDATE periodo SET usd_cotizacion = 1400, usd_cotizacion_fuente = 'api', usd_cotizacion_fecha = '2026-05-10'`);
  const { fetchFn } = apiFalsa({ [ACTUAL]: 'caida' });
  await assert.rejects(actualizarCotizacion(db, '2026-05', false, fetchFn, '2026-05-20'), /No se pudo traer el dólar: fetch failed/);
  assert.deepEqual(periodo(db), { c: 1400, f: 'api', d: '2026-05-10' });

  const invalida = (async () => Response.json({ venta: 'x' })) as unknown as Fetch;
  await assert.rejects(actualizarCotizacion(db, '2026-05', false, invalida, '2026-05-20'), /valor inválido/);

  await assert.rejects(actualizarCotizacion(base('cerrado'), '2026-05', true, fetchFn, '2026-06-02'), /cerrado/);
});
