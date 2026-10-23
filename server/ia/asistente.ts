// Asistente con IA (plan 061): contesta preguntas con Claude, solo lectura.
import { existsSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import Anthropic from '@anthropic-ai/sdk';
import { herramientas } from './herramientas.ts';

// Dónde vive la API key de Anthropic. En Electron, cifrada con safeStorage fuera de la base (no viaja en los backups).
export interface AlmacenClaveIa {
  leer(): string | null;
  guardar(clave: string): void;
}

export const MODELOS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
export const ESFUERZOS = ['low', 'medium', 'high'];

const leerValor = (db: DatabaseSync, clave: string) =>
  (db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave) as { valor: string } | undefined)?.valor;

export function configIa(db: DatabaseSync) {
  return { modelo: leerValor(db, 'ia.modelo') ?? 'claude-sonnet-5-5', esfuerzo: leerValor(db, 'ia.esfuerzo') ?? 'medium' };
}

export function guardarConfigIa(db: DatabaseSync, cuerpo: unknown) {
  const { modelo, esfuerzo } = (cuerpo ?? {}) as Record<string, unknown>;
  if (modelo !== undefined && !MODELOS.includes(modelo as string)) throw new Error('Modelo desconocido');
  if (esfuerzo !== undefined && !ESFUERZOS.includes(esfuerzo as string)) throw new Error('Esfuerzo desconocido');
  const poner = db.prepare('INSERT INTO configuracion(clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
  if (modelo !== undefined) poner.run('ia.modelo', modelo as string);
  if (esfuerzo !== undefined) poner.run('ia.esfuerzo', esfuerzo as string);
  return configIa(db);
}

// ---- El bucle

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
// Lo único que el bucle usa de la API: así los tests le pasan un cliente falso.
export interface ClienteIa { create(p: Params): Promise<Anthropic.Beta.BetaMessage> }

export const clienteAnthropic = (apiKey: string): ClienteIa => {
  const a = new Anthropic({ apiKey });
  return { create: (p) => a.beta.messages.create(p) };
};

export const MAX_VUELTAS = 10;
// Cada resultado queda en el historial y se reenvía en cada pregunta siguiente: tope con aviso al final (plan 064).
export const MAX_RESULTADO = 100_000;

const acotar = (texto: string) => texto.length <= MAX_RESULTADO ? texto
  : `${texto.slice(0, MAX_RESULTADO)}
[Resultado cortado: tenía ${texto.length} caracteres. Pedí menos datos (un depto, un mes, menos columnas).]`;

// US$ por millón de tokens: entrada, salida y lectura de caché.
// ponytail: precios a mano de 2026-10 (el número real está en la consola); la escritura de caché (1,25×) se cuenta como entrada.
const PRECIOS: Record<string, [number, number, number]> = {
  'claude-haiku-5-5': [0.10, 0.50, 0.01],
  'claude-sonnet-5-5': [2, 10, 0.20],
  'claude-opus-5-5': [4, 20, 0.20],
};

export function costo(modelo: string, t: { entrada: number; cache: number; salida: number }) {
  const p = PRECIOS[Object.keys(PRECIOS).find((m) => modelo.startsWith(m)) ?? ''];
  return p ? (t.entrada * p[0] + t.salida * p[1] + t.cache * p[2]) / 1e6 : null;
}

const REGLAS = `Sos el asistente de Hornera, una empresa de alquileres temporarios de Rosario que administra deptos de propietarios: \
cobra las reservas (Airbnb, Booking, directas), paga los gastos y cada mes le liquida a cada propietario lo que le corresponde, \
menos los honorarios de Hornera. La app reemplaza al Google Sheet de liquidaciones.

Reglas:
- Respondé en español rioplatense, corto y claro. Quien pregunta trabaja en la oficina, no es programador.
- Todo número sale de una herramienta. Nunca inventes ni estimes un dato: si ninguna herramienta lo da, decilo.
- Las herramientas devuelven la plata en CENTAVOS: dividí por 100. Mostrá los montos con $ (o US$), punto de miles y coma decimal: $ 1.234.567,89.
- No menciones ids internos ni nombres de tablas; hablá de deptos por su código y de propietarios por su nombre.
- Solo podés consultar: no podés cargar, cambiar ni borrar nada. Si te piden hacerlo, explicá en qué pantalla se hace.
- Para dudas de cómo se usa la app, respondé con el manual de abajo.
- El primer renglón de cada pregunta dice en qué pantalla y mes está la persona, y la fecha de hoy.`;

// El manual como texto, leído una vez. Sin el archivo el asistente anda igual, sin la ayuda de uso.
let manual: string | undefined;
function textoManual() {
  if (manual !== undefined) return manual;
  const ruta = new URL('../../manual/manual.html', import.meta.url);
  if (!existsSync(ruta)) {
    console.warn('Asistente: no está manual/manual.html; contesta sin la ayuda de uso.');
    return (manual = '');
  }
  return (manual = readFileSync(ruta, 'utf8')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<img[^>]*>/gi, '')
    .replace(/<\/(p|h[1-6]|li|tr|div|section)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim());
}

export interface Pregunta { conversacion_id?: number | null; pregunta: string; pantalla: string; mes: string }
export interface Usada { id: string; nombre: string; entrada: unknown; filas: number | null; error?: string }

// Errores de la API en palabras de la oficina. Del más específico al más general (APIConnectionError hereda de APIError).
export function mensajeIa(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return 'La API key de Anthropic no es válida: revisala en Herramientas → Asistente.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'La API key de Anthropic no tiene permiso para usar este modelo.';
  if (e instanceof Anthropic.RateLimitError) return 'Se llegó al límite de uso de la cuenta de Anthropic (tope de gasto o demasiadas preguntas seguidas). Probá en un rato o revisá la consola.';
  if (e instanceof Anthropic.APIConnectionError) return 'No hay conexión con Anthropic: revisá internet.';
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402 || /credit balance|billing/i.test(e.message)) return 'La cuenta de Anthropic no tiene saldo: cargalo en la consola.';
    if (e.status === 529 || (e.status ?? 0) >= 500) return 'Anthropic no responde en este momento: probá en un rato.';
    return `Anthropic rechazó la pregunta: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function preguntar(db: DatabaseSync, cliente: ClienteIa, pc: string, p: Pregunta, hoy = new Date().toLocaleDateString('sv')) {
  if (typeof p.pregunta !== 'string' || !p.pregunta.trim()) throw new Error('Falta la pregunta');
  const conv = p.conversacion_id == null ? null
    : db.prepare('SELECT id, mensajes_json FROM conversacion_ia WHERE id = ? AND pc = ?').get(p.conversacion_id, pc) as { id: number; mensajes_json: string } | undefined;
  if (p.conversacion_id != null && !conv) throw new Error('No existe la conversación');

  const { modelo: configurado, esfuerzo } = configIa(db);
  const lista = herramientas(db);
  // Orden fijo para el caché: herramientas → system (reglas + manual) → mensajes. Lo variable (la fecha) va en el mensaje.
  const tools = lista.map((h) => h.definicion);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: REGLAS },
    { type: 'text', text: `Manual de usuario de la app:\n\n${textoManual() || '(no disponible)'}`, cache_control: { type: 'ephemeral' } },
  ];
  // Historial tal cual vino de la API (incluidos los bloques de thinking): solo se agrega al final.
  const mensajes: Anthropic.Beta.BetaMessageParam[] = conv ? JSON.parse(conv.mensajes_json) : [];
  mensajes.push({ role: 'user', content: `[Pantalla: ${p.pantalla || '—'} · Mes: ${p.mes || '—'} · Hoy: ${hoy}]\n\n${p.pregunta.trim()}` });

  const tokens = { entrada: 0, cache: 0, salida: 0 };
  const usadas: Usada[] = [];
  let modelo = configurado;
  let respuesta: Anthropic.Beta.BetaMessage | undefined;
  let vueltas = 0;
  try {
    for (; vueltas < MAX_VUELTAS; vueltas++) {
      respuesta = await cliente.create({
        model: configurado,
        max_tokens: 16000,
        // Cada versión de la app cambia el manual, las reglas o las herramientas, y la API ata cada bloque de thinking a ese
        // prefijo: sin drop_block, retomar una conversación vieja daría 400 (plan 062).
        thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
        output_config: { effort: esfuerzo as 'low' | 'medium' | 'high' },
        tool_choice: { type: 'auto' }, // los modelos 5.5 rechazan any/tool
        cache_control: { type: 'ephemeral' }, // la conversación también se reusa en la pregunta siguiente
        tools,
        system,
        messages: mensajes,
        // Si un clasificador rechaza la pregunta, la API la reintenta en otro modelo (Haiku no lo soporta).
        ...(configurado === 'claude-haiku-5-5'
          ? { betas: ['thinking-binding-controls-2026-08-01'] }
          : { betas: ['thinking-binding-controls-2026-08-01', 'server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      });
      modelo = respuesta.model; // el que contestó de verdad, que puede no ser el configurado
      tokens.entrada += respuesta.usage.input_tokens + (respuesta.usage.cache_creation_input_tokens ?? 0);
      tokens.cache += respuesta.usage.cache_read_input_tokens ?? 0;
      tokens.salida += respuesta.usage.output_tokens;
      // ponytail: un rechazo no se guarda (puede venir sin contenido y el historial quedaría inválido); tampoco su costo.
      if (respuesta.stop_reason === 'refusal') return { conversacion_id: conv?.id ?? null, texto: 'El asistente no puede responder eso.', modelo, esfuerzo, tokens, costo: costo(modelo, tokens), herramientas: usadas };
      mensajes.push({ role: 'assistant', content: respuesta.content });
      if (respuesta.stop_reason !== 'tool_use') break;

      // Todas las herramientas pedidas, y todos los resultados en un solo mensaje.
      const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const b of respuesta.content) {
        if (b.type !== 'tool_use') continue;
        const h = lista.find((x) => x.definicion.name === b.name);
        try {
          if (!h) throw new Error(`No existe la herramienta ${b.name}`);
          const r = await h.correr(db, b.input as Record<string, unknown>);
          const filas = Array.isArray(r) ? r.length : Array.isArray((r as { filas?: unknown[] })?.filas) ? (r as { filas: unknown[] }).filas.length : null;
          usadas.push({ id: b.id, nombre: b.name, entrada: b.input, filas });
          resultados.push({ type: 'tool_result', tool_use_id: b.id, content: acotar(JSON.stringify(r)) });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          usadas.push({ id: b.id, nombre: b.name, entrada: b.input, filas: null, error });
          resultados.push({ type: 'tool_result', tool_use_id: b.id, content: error, is_error: true });
        }
      }
      mensajes.push({ role: 'user', content: resultados });
    }
  } catch (e) {
    throw new Error(mensajeIa(e)); // nada se guarda si falla
  }

  let texto = respuesta!.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
  if (vueltas === MAX_VUELTAS) texto = `${texto}\n\n_Corté después de ${MAX_VUELTAS} consultas: la respuesta puede estar incompleta. Probá con una pregunta más concreta._`.trim();
  else if (respuesta!.stop_reason === 'max_tokens') texto = `${texto}\n\n_La respuesta quedó cortada por larga._`.trim();

  const ahora = new Date().toISOString();
  const id = conv?.id ?? Number(db.prepare(`INSERT INTO conversacion_ia(pc, titulo, mensajes_json, creada_en, actualizada_en) VALUES (?, ?, '[]', ?, ?)`)
    .run(pc, p.pregunta.trim().replace(/\s+/g, ' ').slice(0, 60), ahora, ahora).lastInsertRowid);
  db.prepare('UPDATE conversacion_ia SET mensajes_json = ?, actualizada_en = ? WHERE id = ?').run(JSON.stringify(mensajes), ahora, id);
  db.prepare(`INSERT INTO respuesta_ia(conversacion_id, modelo, esfuerzo, tokens_entrada, tokens_cache, tokens_salida, herramientas_json, creada_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, modelo, esfuerzo, tokens.entrada, tokens.cache, tokens.salida, JSON.stringify(usadas), ahora);
  return { conversacion_id: id, texto, modelo, esfuerzo, tokens, costo: costo(modelo, tokens), herramientas: usadas };
}
