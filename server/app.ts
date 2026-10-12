// API HTTP. La usan la ventana de Electron y, más adelante, las terminales de la red.
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { importarExcel } from './importador/excel.ts';
import { crearClienteStays, URL_STAYS, type Credenciales } from './stays/cliente.ts';
import { sincronizarMes } from './stays/sync.ts';
import { SQL_EN_PERIODO } from './periodo.ts';

// Dónde viven las credenciales de Stays. En Electron, cifradas con safeStorage
// (DPAPI de Windows) fuera de la base: no viajan en los backups.
export interface AlmacenCredenciales {
  leer(): Credenciales | null;
  guardar(c: Credenciales): void;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

// La clave de Stays solo viaja por https a Stays, o a un Stays de prueba en esta misma PC.
function urlStaysPermitida(url: string) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' && (u.hostname === 'stays.net' || u.hostname.endsWith('.stays.net')))
      || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
  } catch {
    return false;
  }
}

// Solo pedidos dirigidos a esta PC: una página web con un dominio que resuelve a
// 127.0.0.1 (DNS rebinding) manda su propio Host y queda afuera.
// Fase 5 (terminales en LAN): sumar acá las IP/nombres de la PC servidor.
const HOST_PERMITIDO = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

export function crearApp(db: DatabaseSync, version: string, opciones: { credenciales?: AlmacenCredenciales; urlStays?: string } = {}) {
  const app = express();
  const { credenciales, urlStays = URL_STAYS } = opciones;
  app.use((req, res, next) => {
    if (HOST_PERMITIDO.test(req.headers.host ?? '')) return next();
    res.status(403).json({ error: 'Host no permitido' });
  });
  // Las escrituras solo desde la propia app: el navegador marca con Sec-Fetch-Site los
  // pedidos que salen de otro sitio (un formulario de una página web, por ejemplo).
  app.use((req, res, next) => {
    const sitio = req.headers['sec-fetch-site'];
    if (req.method === 'GET' || req.method === 'HEAD' || !sitio || sitio === 'same-origin' || sitio === 'none') return next();
    res.status(403).json({ error: 'Pedido de otro sitio' });
  });
  app.use(express.json());

  app.get('/api/estado', (_req, res) => {
    res.json({ version });
  });

  app.get('/api/propietarios', (_req, res) => {
    res.json(db.prepare(`
      SELECT p.id, p.nombre, p.moneda_liquidacion, p.cbu IS NOT NULL AS tiene_cbu,
             (SELECT group_concat(codigo, ', ') FROM depto WHERE propietario_id = p.id) AS deptos
      FROM propietario p WHERE p.activo = 1 ORDER BY p.nombre`).all());
  });

  app.get('/api/deptos', (_req, res) => {
    res.json(db.prepare(`
      SELECT d.id, d.codigo, d.nombre, d.estado, d.comision_pct, p.nombre AS propietario
      FROM depto d JOIN propietario p ON p.id = d.propietario_id ORDER BY d.codigo`).all());
  });

  // El archivo viaja como application/octet-stream: no es un tipo "simple" de CORS,
  // así que una página web ajena no puede mandarlo sin preflight.
  app.post('/api/importar/excel', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Falta el archivo .xlsx' });
      return;
    }
    try {
      res.json(importarExcel(db, req.body));
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  });

  // ---- Stays. La clave nunca vuelve al cliente.
  app.get('/api/stays', (_req, res) => {
    res.json({ usuario: credenciales?.leer()?.usuario ?? null });
  });

  app.put('/api/stays/credenciales', (req, res) => {
    const { usuario, clave } = req.body ?? {};
    if (typeof usuario !== 'string' || !usuario.trim() || typeof clave !== 'string' || !clave) {
      res.status(400).json({ error: 'Faltan el usuario o la clave' });
      return;
    }
    if (!credenciales) {
      res.status(400).json({ error: 'Esta instalación no puede guardar credenciales' });
      return;
    }
    credenciales.guardar({ usuario: usuario.trim(), clave });
    res.json({ usuario: usuario.trim() });
  });

  let sincronizando = false; // un "traer mes" por vez
  app.post('/api/stays/sincronizar', async (req, res) => {
    const creds = credenciales?.leer();
    if (!creds) {
      res.status(400).json({ error: 'Cargá primero el usuario y la clave de Stays' });
      return;
    }
    if (sincronizando) {
      res.status(409).json({ error: 'Ya se está trayendo un mes de Stays' });
      return;
    }
    sincronizando = true;
    try {
      // configuracion.stays.url permite apuntar a otra cuenta de Stays (o a un Stays de prueba).
      const url = (db.prepare(`SELECT valor FROM configuracion WHERE clave = 'stays.url'`).get() as { valor: string } | undefined)?.valor ?? urlStays;
      if (!urlStaysPermitida(url)) throw new Error(`URL de Stays no permitida: ${url} (tiene que ser https://….stays.net).`);
      res.json(await sincronizarMes(db, crearClienteStays(creds, url), String(req.body?.mes ?? '')));
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    } finally {
      sincronizando = false;
    }
  });

  // Reservas de un período con lo que entra a la liquidación (pagos liquidables, neto de comisión).
  app.get('/api/reservas', (req, res) => {
    const periodo = db.prepare('SELECT fecha_inicio, fecha_cierre_reservas FROM periodo WHERE mes = ?')
      .get(String(req.query.mes ?? '')) as { fecha_inicio: string; fecha_cierre_reservas: string } | undefined;
    if (!periodo) {
      res.json([]);
      return;
    }
    const { fecha_inicio: inicio, fecha_cierre_reservas: cierre } = periodo;
    res.json(db.prepare(`
      SELECT r.id, r.codigo, d.codigo AS depto, r.llegada, r.salida, r.huespedes, p.nombre AS plataforma,
             r.estado_stays, r.ajuste_ars, r.ajuste_usd, r.excluida,
             COALESCE(SUM(CASE v.moneda WHEN 'ARS' THEN v.importe_neto END), 0) AS cobrado_ars,
             COALESCE(SUM(CASE v.moneda WHEN 'USD' THEN v.importe_neto END), 0) AS cobrado_usd,
             MAX(v.falta_comision) AS falta_comision
      FROM reserva r
      JOIN depto d ON d.id = r.depto_id
      LEFT JOIN plataforma p ON p.id = r.plataforma_id
      LEFT JOIN v_pago_liquidable v ON v.reserva_id = r.id
      WHERE ${SQL_EN_PERIODO}
      GROUP BY r.id ORDER BY d.codigo, r.llegada`).all({ inicio, cierre }));
  });

  // Las rutas nuevas van arriba de estas dos: lo que no es /api sigue a Vite/static.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No existe ${req.method} /api${req.path}` });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(mensaje(err)); // solo el mensaje: el error de body-parser trae el cuerpo (puede tener la clave)
    res.status(500).json({ error: mensaje(err) });
  });

  return app;
}
