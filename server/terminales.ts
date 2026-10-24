// Terminales de la red (fase 5d). La PC servidor atiende en la LAN; una terminal es otra
// PC que abre la app del servidor en su ventana. Para leer o escribir la API tiene que
// estar emparejada: en el servidor se genera un código de 6 dígitos, la terminal lo
// escribe y recibe un token (cookie HttpOnly) que el servidor guarda hasheado.
// Lo que se pide desde esta misma PC (127.0.0.1) no necesita emparejar.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, NextFunction, Request, Response } from 'express';
import { auditar, nombrarPc, nombrePc, pcActual } from './auditoria.ts';
import { sello } from './sello.ts';

const COOKIE = 'hornera_terminal';
const CODIGO_VALIDO_MS = 10 * 60 * 1000;
const MAX_INTENTOS = 5;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export const esLocal = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

// Nombres con los que una terminal puede llamar a esta PC: el nombre del equipo (Windows lo
// resuelve en la LAN), nombre.local y sus IPv4. Se calculan en cada pedido: la IP cambia con DHCP.
export function nombresDeEstaPc() {
  const nombre = hostname().toLowerCase();
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i!.address);
  return [nombre, `${nombre}.local`, ...ips];
}

// Host del pedido sin puerto ("PC-1:4310" → "pc-1"), para compararlo con nombresDeEstaPc.
export const hostSinPuerto = (host: string) => host.replace(/:\d+$/, '').toLowerCase();

const tokenDe = (req: Request) => req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];

// Middleware de /api: deja pasar lo local y lo de terminales emparejadas (con su nombre
// para la auditoría). Emparejar es lo único abierto a una terminal sin token.
export function autorizar(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (esLocal(req) || req.path === '/terminales/emparejar') return next();
    const token = tokenDe(req);
    const t = token && db.prepare('SELECT nombre FROM terminal WHERE token_hash = ? AND revocada_en IS NULL').get(hash(token)) as { nombre: string } | undefined;
    if (!t) {
      res.status(401).json({ error: 'Esta PC no está emparejada con el servidor', emparejar: true });
      return;
    }
    pcActual.run(t.nombre, next);
  };
}

// Lo que solo se hace sentado en el servidor: administrar terminales y cargar la clave de Stays.
export function soloLocal(req: Request, res: Response, next: NextFunction) {
  if (esLocal(req)) return next();
  res.status(403).json({ error: 'Esto solo se hace en la PC servidor' });
}

export function rutasTerminales(app: Express, db: DatabaseSync) {
  // ponytail: un solo código vivo a la vez, en memoria (se pierde al reiniciar: se genera otro).
  let codigo: { valor: string; vence: number; intentos: number } | null = null;

  app.get('/api/terminales', soloLocal, (req, res) => {
    res.json({
      nombre: nombrePc(db),
      direcciones: nombresDeEstaPc().filter((n) => !n.endsWith('.local')).map((n) => `${n}:${req.socket.localPort}`),
      codigo: codigo && codigo.vence > Date.now() ? { valor: codigo.valor, vence: new Date(codigo.vence).toISOString() } : null,
      terminales: db.prepare('SELECT id, nombre, creada_en FROM terminal WHERE revocada_en IS NULL ORDER BY id').all(),
    });
  });

  // El nombre con el que esta PC queda en la auditoría.
  app.put('/api/terminales/nombre', soloLocal, (req, res) => {
    try {
      res.json(nombrarPc(db, req.body?.nombre));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/terminales/codigo', soloLocal, (_req, res) => {
    codigo = { valor: String(randomInt(0, 1_000_000)).padStart(6, '0'), vence: Date.now() + CODIGO_VALIDO_MS, intentos: 0 };
    res.json({ valor: codigo.valor, vence: new Date(codigo.vence).toISOString() });
  });

  app.post('/api/terminales/:id/revocar', soloLocal, (req, res) => {
    const t = db.prepare('SELECT id, nombre FROM terminal WHERE id = ? AND revocada_en IS NULL').get(Number(req.params.id)) as { id: number; nombre: string } | undefined;
    if (t) {
      db.prepare(`UPDATE terminal SET revocada_en = ? WHERE id = ?`).run(sello(), t.id);
      auditar(db, 'terminal', t.id, 'anulacion', { nombre: t.nombre }, null);
    }
    res.json({ ok: true });
  });

  app.post('/api/terminales/emparejar', (req, res) => {
    const { codigo: escrito, nombre } = req.body ?? {};
    if (!codigo || codigo.vence < Date.now()) {
      res.status(400).json({ error: 'No hay un código vigente: generá uno en el servidor (Terminales)' });
      return;
    }
    if (String(escrito ?? '').trim() !== codigo.valor) {
      // Contra probar los 10⁶ códigos: a los 5 errores el código deja de servir.
      if (++codigo.intentos >= MAX_INTENTOS) codigo = null;
      res.status(400).json({ error: codigo ? 'Código incorrecto' : 'Demasiados intentos: generá un código nuevo en el servidor' });
      return;
    }
    codigo = null;
    const token = randomBytes(32).toString('base64url');
    const n = typeof nombre === 'string' && nombre.trim() ? nombre.trim().slice(0, 60) : 'Terminal';
    const id = Number(db.prepare(`INSERT INTO terminal(nombre, token_hash, creada_en) VALUES (?, ?, ?)`).run(n, hash(token), sello()).lastInsertRowid);
    // Una PC más que puede ver y cambiar todo: queda registrada con su dirección en la red.
    pcActual.run(n, () => auditar(db, 'terminal', id, 'alta', null, { nombre: n, direccion: req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? null }));
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${10 * 365 * 24 * 3600}`);
    res.json({ nombre: n });
  });
}
