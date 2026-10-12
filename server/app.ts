// API HTTP. La usan la ventana de Electron y, más adelante, las terminales de la red.
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';

// Solo pedidos dirigidos a esta PC: una página web con un dominio que resuelve a
// 127.0.0.1 (DNS rebinding) manda su propio Host y queda afuera.
// Fase 5 (terminales en LAN): sumar acá las IP/nombres de la PC servidor.
const HOST_PERMITIDO = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

export function crearApp(db: DatabaseSync, version: string) {
  const app = express();
  app.use((req, res, next) => {
    if (HOST_PERMITIDO.test(req.headers.host ?? '')) return next();
    res.status(403).json({ error: 'Host no permitido' });
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

  // Las rutas nuevas van arriba de estas dos: lo que no es /api sigue a Vite/static.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No existe ${req.method} /api${req.path}` });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}
