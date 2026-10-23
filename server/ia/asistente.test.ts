// Correr: npm test. Sin llamar a la API real: el cliente es falso y devuelve respuestas armadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { abrirDb } from '../db.ts';
import { costo, guardarConfigIa, MAX_RESULTADO, MAX_VUELTAS, preguntar, type ClienteIa } from './asistente.ts';

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
  assert.deepEqual(pedidos[0].output_config, { effort: 'medium' });
  assert.equal(pedidos[0].fallbacks, 'default');
  // Una conversación vieja se retoma aunque la app haya cambiado el manual o las herramientas (plan 062).
  assert.deepEqual(pedidos[0].thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.deepEqual(pedidos[0].betas, ['thinking-binding-controls-2026-08-01', 'server-side-fallback-2026-07-01']);
  assert.deepEqual((pedidos[0].system as Anthropic.Beta.BetaTextBlockParam[])[1].cache_control, { type: 'ephemeral' });
  assert.ok(pedidos[0].tools!.every((t) => (t as Anthropic.Beta.BetaTool).strict === true));

  const fila = db.prepare('SELECT * FROM respuesta_ia').get() as Record<string, unknown>;
  assert.deepEqual([fila.modelo, fila.esfuerzo, fila.tokens_entrada], ['claude-sonnet-5', 'medium', 200]);
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
