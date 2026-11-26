// Mails a los propietarios (plan 084): la liquidación y la factura del mes, en lote, por la cuenta de Gmail de la oficina.
// Acá: qué se manda a quién y con qué texto. Generar los PDF y mandar lo hace la ruta (server/app.ts) con lo que inyecta Electron.
import type { DatabaseSync } from 'node:sqlite';
import { listarTransferencias } from './liquidacion/pagos.ts';
import { sello } from './sello.ts';
import { esMail } from './propietarios.ts';
import { LETRA_CBTE } from './fiscal.ts';

export interface CuentaMail { usuario: string; clave: string }  // clave = contraseña de aplicación de Gmail
export interface AlmacenCuentaMail { leer(): CuentaMail | null; guardar(c: CuentaMail): void }
export interface Mensaje { to: string[]; subject: string; text: string; attachments: { filename: string; content: Buffer }[] }
export interface Mailer { cuenta: AlmacenCuentaMail; enviar(cuenta: CuentaMail, m: Mensaje): Promise<void> }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const POR_DEFECTO = {
  asunto: 'Liquidación {mes} - Hornera',
  cuerpo: 'Hola {nombre}:\n\nTe enviamos {adjuntos} de {mes}.\n\nCualquier duda, respondé este mail.\n\nSaludos,\nHornera',
};
// Separados como al guardarlos en Propietarios; los del Excel llegan en texto libre.
export function listaDeMails(texto: string | null) {
  const todos = (texto ?? '').split(/[;,\s]+/).filter(Boolean);
  return { validos: todos.filter(esMail), invalidos: todos.filter((m) => !esMail(m)) };
}

