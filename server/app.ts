// API HTTP. La usan la ventana de Electron y las terminales de la red (server/terminales.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { importarExcel } from './importador/excel.ts';
import { importarGastos } from './importador/gastos.ts';
import { anularGastoAjeno, crearGastoAjeno, editarGastoAjeno, listarGastosAjenos } from './gastosAjenos.ts';
import { crearClienteStays, URL_STAYS, type Credenciales } from './stays/cliente.ts';
import { sincronizarMes } from './stays/sync.ts';
import { SQL_EN_PERIODO } from './periodo.ts';
import { liquidacionGuardada, liquidarPeriodo } from './liquidacion/servicio.ts';
import { compararConExcel } from './liquidacion/comparar.ts';
import { auditar, listarAuditoria } from './auditoria.ts';
import { actualizarCotizacion, type Fetch } from './cotizacion.ts';
import { anularMovimiento, crearMovimiento, editarMovimiento, listarMovimientos, transferir } from './movimientos.ts';
import { cerrarPeriodo, reabrirPeriodo } from './liquidacion/cierre.ts';
import { desmarcarSaldadoFuera, excelTransferencias, listarTransferencias, pagarLiquidacion, saldarFuera, saldarFueraHasta } from './liquidacion/pagos.ts';
import { hojaDepto } from './liquidacion/hoja.ts';
import { historial } from './liquidacion/historial.ts';
import { evolucion, resumenDelMes } from './resumen.ts';
import { borrarEmisor, cargarCertificado, crearEmisor, editarEmisor, listarEmisores, probarEmisor, type AlmacenClaves } from './emisores.ts';
import { ErrorArca } from './arca.ts';
import { desvincular, importarMisComprobantes, listarMisComprobantes, vincular } from './misComprobantes.ts';
import { datosComprobante, detalleComprobante, emitir, ErrorRevisar, facturaVigente, listarComprobantes, notaCredito, propuesta } from './facturacion.ts';
import { datosFiscales, guardarDatosFiscales, padronDePropietario } from './propietarios.ts';
import { rutasBackup } from './backup.ts';
import { autorizar, esLocal, hostSinPuerto, nombresDeEstaPc, rutasTerminales, soloLocal } from './terminales.ts';

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

// Variables operativas editables. 'centavos' = entero >= 0; 'pct' = fracción entre 0 y 1; 'pct<1' = desde 0 y
// menor a 1 (se resta de 1 y divide: un 100 % deja el cambio en 0); '?' = admite null.
type Regla = 'centavos' | 'centavos?' | 'noches' | 'pct' | 'pct<1';
const PARAMETROS: Record<string, Regla> = {
  usd_descuento_pct: 'pct<1', costo_hora_limpieza: 'centavos', servicio_limpieza: 'centavos', servicio_lavanderia: 'centavos',
  prestamo_blanqueria: 'centavos', gestion_operativa: 'centavos', mantenimiento: 'centavos', tarifa_base: 'centavos',
  adicional_huesped: 'centavos', noches_tramo_1: 'noches', cargo_tramo_1: 'centavos', noches_tramo_2: 'noches',
  cargo_tramo_2: 'centavos', cm_fee_usd: 'centavos',
};
const VARIABLES_DEPTO: Record<string, Regla> = {
  comision_pct: 'pct', tarifa_base_override: 'centavos?', adicional_huesped_override: 'centavos?', cm_fee_usd_override: 'centavos?',
};

// Solo los campos conocidos que vienen en el cuerpo; cualquier valor fuera de regla corta todo.
function validar(reglas: Record<string, Regla>, cuerpo: unknown) {
  const nuevos: Record<string, number | null> = {};
  for (const [campo, v] of Object.entries((cuerpo ?? {}) as Record<string, unknown>)) {
    const regla = reglas[campo];
    if (!regla) continue;
    const ok = v === null ? regla === 'centavos?'
      : typeof v === 'number' && (regla === 'pct' ? v >= 0 && v <= 1 : regla === 'pct<1' ? v >= 0 && v < 1
        : Number.isSafeInteger(v) && (regla === 'noches' ? v >= 1 : v >= 0));
    if (!ok) throw new Error(`Valor inválido en ${campo}`);
    nuevos[campo] = v as number | null;
  }
  if (!Object.keys(nuevos).length) throw new Error('No hay nada para guardar');
  return nuevos;
}

