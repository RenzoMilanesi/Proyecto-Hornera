// Correr: npm test. Sin llamar a la API real: el cliente es falso y devuelve respuestas armadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { abrirDb } from '../db.ts';
import { costo, gastoIaMes, guardarConfigIa, MAX_RESULTADO, MAX_VUELTAS, preguntar, type ClienteIa } from './asistente.ts';

type Bloque = Anthropic.Beta.BetaContentBlock;
const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
const mensaje = (content: unknown[], stop_reason: string, model = 'claude-sonnet-5-5') =>
  ({ id: 'msg', type: 'message', role: 'assistant', model, content: content as Bloque[], stop_reason, usage }) as unknown as Anthropic.Beta.BetaMessage;
const herramienta = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const texto = (t: string) => ({ type: 'text', text: t });

// Devuelve las respuestas en orden y guarda una copia de cada pedido.
function falso(respuestas: Anthropic.Beta.BetaMessage[]) {
  const pedidos: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const cliente: ClienteIa = { create: async (p) => { pedidos.push(structuredClone(p)); return respuestas[Math.min(pedidos.length - 1, respuestas.length - 1)]; } };
  return { cliente, pedidos };
}

function base() {
  const db = abrirDb(':memory:');
  db.exec(`INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
           INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1), ('BBB', 'Depto B', 1)`);
  return db;
}

