// API HTTP. La usan la ventana de Electron y, más adelante, las terminales de la red.
import express, { type NextFunction, type Request, type Response } from 'express';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { importarExcel } from './importador/excel.ts';
import { crearClienteStays, URL_STAYS, type Credenciales } from './stays/cliente.ts';
import { sincronizarMes } from './stays/sync.ts';
import { SQL_EN_PERIODO } from './periodo.ts';
import { liquidarPeriodo } from './liquidacion/servicio.ts';
import { compararConExcel } from './liquidacion/comparar.ts';
import { auditar } from './auditoria.ts';
import { anularMovimiento, crearMovimiento, editarMovimiento, listarMovimientos, transferir } from './movimientos.ts';
import { cerrarPeriodo, reabrirPeriodo } from './liquidacion/cierre.ts';
import { excelTransferencias, listarTransferencias, pagarLiquidacion } from './liquidacion/pagos.ts';
import { hojaDepto } from './liquidacion/hoja.ts';

// Dónde viven las credenciales de Stays. En Electron, cifradas con safeStorage
// (DPAPI de Windows) fuera de la base: no viajan en los backups.
export interface AlmacenCredenciales {
  leer(): Credenciales | null;
  guardar(c: Credenciales): void;
}

// PDF de la hoja de un depto. En Electron: ventana oculta + printToPDF (ver electron/main.ts).
export interface GeneradorPdf {
  generar(ruta: string): Promise<Buffer>;   // ruta de la app a imprimir, p. ej. "/?imprimir=1&mes=…"
  carpeta(mes: string): string;             // dónde se guardan los PDF del mes
  abrir(ruta: string): void;                // abre el archivo o la carpeta en Windows
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

export function crearApp(db: DatabaseSync, version: string, opciones: { credenciales?: AlmacenCredenciales; urlStays?: string; pdf?: GeneradorPdf } = {}) {
  const app = express();
  const { credenciales, urlStays = URL_STAYS, pdf } = opciones;
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
             r.estado_stays, r.ajuste_ars, r.ajuste_usd, r.ajuste_comision_ars, r.ajuste_comision_usd, r.observacion, r.excluida,
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

  // Ajustes manuales de una reserva (pestañas 🖊 del Excel). "Traer mes" no los pisa.
  app.put('/api/reservas/:id', (req, res) => {
    const b = req.body ?? {};
    const importes = ['ajuste_ars', 'ajuste_usd', 'ajuste_comision_ars', 'ajuste_comision_usd'] as const;
    if (importes.some((k) => !Number.isInteger(b[k])) || ![0, 1].includes(b.excluida)
      || (b.observacion !== null && typeof b.observacion !== 'string')) {
      res.status(400).json({ error: 'Ajustes inválidos: importes en centavos enteros, excluida 0 o 1, observación texto o null' });
      return;
    }
    const id = Number(req.params.id);
    const antes = db.prepare(`SELECT ${importes.join(', ')}, observacion, excluida FROM reserva WHERE id = ?`).get(id);
    if (!antes) {
      res.status(404).json({ error: 'No existe la reserva' });
      return;
    }
    // Mes cerrado = congelado: su liquidación ya tomó estos ajustes; cambiarlos descuadraría el total.
    const cerrado = db.prepare(`
      SELECT p.mes FROM reserva r JOIN periodo p ON p.estado = 'cerrado'
        AND ${SQL_EN_PERIODO.replaceAll(':inicio', 'p.fecha_inicio').replaceAll(':cierre', 'p.fecha_cierre_reservas')}
      WHERE r.id = ? ORDER BY p.mes LIMIT 1`).get(id) as { mes: string } | undefined;
    if (cerrado) {
      res.status(400).json({ error: `La reserva es parte del mes cerrado ${cerrado.mes}: reabrilo para cambiar sus ajustes.` });
      return;
    }
    const despues = { ...Object.fromEntries(importes.map((k) => [k, b[k]])), observacion: b.observacion?.trim() || null, excluida: b.excluida };
    db.prepare(`UPDATE reserva SET ajuste_ars = :ajuste_ars, ajuste_usd = :ajuste_usd, ajuste_comision_ars = :ajuste_comision_ars,
      ajuste_comision_usd = :ajuste_comision_usd, observacion = :observacion, excluida = :excluida WHERE id = :id`).run({ ...despues, id });
    auditar(db, 'reserva', id, 'modificacion', antes, despues);
    res.json(despues);
  });

  // ---- Períodos y liquidación
  app.get('/api/periodos', (_req, res) => {
    res.json(db.prepare('SELECT mes, estado, usd_cotizacion, usd_descuento_pct, fecha_pago FROM periodo ORDER BY mes DESC').all());
  });

  // Cotización del dólar cripto al cierre (manual por ahora; ponytail: la consulta automática viene después).
  app.put('/api/periodos/:mes/cotizacion', (req, res) => {
    const cotizacion = req.body?.cotizacion;
    const p = db.prepare('SELECT id, estado, usd_cotizacion FROM periodo WHERE mes = ?').get(req.params.mes) as { id: number; estado: string; usd_cotizacion: number | null } | undefined;
    if (!p) { res.status(404).json({ error: 'No existe el período' }); return; }
    if (p.estado !== 'abierto') { res.status(400).json({ error: 'El período está cerrado' }); return; }
    if (typeof cotizacion !== 'number' || !(cotizacion > 0)) { res.status(400).json({ error: 'Cotización inválida' }); return; }
    db.prepare(`UPDATE periodo SET usd_cotizacion = ?, usd_cotizacion_fuente = 'manual' WHERE id = ?`).run(cotizacion, p.id);
    auditar(db, 'periodo', p.id, 'modificacion', { usd_cotizacion: p.usd_cotizacion }, { usd_cotizacion: cotizacion });
    res.json({ cotizacion });
  });

  app.get('/api/liquidacion', (req, res) => {
    try {
      res.json(liquidarPeriodo(db, String(req.query.mes ?? '')));
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  });

  app.post('/api/liquidacion/comparar', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Falta el archivo .xlsx' });
      return;
    }
    try {
      res.json(compararConExcel(db, String(req.query.mes ?? ''), req.body));
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  });

  // ---- Movimientos (reemplaza CORRIENTE). Los errores de validación vuelven como 400.
  const intentar = (res: Response, fn: () => unknown) => {
    try {
      res.json(fn() ?? { ok: true });
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  };
  app.get('/api/movimientos', (req, res) => { res.json(listarMovimientos(db, String(req.query.mes ?? ''))); });
  app.post('/api/movimientos', (req, res) => intentar(res, () => ({ id: crearMovimiento(db, req.body ?? {}) })));
  app.put('/api/movimientos/:id', (req, res) => intentar(res, () => editarMovimiento(db, Number(req.params.id), req.body ?? {})));
  app.post('/api/movimientos/:id/anular', (req, res) => intentar(res, () => anularMovimiento(db, Number(req.params.id))));
  app.post('/api/transferencias', (req, res) => intentar(res, () => ({ id: transferir(db, req.body ?? {}) })));
  app.get('/api/conceptos', (_req, res) => {
    res.json(db.prepare('SELECT id, nombre FROM concepto WHERE activo = 1 ORDER BY nombre').all());
  });

  // ---- Cuentas y medios de pago de Stays
  app.get('/api/cuentas', (_req, res) => {
    res.json(db.prepare('SELECT cuenta_id AS id, nombre, moneda, activo, saldo, saldo_desde FROM v_saldo_cuenta ORDER BY activo DESC, nombre').all());
  });
  app.post('/api/cuentas', (req, res) => intentar(res, () => {
    const { nombre, moneda } = req.body ?? {};
    if (typeof nombre !== 'string' || !nombre.trim() || (moneda !== 'ARS' && moneda !== 'USD')) throw new Error('Faltan el nombre o la moneda (ARS o USD).');
    if (db.prepare('SELECT 1 FROM cuenta WHERE lower(nombre) = lower(?)').get(nombre.trim())) throw new Error(`Ya existe la cuenta ${nombre.trim()}.`);
    const id = Number(db.prepare('INSERT INTO cuenta(nombre, moneda) VALUES (?, ?)').run(nombre.trim(), moneda).lastInsertRowid);
    auditar(db, 'cuenta', id, 'alta', null, { nombre: nombre.trim(), moneda });
    return { id };
  }));
  // La moneda no se cambia: los movimientos ya cargados quedarían en la moneda equivocada.
  app.put('/api/cuentas/:id', (req, res) => intentar(res, () => {
    const { nombre, activo } = req.body ?? {};
    const id = Number(req.params.id);
    const antes = db.prepare('SELECT nombre, activo FROM cuenta WHERE id = ?').get(id);
    if (!antes) throw new Error('No existe la cuenta.');
    if (typeof nombre !== 'string' || !nombre.trim() || ![0, 1].includes(activo)) throw new Error('Faltan el nombre o si está activa.');
    db.prepare('UPDATE cuenta SET nombre = ?, activo = ? WHERE id = ?').run(nombre.trim(), activo, id);
    auditar(db, 'cuenta', id, 'modificacion', antes, { nombre: nombre.trim(), activo });
  }));
  app.get('/api/medios-pago', (_req, res) => {
    res.json(db.prepare(`
      SELECT mp.id, mp.nombre, mp.tipo_stays, mp.moneda, mp.descuenta_comision, mp.cuenta_id, mp.activo,
             (SELECT count(*) FROM pago p WHERE p.medio_pago_id = mp.id) AS pagos
      FROM medio_pago mp ORDER BY mp.activo DESC, mp.nombre`).all());
  });
  // Asociar un medio de pago de Stays a una cuenta (y corregir su moneda o si descuenta comisión).
  app.put('/api/medios-pago/:id', (req, res) => intentar(res, () => {
    const { cuenta_id, moneda, descuenta_comision } = req.body ?? {};
    const id = Number(req.params.id);
    const antes = db.prepare('SELECT cuenta_id, moneda, descuenta_comision FROM medio_pago WHERE id = ?').get(id);
    if (!antes) throw new Error('No existe el medio de pago.');
    if ((moneda !== 'ARS' && moneda !== 'USD') || ![0, 1].includes(descuenta_comision)) throw new Error('Moneda (ARS o USD) o comisión inválidas.');
    if (cuenta_id != null) {
      const c = db.prepare('SELECT nombre, moneda FROM cuenta WHERE id = ?').get(cuenta_id) as { nombre: string; moneda: string } | undefined;
      if (!c) throw new Error('No existe la cuenta.');
      if (c.moneda !== moneda) throw new Error(`La cuenta ${c.nombre} es en ${c.moneda} y el medio de pago en ${moneda}.`);
    }
    db.prepare('UPDATE medio_pago SET cuenta_id = ?, moneda = ?, descuenta_comision = ? WHERE id = ?').run(cuenta_id ?? null, moneda, descuenta_comision, id);
    auditar(db, 'medio_pago', id, 'modificacion', antes, { cuenta_id: cuenta_id ?? null, moneda, descuenta_comision });
  }));

  // ---- Cierre del mes, transferencias y PDF
  app.post('/api/periodos/:mes/cerrar', (req, res) => intentar(res, () => cerrarPeriodo(db, req.params.mes)));
  app.post('/api/periodos/:mes/reabrir', (req, res) => intentar(res, () => reabrirPeriodo(db, req.params.mes)));
  app.get('/api/transferencias', (req, res) => { res.json(listarTransferencias(db, String(req.query.mes ?? ''))); });
  app.post('/api/liquidaciones/:id/pagar', (req, res) => intentar(res, () => ({ id: pagarLiquidacion(db, Number(req.params.id), req.body ?? {}) })));
  app.get('/api/transferencias/excel', (req, res) => {
    const mes = String(req.query.mes ?? '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="transferencias-${mes}.xlsx"`);
    res.send(excelTransferencias(db, mes));
  });
  app.get('/api/hoja', (req, res) => intentar(res, () => hojaDepto(db, String(req.query.mes ?? ''), String(req.query.depto ?? ''))));

  // Genera los PDF (uno o todos los deptos del mes), los guarda en la carpeta del mes y la abre.
  app.post('/api/liquidacion/pdf', async (req, res) => {
    const { mes, depto } = req.body ?? {};
    if (!pdf) { res.status(400).json({ error: 'Esta instalación no genera PDF' }); return; }
    try {
      const deptos = depto ? [String(depto)] : (db.prepare(`
        SELECT d.codigo FROM liquidacion l JOIN periodo p ON p.id = l.periodo_id JOIN depto d ON d.id = l.depto_id
        WHERE p.mes = ? ORDER BY d.codigo`).all(String(mes)) as { codigo: string }[]).map((x) => x.codigo);
      if (!deptos.length) throw new Error(`${mes} no tiene liquidaciones cerradas: cerrá el mes o elegí un depto.`);
      for (const codigo of deptos) hojaDepto(db, String(mes), codigo); // valida antes de abrir ventanas
      // configuracion.pdf.carpeta permite guardarlos en otra carpeta (Drive, por ejemplo), una subcarpeta por mes.
      const base = (db.prepare(`SELECT valor FROM configuracion WHERE clave = 'pdf.carpeta'`).get() as { valor: string } | undefined)?.valor;
      const carpeta = base ? join(base, String(mes)) : pdf.carpeta(String(mes));
      mkdirSync(carpeta, { recursive: true });
      const archivos: string[] = [];
      for (const codigo of deptos) {
        const ruta = join(carpeta, `${codigo}.pdf`);
        writeFileSync(ruta, await pdf.generar(`/?imprimir=1&mes=${encodeURIComponent(String(mes))}&depto=${encodeURIComponent(codigo)}`));
        archivos.push(ruta);
      }
      pdf.abrir(archivos.length === 1 ? archivos[0] : carpeta);
      res.json({ carpeta, archivos });
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
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