function validarMes(mes: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error(`El mes "${mes}" no es válido (AAAA-MM).`);
}
const mesEnPalabras = (mes: string) => `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;

export interface AEnviar {
  incluidos: { propietarioId: number; propietario: string; mails: string; deptos: string[]; facturas: { id: number; cbte_tipo: number; punto_venta: number; numero: number }[];
    aviso: string | null; enviado: string | null }[];
  excluidos: { propietarioId: number; propietario: string; motivo: string }[];
}

export function aEnviar(db: DatabaseSync, mes: string): AEnviar {
  validarMes(mes);
  const mailsDe = db.prepare('SELECT mails FROM propietario WHERE id = ?');
  const enviadoDe = db.prepare('SELECT max(fecha) f FROM envio_mail WHERE mes = ? AND propietario_id = ? AND error IS NULL');
  const porProp = new Map<number, AEnviar['incluidos'][number] & { invalidos: string[] }>();
  for (const t of listarTransferencias(db, mes)) {
    if (t.esHornera) continue;
    const lista = listaDeMails((mailsDe.get(t.propietarioId) as { mails: string | null }).mails);
    const p = porProp.get(t.propietarioId) ?? { propietarioId: t.propietarioId, propietario: t.propietario,
      mails: lista.validos.join('; '), invalidos: lista.invalidos, deptos: [], facturas: [], aviso: null,
      enviado: (enviadoDe.get(mes, t.propietarioId) as { f: string | null }).f };
    p.deptos.push(t.codigo);
    for (const x of t.pagos) {
      const f = x.factura;
      if (!x.anulado && f?.estado === 'aprobado' && f.ambiente === 'produccion') p.facturas.push({ id: f.id, cbte_tipo: f.cbte_tipo, punto_venta: f.punto_venta, numero: f.numero! });
    }
    porProp.set(t.propietarioId, p);
  }
  const todos = [...porProp.values()].sort((a, b) => a.propietario.localeCompare(b.propietario, 'es'));
  for (const p of todos) if (!p.facturas.length) p.aviso = 'Sin factura todavía';
  // Un mail mal escrito deja afuera al propietario: mandarle solo a los otros escondería el error.
  const motivo = (p: (typeof todos)[number]) => p.invalidos.length
    ? `Mail inválido ("${p.invalidos[0]}"): corregilo en Propietarios → Datos para pagarle.`
    : !p.mails ? 'Sin mail: cargalo en Propietarios → Datos para pagarle.' : null;
  return {
    incluidos: todos.filter((p) => !motivo(p)).map(({ invalidos: _, ...p }) => p),
    excluidos: todos.filter(motivo).map((p) => ({ propietarioId: p.propietarioId, propietario: p.propietario, motivo: motivo(p)! })),
  };
}

// El propietario del lote, o el motivo por el que no se le puede mandar.
export function aEnviarA(db: DatabaseSync, mes: string, propietarioId: number) {
  const lote = aEnviar(db, mes);
  const fuera = lote.excluidos.find((e) => e.propietarioId === propietarioId);
  if (fuera) throw new Error(fuera.motivo);
  const p = lote.incluidos.find((i) => i.propietarioId === propietarioId);
  if (!p) throw new Error(`Ese propietario no tiene liquidación en ${mes} (o es de Hornera).`);
  return p;
}

export const nombreHoja = (codigo: string, mes: string) => `${codigo} ${mesEnPalabras(mes)}.pdf`;
export const nombreFactura = (f: { cbte_tipo: number; punto_venta: number; numero: number }) =>
  `Factura ${LETRA_CBTE[f.cbte_tipo]} ${String(f.punto_venta).padStart(4, '0')}-${String(f.numero).padStart(8, '0')}.pdf`;

function texto(db: DatabaseSync) {
  const leer = (c: string) => (db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(`mail.${c}`) as { valor: string } | undefined)?.valor;
  return { asunto: leer('asunto') ?? POR_DEFECTO.asunto, cuerpo: leer('cuerpo') ?? POR_DEFECTO.cuerpo };
}

export function armarMensaje(db: DatabaseSync, mes: string, p: AEnviar['incluidos'][number], attachments: Mensaje['attachments']): Mensaje {
  const { asunto, cuerpo } = texto(db);
  // "Pérez, Ana" → "Ana"; una razón social va entera.
  const nombre = p.propietario.includes(',') ? p.propietario.split(',').slice(1).join(',').trim() : p.propietario;
  const hojas = p.deptos.length > 1 ? 'las liquidaciones' : 'la liquidación';
  const adjuntos = p.facturas.length ? `${hojas} y ${p.facturas.length > 1 ? 'las facturas' : 'la factura'}` : hojas;
  const llenar = (s: string) => s.replaceAll('{nombre}', nombre).replaceAll('{mes}', mesEnPalabras(mes)).replaceAll('{adjuntos}', adjuntos);
  return { to: listaDeMails(p.mails).validos, subject: llenar(asunto), text: llenar(cuerpo), attachments };
}

export function registrar(db: DatabaseSync, mes: string, propietarioId: number, m: Mensaje, error: string | null) {
  const fecha = sello();
  db.prepare('INSERT INTO envio_mail(propietario_id, mes, fecha, destinatarios, adjuntos, error) VALUES (?, ?, ?, ?, ?, ?)')
    .run(propietarioId, mes, fecha, m.to.join('; '), m.attachments.map((a) => a.filename).join('; '), error);
  return fecha;
}

// Error de Gmail → mensaje y si hay que cortar el lote (cuenta rechazada o sin conexión: el resto fallaría igual).
export function errorDeGmail(e: unknown): { mensaje: string; corta: boolean } {
  const code = (e as { code?: string }).code;
  const msg = e instanceof Error ? e.message : String(e);
  if ((e as { responseCode?: number }).responseCode === 421 || msg.includes('5.4.5')) {
    return { mensaje: `Gmail no deja mandar más mails por hoy (límite de la cuenta): seguí mañana desde acá (${msg}).`, corta: true };
  }
  if (code === 'EAUTH') return { mensaje: `Gmail rechazó la cuenta: revisá la contraseña de aplicación (${msg}).`, corta: true };
  if (code && ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(code)) return { mensaje: `Sin conexión con Gmail: ${msg}`, corta: true };
  return { mensaje: msg, corta: false };
}

// ---- Cuenta y texto. La contraseña vive cifrada fuera de la base (Electron); acá nunca vuelve.
export function verCuenta(db: DatabaseSync, cuenta: AlmacenCuentaMail | undefined) {
  return { usuario: cuenta?.leer()?.usuario ?? null, ...texto(db), por_defecto: POR_DEFECTO };
}

export function guardarCuenta(db: DatabaseSync, cuenta: AlmacenCuentaMail | undefined, b: { usuario?: unknown; clave?: unknown; asunto?: unknown; cuerpo?: unknown }) {
  if (!cuenta) throw new Error('Esta instalación no puede guardar la cuenta de Gmail.');
  const usuario = String(b.usuario ?? '').trim().toLowerCase();
  if (!esMail(usuario)) throw new Error(`"${usuario}" no es un mail.`);
  const clave = b.clave == null || b.clave === '' ? cuenta.leer()?.clave : String(b.clave).replace(/\s+/g, '');
  if (!clave) throw new Error('Falta la contraseña de aplicación de Gmail.');
  if (!/^[a-z]{16}$/i.test(clave)) throw new Error('La contraseña de aplicación son 16 letras (Gmail la muestra en 4 grupos de 4).');
  for (const c of ['asunto', 'cuerpo'] as const) {
    if (b[c] === undefined) continue;
    const v = String(b[c] ?? '').trim();
    if (v) db.prepare('INSERT INTO configuracion(clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(`mail.${c}`, v);
    else db.prepare('DELETE FROM configuracion WHERE clave = ?').run(`mail.${c}`); // vacío = el texto por defecto
  }
  cuenta.guardar({ usuario, clave });
  return verCuenta(db, cuenta);
}