test('asistente: dos herramientas en una vuelta van en un solo mensaje; se guarda el modelo que contestó', async () => {
  const db = base();
  const { cliente, pedidos } = falso([
    mensaje([herramienta('t1', 'listar_deptos', {}), herramienta('t2', 'ficha_depto', { depto: 'ZZZ' })], 'tool_use'),
    mensaje([texto('Hay 2 deptos: AAA y BBB.')], 'end_turn', 'claude-sonnet-5'), // contestó el modelo de respaldo
  ]);
  const r = await preguntar(db, cliente, 'PC Uno', { pregunta: '¿Cuántos deptos hay?', pantalla: 'Deptos', mes: '2026-09' }, '2026-10-23');

  assert.equal(r.texto, 'Hay 2 deptos: AAA y BBB.');
  assert.equal(r.modelo, 'claude-sonnet-5');
  assert.deepEqual(r.tokens, { entrada: 200, cache: 2000, salida: 20 });
  assert.deepEqual(r.herramientas.map((h) => [h.nombre, h.filas, h.error ?? null]),
    [['listar_deptos', 2, null], ['ficha_depto', null, 'No existe el depto ZZZ. Los códigos salen de listar_deptos.']]);

  // Segunda vuelta: pregunta, respuesta con las dos herramientas y UN mensaje con los dos resultados.
  const segundo = pedidos[1].messages;
  assert.equal(segundo.length, 3);
  const resultados = segundo[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.deepEqual(resultados.map((x) => [x.tool_use_id, x.is_error ?? false]), [['t1', false], ['t2', true]]);
  assert.match(String(segundo[0].content), /^\[Pantalla: Deptos · Mes: 2026-09 · Hoy: 2026-10-23\]\n\n¿Cuántos deptos hay\?$/);

  // Lo que se pide: modelo y esfuerzo de la configuración, respaldo por rechazo, manual con caché y nada que escriba.
  assert.equal(pedidos[0].model, 'claude-sonnet-5-5');
  assert.deepEqual(pedidos[0].output_config, { effort: 'low' });
  assert.equal(pedidos[0].fallbacks, 'default');
  // Una conversación vieja se retoma aunque la app haya cambiado el manual o las herramientas (plan 062).
  assert.deepEqual(pedidos[0].thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.deepEqual(pedidos[0].betas, ['thinking-binding-controls-2026-08-01', 'server-side-fallback-2026-07-01']);
  assert.deepEqual((pedidos[0].system as Anthropic.Beta.BetaTextBlockParam[])[1].cache_control, { type: 'ephemeral' });
  // strict en las que tienen parámetros, y nunca más de 20 (la API rechaza la pregunta entera).
  const tools = pedidos[0].tools as Anthropic.Beta.BetaTool[];
  assert.ok(tools.every((t) => t.strict === (Object.keys(t.input_schema.properties ?? {}).length > 0 || undefined)));
  assert.ok(tools.filter((t) => t.strict).length <= 20);

  const fila = db.prepare('SELECT * FROM respuesta_ia').get() as Record<string, unknown>;
  assert.deepEqual([fila.modelo, fila.esfuerzo, fila.tokens_entrada], ['claude-sonnet-5', 'low', 200]);
  const conv = db.prepare('SELECT pc, titulo, mensajes_json FROM conversacion_ia').get() as Record<string, string>;
  assert.deepEqual([conv.pc, conv.titulo, JSON.parse(conv.mensajes_json).length], ['PC Uno', '¿Cuántos deptos hay?', 4]);
});

test('asistente: retomar agrega al final; otra PC no la ve; Haiku va sin respaldo', async () => {
  const db = base();
  guardarConfigIa(db, { modelo: 'claude-haiku-5-5', esfuerzo: 'low' });
  const { cliente, pedidos } = falso([mensaje([texto('Hola.')], 'end_turn', 'claude-haiku-5-5')]);
  const { conversacion_id } = await preguntar(db, cliente, 'PC Uno', { pregunta: 'Hola', pantalla: '', mes: '' });
  await preguntar(db, cliente, 'PC Uno', { conversacion_id, pregunta: 'Otra', pantalla: '', mes: '' });
  assert.equal(pedidos[1].messages.length, 3); // pregunta, respuesta, pregunta nueva
  assert.deepEqual(pedidos[1].messages[0], pedidos[0].messages[0]); // lo viejo, intacto
  assert.equal(pedidos[0].fallbacks, undefined);
  assert.deepEqual(pedidos[0].betas, ['thinking-binding-controls-2026-08-01']);
  await assert.rejects(preguntar(db, cliente, 'PC Dos', { conversacion_id, pregunta: 'Espío', pantalla: '', mes: '' }), /No existe la conversación/);

  // "Pensar más": esa pregunta con otro esfuerzo, sin tocar la configuración.
  const r = await preguntar(db, cliente, 'PC Uno', { pregunta: 'Hola', pantalla: '', mes: '', esfuerzo: 'high' });
  assert.deepEqual([pedidos[2].output_config, r.esfuerzo], [{ effort: 'high' }, 'high']);
  await assert.rejects(preguntar(db, cliente, 'PC Uno', { pregunta: 'Hola', pantalla: '', mes: '', esfuerzo: 'máximo' }), /Esfuerzo desconocido/);
});

test('asistente: el tope de vueltas corta y avisa; un rechazo o un error de la API no guardan nada', async () => {
  const db = base();
  const siempre = falso([mensaje([herramienta('t', 'listar_deptos', {})], 'tool_use')]);
  const r = await preguntar(db, siempre.cliente, 'PC Uno', { pregunta: 'Algo eterno', pantalla: '', mes: '' });
  assert.equal(siempre.pedidos.length, MAX_VUELTAS);
  assert.match(r.texto, /Corté después de 10 consultas/);

  const antes = (db.prepare('SELECT count(*) n FROM respuesta_ia').get() as { n: number }).n;
  const rechazo = await preguntar(db, falso([mensaje([], 'refusal')]).cliente, 'PC Uno', { pregunta: 'x', pantalla: '', mes: '' });
  assert.equal(rechazo.texto, 'El asistente no puede responder eso.');
  const caido: ClienteIa = { create: async () => { throw new Anthropic.APIConnectionError({ message: 'fetch failed' }); } };
  await assert.rejects(preguntar(db, caido, 'PC Uno', { pregunta: 'x', pantalla: '', mes: '' }), /No hay conexión con Anthropic/);
  assert.equal((db.prepare('SELECT count(*) n FROM respuesta_ia').get() as { n: number }).n, antes);
  await assert.rejects(preguntar(db, caido, 'PC Uno', { pregunta: '  ', pantalla: '', mes: '' }), /Falta la pregunta/);
});

test('asistente: un resultado enorme llega cortado y con el aviso al final', async () => {
  const db = base();
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
           INSERT INTO depto(codigo, nombre, propietario_id) SELECT 'D' || i, printf('%.2000c', 'n'), 1 FROM n`);
  const { cliente, pedidos } = falso([mensaje([herramienta('t1', 'listar_deptos', {})], 'tool_use'), mensaje([texto('Listo.')], 'end_turn')]);
  await preguntar(db, cliente, 'PC Uno', { pregunta: '¿Qué deptos hay?', pantalla: '', mes: '' });
  const [resultado] = pedidos[1].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  const contenido = resultado.content as string;
  assert.ok(contenido.length < MAX_RESULTADO + 200);
  assert.ok(contenido.endsWith('caracteres. Pedí menos datos (un depto, un mes, menos columnas).]'), contenido.slice(-150));
  assert.match(contenido, /\n\[Resultado cortado: tenía \d+ caracteres\./);
});

test('costo: también el de los modelos de respaldo, sin confundir opus-5-5 con opus-5', () => {
  const t = { entrada: 1_000_000, cache: 1_000_000, salida: 1_000_000 };
  assert.equal(costo('claude-sonnet-5-5', t), 2 + 10 + 0.20);
  assert.equal(costo('claude-sonnet-5', t), 2 + 10 + 0.20);
  assert.equal(costo('claude-opus-5-5', t), 4 + 20 + 0.20);
  assert.equal(costo('claude-opus-5', t), 5 + 25 + 0.50);
  assert.equal(costo('claude-opus-4-8', t), 5 + 25 + 0.50);
  assert.equal(costo('otro-modelo', t), null);
});

test('gasto del mes: desde el 1 a la hora local, con el precio de cada modelo', () => {
  const db = base();
  db.exec(`INSERT INTO conversacion_ia(pc, titulo, mensajes_json, creada_en, actualizada_en) VALUES ('PC Uno', 'x', '[]', 'x', 'x')`);
  const fila = db.prepare(`INSERT INTO respuesta_ia(conversacion_id, modelo, esfuerzo, tokens_entrada, tokens_cache, tokens_salida, herramientas_json, creada_en)
    VALUES (1, ?, 'low', ?, 0, 0, '[]', ?)`);
  const ahora = new Date(2026, 9, 23, 12);
  fila.run('claude-sonnet-5-5', 1_000_000, new Date(2026, 8, 30, 23).toISOString()); // septiembre: no cuenta
  fila.run('claude-sonnet-5-5', 1_000_000, new Date(2026, 9, 1, 0, 30).toISOString()); // 1 de octubre a las 0:30
  fila.run('claude-haiku-5-5', 1_000_000, new Date(2026, 9, 20).toISOString());
  assert.deepEqual(gastoIaMes(db, ahora), { preguntas: 2, costo: 2 + 0.10 });
});

test('propuestas (plan 068): se arma la tarjeta sin escribir nada; un error vuelve al modelo; lo resuelto se avisa en la pregunta siguiente', async () => {
  const db = base();
  db.exec(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, costo_hora_limpieza, servicio_limpieza,
             servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado)
           VALUES ('2026-09', '2026-09-01', '2026-10-01', '2026-09-28', '2026-10-10', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'cerrado'),
                  ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'abierto');
           INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Prueba', 'ARS');`);
  const gasto = { accion: 'alta', id: null, mes: '2026-10', fecha: '2026-10-20', depto: 'aaa', tipo: 'gasto', concepto: 'Cerrajería Nueva', detalle: 'Copia de llaves',
    importe_centavos: -1000000, moneda: 'ARS', cuenta: 'banco prueba', adjunto: null };
  const { cliente, pedidos } = falso([
    mensaje([herramienta('t1', 'proponer_movimiento', gasto), herramienta('t2', 'proponer_mes', { accion: 'cotizacion', mes: '2026-09', cotizacion: 1500 })], 'tool_use'),
    mensaje([texto('Te dejé la tarjeta para confirmar.')], 'end_turn'),
  ]);
  const cuantos = (t: string) => (db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;
  const r = await preguntar(db, cliente, 'PC Uno', { pregunta: 'Cargale $ 10.000 de cerrajería a AAA', pantalla: '', mes: '' });

  assert.deepEqual([cuantos('movimiento'), cuantos('auditoria'), cuantos('propuesta_ia')], [0, 0, 1]);
  assert.equal(db.prepare(`SELECT 1 FROM concepto WHERE nombre = 'Cerrajería Nueva'`).get(), undefined); // el ensayo no deja el concepto
  assert.deepEqual(r.propuestas.map((x) => [x.titulo, x.estado, x.args.depto, x.args.cuenta_id]), [['Nuevo gasto', 'pendiente', 'AAA', 1]]);
  assert.ok(r.propuestas[0].campos.some(([k, v]) => k === 'Importe' && v === '$ -10.000,00'));
  const resultados = pedidos[1].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.match(String(resultados[0].content), /todavía NO guardada/);
  assert.deepEqual([resultados[1].is_error, String(resultados[1].content)], [true, 'El período 2026-09 está cerrado: reabrilo para cargar o cambiar movimientos.']);

  // La persona la descarta; la pregunta siguiente se lo cuenta al modelo.
  db.exec(`UPDATE propuesta_ia SET estado = 'descartada', resuelta_en = '9999'`);
  const segundo = falso([mensaje([texto('Ok.')], 'end_turn')]);
  await preguntar(db, segundo.cliente, 'PC Uno', { conversacion_id: r.conversacion_id, pregunta: '¿Y ahora?', pantalla: '', mes: '' });
  assert.match(String(segundo.pedidos[0].messages.at(-1)!.content), /· Tarjetas: «Nuevo gasto» descartada\]/);
  assert.equal(((await import('./asistente.ts')).conversacionIa(db, 'PC Uno', r.conversacion_id!).turnos[0] as { propuestas: unknown[] }).propuestas.length, 1);
});