function actualizar(db: DatabaseSync, tabla: 'periodo' | 'depto', fila: Record<string, unknown>, nuevos: Record<string, number | null>) {
  const campos = Object.keys(nuevos);
  db.prepare(`UPDATE ${tabla} SET ${campos.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`).run({ ...nuevos, id: fila.id as number });
  auditar(db, tabla, fila.id as number, 'modificacion', Object.fromEntries(campos.map((c) => [c, fila[c]])), nuevos);
  return nuevos;
}

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
// 127.0.0.1 o a la IP del servidor (DNS rebinding) manda su propio Host y queda afuera.
function hostPermitido(host: string) {
  const h = hostSinPuerto(host);
  return h === '127.0.0.1' || h === 'localhost' || nombresDeEstaPc().includes(h);
}

export function crearApp(db: DatabaseSync, version: string, opciones: { credenciales?: AlmacenCredenciales; urlStays?: string; pdf?: GeneradorPdf; fetchDolar?: Fetch; claves?: AlmacenClaves; fetchArca?: Fetch; desarrollo?: boolean; carpetaBackups?: string } = {}) {
  const app = express();
  const { credenciales, urlStays = URL_STAYS, pdf, fetchDolar = fetch, claves, fetchArca, desarrollo = false, carpetaBackups } = opciones;
  app.use((req, res, next) => {
    if (hostPermitido(req.headers.host ?? '')) return next();
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
  app.use('/api', autorizar(db));
  rutasTerminales(app, db);
  if (carpetaBackups) rutasBackup(app, db, carpetaBackups);

  // local: la ventana es la de la PC servidor (ahí se ve "Terminales").
  app.get('/api/estado', (req, res) => {
    res.json({ version, local: esLocal(req) });
  });

  app.get('/api/propietarios', (_req, res) => {
    res.json(db.prepare(`
      SELECT p.id, p.nombre, p.moneda_liquidacion, p.cbu IS NOT NULL AS tiene_cbu,
             (SELECT group_concat(codigo, ', ') FROM depto WHERE propietario_id = p.id) AS deptos
      FROM propietario p WHERE p.activo = 1 ORDER BY p.nombre`).all());
  });

  app.get('/api/deptos', (_req, res) => {
    res.json(db.prepare(`
      SELECT d.id, d.codigo, d.nombre, d.direccion, d.estado, d.comision_pct, d.tarifa_base_override,
             d.adicional_huesped_override, d.cm_fee_usd_override, p.nombre AS propietario,
             COALESCE(d.fotos, '[]') AS fotos
      FROM depto d JOIN propietario p ON p.id = d.propietario_id ORDER BY d.codigo`).all()
      .map((d) => ({ ...d, fotos: JSON.parse(d.fotos as string) })));
  });

  // El archivo viaja como application/octet-stream: no es un tipo "simple" de CORS,
  // así que una página web ajena no puede mandarlo sin preflight.
  app.post('/api/importar/excel', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Falta el archivo .xlsx' });
      return;
    }
    try {
      const r = importarExcel(db, req.body);
      const { avisos, ...resumen } = r;
      auditar(db, 'excel', null, 'importacion', null, { ...resumen, avisos: avisos.length });
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  });

  app.post('/api/importar/gastos', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Falta el archivo .xlsx' });
      return;
    }
    intentar(res, () => {
      const r = importarGastos(db, req.body);
      auditar(db, 'gastos', null, 'importacion', null, { importados: r.importados, repetidos: r.repetidos, anteriores: r.anteriores, avisos: r.avisos.length });
      return r;
    });
  });

  // ---- Stays. La clave nunca vuelve al cliente.
  app.get('/api/stays', (_req, res) => {
    res.json({ usuario: credenciales?.leer()?.usuario ?? null });
  });

  // Solo en el servidor: la clave no viaja por la red local (HTTP sin cifrar).
  app.put('/api/stays/credenciales', soloLocal, (req, res) => {
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
      const reporte = await sincronizarMes(db, crearClienteStays(creds, url), String(req.body?.mes ?? ''));
      // El dólar viene con "traer mes"; si falla, Stays queda traído igual y se avisa.
      try {
        const { aviso } = await actualizarCotizacion(db, reporte.mes, false, fetchDolar);
        if (aviso) reporte.avisos.push(aviso);
      } catch (e) {
        reporte.avisos.push(`${mensaje(e)} Cargala a mano en Liquidación.`);
      }
      const { avisos, ...resumen } = reporte;
      // Un renglón por cada vez que se trae el mes, con el resumen; no uno por reserva (decisión 2026-10-21).
      auditar(db, 'stays', null, 'importacion', null, { ...resumen, avisos: avisos.length });
      res.json(reporte);
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
             r.cancelada, r.hora_llegada, r.hora_salida, r.desglose_json,
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
    // provisoria: de la API pero de un momento, no la del cierre (server/cotizacion.ts).
    res.json(db.prepare(`SELECT mes, estado, usd_cotizacion, usd_cotizacion_fuente, usd_cotizacion_fecha, usd_descuento_pct, fecha_pago,
        usd_cotizacion_fuente = 'api' AND usd_cotizacion_provisoria = 1 AS provisoria
      FROM periodo ORDER BY mes DESC`).all());
  });

  // Volver a pedir la cotización a la API, aunque esté cargada a mano.
  app.post('/api/periodos/:mes/cotizacion/traer', async (req, res) => {
    try {
      res.json(await actualizarCotizacion(db, req.params.mes, true, fetchDolar));
    } catch (e) {
      res.status(/^No se pudo traer/.test(mensaje(e)) ? 502 : 400).json({ error: mensaje(e) });
    }
  });

  // Cotización del dólar cripto al cierre cargada a mano: "traer mes" ya no la pisa.
  app.put('/api/periodos/:mes/cotizacion', (req, res) => {
    const cotizacion = req.body?.cotizacion;
    const p = db.prepare('SELECT id, estado, usd_cotizacion FROM periodo WHERE mes = ?').get(req.params.mes) as { id: number; estado: string; usd_cotizacion: number | null } | undefined;
    if (!p) { res.status(404).json({ error: 'No existe el período' }); return; }
    if (p.estado !== 'abierto') { res.status(400).json({ error: 'El período está cerrado' }); return; }
    if (typeof cotizacion !== 'number' || !(cotizacion > 0)) { res.status(400).json({ error: 'Cotización inválida' }); return; }
    db.prepare(`UPDATE periodo SET usd_cotizacion = ?, usd_cotizacion_fuente = 'manual', usd_cotizacion_fecha = NULL, usd_cotizacion_provisoria = 0 WHERE id = ?`).run(cotizacion, p.id);
    auditar(db, 'periodo', p.id, 'modificacion', { usd_cotizacion: p.usd_cotizacion }, { usd_cotizacion: cotizacion });
    res.json({ cotizacion });
  });

  // Variables operativas del mes (tarifas de limpieza, lavandería, etc.). "Traer mes" las copia al mes siguiente.
  app.get('/api/periodos/:mes/parametros', (req, res) => {
    const p = db.prepare(`SELECT estado, ${Object.keys(PARAMETROS).join(', ')} FROM periodo WHERE mes = ?`).get(req.params.mes);
    if (!p) { res.status(404).json({ error: 'No existe el período' }); return; }
    res.json(p);
  });
  app.put('/api/periodos/:mes/parametros', (req, res) => intentar(res, () => {
    const p = db.prepare(`SELECT id, estado, ${Object.keys(PARAMETROS).join(', ')} FROM periodo WHERE mes = ?`).get(req.params.mes) as any;
    if (!p) throw new Error('No existe el período');
    if (p.estado !== 'abierto') throw new Error('El período está cerrado');
    return actualizar(db, 'periodo', p, validar(PARAMETROS, req.body));
  }));
  // Comisión y tarifas propias de un depto (null en una tarifa = la del mes).
  app.put('/api/deptos/:id', (req, res) => intentar(res, () => {
    const d = db.prepare(`SELECT id, ${Object.keys(VARIABLES_DEPTO).join(', ')} FROM depto WHERE id = ?`).get(Number(req.params.id)) as any;
    if (!d) throw new Error('No existe el depto');
    return actualizar(db, 'depto', d, validar(VARIABLES_DEPTO, req.body));
  }));

  app.get('/api/liquidacion', (req, res) => {
    try {
      // Un mes cerrado se muestra como se guardó al cerrar, no recalculado con los datos de hoy.
      const mes = String(req.query.mes ?? '');
      const cerrado = (db.prepare('SELECT estado FROM periodo WHERE mes = ?').get(mes) as { estado: string } | undefined)?.estado === 'cerrado';
      res.json(cerrado ? liquidacionGuardada(db, mes) : liquidarPeriodo(db, mes));
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  });

  app.get('/api/auditoria', (req, res) => intentar(res, () => listarAuditoria(db, String(req.query.mes ?? ''))));

  app.get('/api/resumen', (req, res) => intentar(res, () => resumenDelMes(db, String(req.query.mes ?? ''))));
  app.get('/api/resumen/evolucion', (_req, res) => { res.json(evolucion(db)); });

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
  // El origen lo pone solo el importador de gastos.
  app.post('/api/movimientos', (req, res) => intentar(res, () => ({ id: crearMovimiento(db, { ...req.body, origen: null }) })));
  app.put('/api/movimientos/:id', (req, res) => intentar(res, () => editarMovimiento(db, Number(req.params.id), req.body ?? {})));
  // Anular un pago facturado no toca la factura: se devuelve para que la UI ofrezca la nota de crédito (plan 031).
  app.post('/api/movimientos/:id/anular', (req, res) => intentar(res, () => {
    anularMovimiento(db, Number(req.params.id));
    return { ok: true, facturaVigente: facturaVigente(db, Number(req.params.id)) };
  }));
  // Gastos ajenos (plan 047): el origen lo pone solo el importador de gastos.
  app.get('/api/gastos-ajenos', (req, res) => { res.json(listarGastosAjenos(db, String(req.query.mes ?? ''))); });
  app.post('/api/gastos-ajenos', (req, res) => intentar(res, () => ({ id: crearGastoAjeno(db, { ...req.body, origen: null }) })));
  app.put('/api/gastos-ajenos/:id', (req, res) => intentar(res, () => editarGastoAjeno(db, Number(req.params.id), req.body ?? {})));
  app.post('/api/gastos-ajenos/:id/anular', (req, res) => intentar(res, () => { anularGastoAjeno(db, Number(req.params.id)); return { ok: true }; }));
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
    if (db.prepare('SELECT 1 FROM cuenta WHERE lower(nombre) = lower(?) AND id <> ?').get(nombre.trim(), id)) throw new Error(`Ya existe la cuenta ${nombre.trim()}.`);
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
  app.post('/api/liquidaciones/:id/saldado-fuera', (req, res) => intentar(res, () => saldarFuera(db, Number(req.params.id), req.body ?? {})));
  app.delete('/api/liquidaciones/:id/saldado-fuera', (req, res) => intentar(res, () => desmarcarSaldadoFuera(db, Number(req.params.id))));
  app.post('/api/transferencias/saldado-fuera', (req, res) => intentar(res, () => ({ marcadas: saldarFueraHasta(db, String(req.body?.hasta ?? ''), req.body ?? {}) })));
  app.get('/api/historial', (req, res) => intentar(res, () => historial(db,
    { deptoId: Number(req.query.depto) || undefined, propietarioId: Number(req.query.propietario) || undefined }, req.query.anulados === '1')));
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
      if (esLocal(req)) pdf.abrir(archivos.length === 1 ? archivos[0] : carpeta); // desde una terminal se abriría en el servidor
      res.json({ carpeta, archivos, en_servidor: !esLocal(req) });
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  });

  // ---- Emisores de las facturas de honorarios (plan 031)
  app.get('/api/emisores', (_req, res) => { res.json(listarEmisores(db, claves)); });
  app.post('/api/emisores', (req, res) => intentar(res, () => crearEmisor(db, req.body)));
  app.put('/api/emisores/:id', (req, res) => intentar(res, () => editarEmisor(db, Number(req.params.id), req.body)));
  app.delete('/api/emisores/:id', (req, res) => intentar(res, () => borrarEmisor(db, Number(req.params.id))));
  // La clave privada viaja solo dentro de la PC servidor, como la clave de Stays.
  app.post('/api/emisores/:id/certificado', soloLocal, (req, res) => intentar(res, () => cargarCertificado(db, claves, Number(req.params.id), req.body)));
  app.post('/api/emisores/:id/probar', async (req, res) => {
    try {
      res.json(await probarEmisor(db, claves, Number(req.params.id), fetchArca));
    } catch (e) {
      res.status(e instanceof ErrorArca && e.tipo === 'red' ? 502 : 400).json({ error: mensaje(e) });
    }
  });

  // ---- Datos fiscales del propietario (receptor de las facturas, plan 031)
  app.get('/api/propietarios/:id/fiscal', (req, res) => intentar(res, () => datosFiscales(db, Number(req.params.id))));
  app.put('/api/propietarios/:id/fiscal', (req, res) => intentar(res, () => guardarDatosFiscales(db, Number(req.params.id), req.body)));
  app.post('/api/propietarios/:id/padron', async (req, res) => {
    try {
      res.json(await padronDePropietario(db, claves, Number(req.params.id), req.body, fetchArca));
    } catch (e) {
      res.status(e instanceof ErrorArca && e.tipo === 'red' ? 502 : 400).json({ error: mensaje(e) });
    }
  });

  // ---- Factura de los honorarios de un pago de liquidación (plan 031, etapa 5). El pago ya está registrado:
  // si ARCA falla, el intento queda rechazado y se reintenta desde Transferencias.
  app.get('/api/pagos/:id/factura', (req, res) => intentar(res, () => propuesta(db, Number(req.params.id), req.query.emisor ? Number(req.query.emisor) : null)));
  const conArca = async (res: Response, fn: () => Promise<unknown>) => {
    try {
      res.json(await fn());
    } catch (e) {
      if (e instanceof ErrorRevisar) return void res.status(409).json({ error: e.message, revisar: e.numero });
      res.status(e instanceof ErrorArca && e.tipo === 'red' ? 502 : 400).json({ error: mensaje(e) });
    }
  };
  app.post('/api/pagos/:id/factura', (req, res) => conArca(res, () => emitir(db, claves, Number(req.params.id), req.body, fetchArca)));
  // Pantalla Comprobantes: los de homologación solo con la app sin instalar.
  // Lo emitido en ARCA por cualquier medio: CSV de Mis Comprobantes (plan 036). Texto aparte: un año pasa el límite del JSON.
  app.post('/api/emisores/:id/mis-comprobantes', express.text({ type: 'text/csv', limit: '20mb' }), (req, res) =>
    intentar(res, () => importarMisComprobantes(db, Number(req.params.id), String(req.query.nombre ?? ''), typeof req.body === 'string' ? req.body : '')));
  app.get('/api/mis-comprobantes', (req, res) => intentar(res, () => listarMisComprobantes(db, String(req.query.mes ?? ''))));
  app.post('/api/mis-comprobantes/:id/vincular', (req, res) => intentar(res, () => vincular(db, Number(req.params.id), req.body)));
  app.post('/api/mis-comprobantes/:id/desvincular', (req, res) => intentar(res, () => desvincular(db, Number(req.params.id))));
  app.get('/api/comprobantes', (req, res) => intentar(res, () => listarComprobantes(db, String(req.query.mes ?? ''), desarrollo)));
  app.get('/api/comprobantes/:id/detalle', (req, res) => intentar(res, () => detalleComprobante(db, Number(req.params.id))));
  // PDF suelto de un comprobante: la vista imprimible (/?imprimir=1&comprobante=ID) con el generador de la hoja.
  app.get('/api/comprobantes/:id', (req, res) => intentar(res, () => datosComprobante(db, Number(req.params.id))));
  app.get('/api/comprobantes/:id/pdf', async (req, res) => {
    if (!pdf) { res.status(400).json({ error: 'Esta instalación no genera PDF' }); return; }
    try {
      const c = datosComprobante(db, Number(req.params.id));  // valida antes de abrir la ventana
      const archivo = await pdf.generar(`/?imprimir=1&comprobante=${c.id}`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${c.asociado ? 'nota-credito' : 'factura'}-${c.letra}-${c.numero}.pdf"`);
      res.send(archivo);
    } catch (e) {
      res.status(400).json({ error: mensaje(e) });
    }
  });
  app.post('/api/comprobantes/:id/nota-credito', (req, res) => conArca(res, () => notaCredito(db, claves, Number(req.params.id), req.body, fetchArca)));

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
