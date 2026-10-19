// Factura de los honorarios al pagar la liquidación de un depto y su NC si el pago se anula (plan 031, etapas 5-6; plan 033).
// Una factura por pago. Se escribe en la base DESPUÉS de que ARCA responde, nunca antes; cada intento
// (aprobado o rechazado) queda en `comprobante`. Lógica de Roble (electron/db/repos/facturacion.js).
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { consultarComprobante, ErrorArca, esErrorDeToken, solicitarCAE, ultimoAutorizado } from './arca.ts';
import { hoyLocal, type Fetch } from './cotizacion.ts';
import { descartarTicket, emisorConClave, ticketAcceso, type AlmacenClaves, type Emisor } from './emisores.ts';
import { COND_IVA, desglosarIva, fechaArca, fechaComprobante, isoDeArca, LETRA_CBTE, notaCreditoDe, tipoComprobante, type CondicionIva, type Importes } from './fiscal.ts';

interface Pago {
  movimiento_id: number; estado: string; fecha: string; importe: number; periodo_id: number; mes: string;
  depto_id: number; codigo: string; honorarios: number; saldo: number; propietario_id: number; propietario: string; es_hornera: number;
  fiscal_razon_social: string | null; fiscal_doc_tipo: number | null; fiscal_doc_nro: string | null;
  fiscal_condicion_iva: string | null; fiscal_domicilio: string | null;
}

// El pago (movimiento 'liquidacion'), su liquidación y el dueño de ese mes. Saldo e importe van en la
// moneda de liquidación (la otra columna es 0); los honorarios siempre en ARS.
function leerPago(db: DatabaseSync, movimientoId: number) {
  const p = db.prepare(`
    SELECT m.id AS movimiento_id, m.estado, m.fecha, -(m.importe_ars + m.importe_usd) AS importe, p.id AS periodo_id, p.mes,
           d.id AS depto_id, d.codigo, -l.honorarios AS honorarios, l.saldo_final_ars + l.saldo_final_usd AS saldo,
           pr.id AS propietario_id, pr.nombre AS propietario, pr.es_hornera, pr.fiscal_razon_social, pr.fiscal_doc_tipo,
           pr.fiscal_doc_nro, pr.fiscal_condicion_iva, pr.fiscal_domicilio
    FROM movimiento m JOIN periodo p ON p.id = m.periodo_id JOIN depto d ON d.id = m.depto_id
    JOIN liquidacion l ON l.periodo_id = m.periodo_id AND l.depto_id = m.depto_id
    JOIN propietario pr ON pr.id = COALESCE(l.propietario_id, d.propietario_id)
    WHERE m.id = ? AND m.tipo = 'liquidacion'`).get(movimientoId) as unknown as Pago | undefined;
  if (!p) throw new Error('No existe ese pago de liquidación.');
  return p;
}

// Facturado de la liquidación del depto: facturas aprobadas menos sus NC, por ambiente (una factura de
// homologación es de prueba: no cuenta para el tope ni impide la de producción).
const facturado = (db: DatabaseSync, p: Pago, ambiente: string) => (db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN cbte_tipo IN (3, 8, 13) THEN -importe ELSE importe END), 0) AS n FROM comprobante
  WHERE periodo_id = ? AND depto_id = ? AND estado = 'aprobado' AND ambiente = ?`).get(p.periodo_id, p.depto_id, ambiente) as { n: number }).n;

const ambienteDe = (db: DatabaseSync, emisorId: number | null) =>
  (emisorId && (db.prepare('SELECT ambiente FROM emisor WHERE id = ?').get(emisorId) as { ambiente: string } | undefined)?.ambiente) || 'produccion';

/**
 * Qué factura proponer para un pago: su parte de los honorarios, honorarios × pago ÷ saldo. Si con eso lo
 * facturado pasa los honorarios, avisa (no impide). Sin saldo a pagar no se factura.
 */
export function propuesta(db: DatabaseSync, movimientoId: number, emisorId: number | null = null) {
  const p = leerPago(db, movimientoId);
  const base = { honorarios: p.honorarios, mes: p.mes, codigo: p.codigo, propietario: p.propietario, importe_pago: p.importe, fecha_pago: p.fecha };
  if (p.saldo <= 0 || p.honorarios <= 0 || p.es_hornera) {
    return { ...base, ofrece: false as const, motivo: p.es_hornera ? 'El depto es de Hornera.' : 'La liquidación no tiene honorarios o saldo a pagar.' };
  }
  const ya = facturado(db, p, ambienteDe(db, emisorId));
  const propuesto = Math.round(p.honorarios * p.importe / p.saldo);
  return {
    ...base, ofrece: true as const, facturado: ya, propuesto,
    aviso: ya + propuesto > p.honorarios ? 'Con esta factura lo facturado del mes pasa los honorarios del depto.' : null,
  };
}

/** Pedido de reintento cuando ARCA pudo haber autorizado el comprobante anterior (plan 033, regla 3). */
export class ErrorRevisar extends Error {
  numero: number;
  constructor(mensaje: string, numero: number) {
    super(mensaje);
    this.numero = numero;
  }
}

const ultimoDiaDelMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
export const numeroCbte = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`;

// ponytail: una emisión a la vez en toda la app (así tampoco hay dos por emisor ni por pago); por
// emisor si alguna vez emiten en paralelo. Vive en la PC servidor, la única que habla con ARCA.
let emitiendo = false;

// La emisión en curso, compartida por facturas y NC (ver `emitiendo`).
async function exclusivo<T>(fn: () => Promise<T>) {
  if (emitiendo) throw new Error('Ya se está emitiendo un comprobante: esperá a que termine.');
  emitiendo = true;
  try {
    return await fn();
  } finally {
    emitiendo = false;
  }
}

export const emitir = (db: DatabaseSync, claves: AlmacenClaves | undefined, movimientoId: number, cuerpo: unknown, f?: Fetch) =>
  exclusivo(() => emitirSinCandado(db, claves, movimientoId, cuerpo, f));
export const notaCredito = (db: DatabaseSync, claves: AlmacenClaves | undefined, comprobanteId: number, cuerpo: unknown, f?: Fetch) =>
  exclusivo(() => notaCreditoSinCandado(db, claves, comprobanteId, cuerpo, f));

interface Receptor { razon_social: string; doc_tipo: number; doc_nro: string; condicion_iva: CondicionIva; domicilio: string }
interface Factura {
  id: number; periodo_id: number; depto_id: number; propietario_id: number; movimiento_id: number; emisor_id: number; cbte_tipo: number;
  punto_venta: number; numero: number; fecha: string; serv_desde: string; serv_hasta: string; importe: number; receptor_json: string; ambiente: string;
}

// Factura aprobada sin una NC aprobada que la anule (alias `c`).
export const SQL_FACTURA_VIGENTE = `c.estado = 'aprobado' AND c.asociado_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM comprobante nc WHERE nc.asociado_id = c.id AND nc.estado = 'aprobado')`;

/** La factura vigente de un pago (la de producción antes que la de prueba), o null. */
export function facturaVigente(db: DatabaseSync, movimientoId: number) {
  return (db.prepare(`SELECT c.id, c.punto_venta, c.numero, c.importe, c.ambiente, e.nombre AS emisor FROM comprobante c
      JOIN emisor e ON e.id = c.emisor_id WHERE c.movimiento_id = ? AND ${SQL_FACTURA_VIGENTE}
      ORDER BY c.ambiente = 'produccion' DESC, c.id LIMIT 1`)
    .get(movimientoId) as { id: number; punto_venta: number; numero: number; importe: number; ambiente: string; emisor: string } | undefined) ?? null;
}

async function emitirSinCandado(db: DatabaseSync, claves: AlmacenClaves | undefined, movimientoId: number, cuerpo: unknown, f?: Fetch) {
  const b = (cuerpo ?? {}) as { emisor_id?: unknown; importe?: unknown; revisado?: unknown };
  const p = leerPago(db, movimientoId);
  if (p.estado !== 'vigente') throw new Error('El pago está anulado: no se factura.');
  if (p.saldo <= 0 || p.es_hornera) throw new Error('Esta liquidación no se factura.');
  const importe = b.importe as number;
  if (!Number.isSafeInteger(importe) || importe <= 0) throw new Error('El importe va en centavos enteros y positivos.');
  const { e, keyPem } = emisorConClave(db, claves, Number(b.emisor_id));
  if (!e.activo) throw new Error(`${e.nombre} no está activo como emisor.`);

  const r = { razon_social: p.fiscal_razon_social, doc_tipo: p.fiscal_doc_tipo, doc_nro: p.fiscal_doc_nro,
    condicion_iva: p.fiscal_condicion_iva as CondicionIva | null, domicilio: p.fiscal_domicilio };
  if (!r.razon_social || !r.doc_tipo || !r.doc_nro || !r.condicion_iva || !r.domicilio) {
    throw new Error(`Faltan los datos fiscales de ${p.propietario}: completalos en Propietarios → Datos fiscales.`);
  }
  const vigente = db.prepare(`SELECT punto_venta, numero FROM comprobante c WHERE movimiento_id = ? AND ambiente = ? AND ${SQL_FACTURA_VIGENTE}`)
    .get(movimientoId, e.ambiente) as { punto_venta: number; numero: number } | undefined;
  if (vigente) throw new Error(`Este pago ya tiene la factura ${numeroCbte(vigente.punto_venta, vigente.numero)}.`);

  return autorizar(db, e, keyPem, {
    periodo_id: p.periodo_id, depto_id: p.depto_id, propietario_id: p.propietario_id, movimiento_id: movimientoId,
    cbteTipo: tipoComprobante(e.condicion_iva, r.condicion_iva), importe, imp: desglosarIva(importe, e.condicion_iva),
    receptor: r as Receptor, servDesde: `${p.mes}-01`, servHasta: ultimoDiaDelMes(p.mes), fechaBase: p.fecha, asociado: null,
    auditoria: { pago: movimientoId, depto: p.codigo, mes: p.mes },
  }, b.revisado === true, f);
}

/**
 * NC de una factura (pago anulado): mismo emisor, importe, receptor congelado y período del servicio que la
 * factura (plan 033, regla 2), con fecha de hoy. La letra sale de la factura (`notaCreditoDe`), no de las
 * condiciones de hoy.
 */
async function notaCreditoSinCandado(db: DatabaseSync, claves: AlmacenClaves | undefined, comprobanteId: number, cuerpo: unknown, f?: Fetch) {
  const fac = db.prepare(`SELECT c.* FROM comprobante c WHERE c.id = ? AND ${SQL_FACTURA_VIGENTE}`).get(comprobanteId) as unknown as Factura | undefined;
  if (!fac) throw new Error('Esa factura no existe o ya tiene su nota de crédito.');
  // ponytail: solo la de un pago anulado; corregir el importe de un pago vigente (NC + otra factura) no se pide.
  if ((db.prepare('SELECT estado FROM movimiento WHERE id = ?').get(fac.movimiento_id) as { estado: string }).estado !== 'anulado') {
    throw new Error('La nota de crédito se emite al anular el pago: este pago está vigente.');
  }
  const { e, keyPem } = emisorConClave(db, claves, fac.emisor_id);
  // El certificado de un ambiente no vale en el otro: una factura de homologación se anula en homologación.
  if (e.ambiente !== fac.ambiente) throw new Error(`${e.nombre} ya no está en ${fac.ambiente}: la nota de crédito se emite en el ambiente de la factura.`);
  const cbteTipo = notaCreditoDe(fac.cbte_tipo);
  return autorizar(db, e, keyPem, {
    periodo_id: fac.periodo_id, depto_id: fac.depto_id, propietario_id: fac.propietario_id, movimiento_id: fac.movimiento_id, cbteTipo,
    importe: fac.importe, imp: desglosarIva(fac.importe, LETRA_CBTE[cbteTipo] === 'C' ? 'monotributista' : 'responsable_inscripto'),
    receptor: JSON.parse(fac.receptor_json) as Receptor, servDesde: fac.serv_desde, servHasta: fac.serv_hasta, fechaBase: hoyLocal(),
    asociado: fac, auditoria: { nota_credito_de: numeroCbte(fac.punto_venta, fac.numero), pago: fac.movimiento_id },
  }, (cuerpo as { revisado?: unknown } | null)?.revisado === true, f);
}

/**
 * Pide el CAE y guarda el intento. No es una transacción: hay red en el medio; se escribe DESPUÉS de que
 * ARCA responde. Cada falla de ARCA o de red queda como intento rechazado.
 */
async function autorizar(db: DatabaseSync, e: Emisor, keyPem: string, c: {
  periodo_id: number; depto_id: number; propietario_id: number; movimiento_id: number; cbteTipo: number; importe: number;
  imp: Importes; receptor: Receptor; servDesde: string; servHasta: string; fechaBase: string; asociado: Factura | null; auditoria: object;
}, revisado: boolean, f?: Fetch) {
  const { cbteTipo } = c;
  const hoy = hoyLocal();
  const wsfe = { cuit: e.cuit, ambiente: e.ambiente, puntoVenta: e.punto_venta, fetch: f };

  const guardar = (x: { estado: 'aprobado' | 'rechazado'; fecha: string; numero?: number; cae?: string; vencimiento?: string;
    motivo?: string | null; observaciones?: string | null; request?: string | null; response?: string | null }) =>
    Number(db.prepare(`INSERT INTO comprobante(periodo_id, depto_id, propietario_id, movimiento_id, emisor_id, cbte_tipo, punto_venta, numero,
        cae, cae_vencimiento, fecha, serv_desde, serv_hasta, importe, receptor_json, estado, ambiente, motivo, observaciones,
        request_json, response_json, asociado_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      c.periodo_id, c.depto_id, c.propietario_id, c.movimiento_id, e.id, cbteTipo, e.punto_venta, x.numero ?? null,
      x.cae ?? null, x.vencimiento ?? null, x.fecha, c.servDesde, c.servHasta, c.importe, JSON.stringify(c.receptor), x.estado, e.ambiente,
      x.motivo ?? null, x.observaciones ?? null, x.request ?? null, x.response ?? null, c.asociado?.id ?? null,
      new Date().toLocaleString('sv-SE').slice(0, 19),
    ).lastInsertRowid);
  // Un ticket que ARCA no acepta se borra para que el próximo intento pida otro.
  const fallo = (err: unknown, fecha: string, request: string | null = null) => {
    if (esErrorDeToken(err)) descartarTicket(db, e);
    if (err instanceof ErrorArca && err.tipo !== 'config') guardar({ estado: 'rechazado', fecha, motivo: err.message, request });
    return err;
  };

  let ta, ultimo: number, fechaUltimo: string | null = null;
  try {
    ta = await ticketAcceso(db, e, keyPem, 'wsfe', f);
    ultimo = await ultimoAutorizado({ ta, ...wsfe, cbteTipo });
    // La fecha del último autorizado es el piso: ARCA rechaza uno posterior con fecha anterior (10016).
    if (ultimo > 0) {
      const previo = await consultarComprobante({ ta, ...wsfe, cbteTipo, numero: ultimo });
      if (previo.fecha) fechaUltimo = isoDeArca(previo.fecha);
    }
  } catch (err) {
    throw fallo(err, fechaComprobante({ fechaPago: c.fechaBase, hoy }));
  }

  // Plan 033, regla 3: un intento anterior sin respuesta (timeout al pedir el CAE) pudo haber sido autorizado.
  // Si la numeración llegó a ese número, no se emite a ciegas: se revisa en ARCA y se confirma.
  // ponytail: aviso manual; el upgrade es FECompConsultar del número y guardar el CAE recuperado.
  // Solo si es el último intento: uno posterior (ya revisado) responde por él.
  const anterior = db.prepare(`SELECT estado, response_json IS NULL AND json_valid(request_json) AS sin_respuesta,
      json_extract(CASE WHEN json_valid(request_json) THEN request_json END, '$.numero') AS numero FROM comprobante
      WHERE movimiento_id = ? AND emisor_id = ? AND ambiente = ? AND cbte_tipo = ? ORDER BY id DESC LIMIT 1`)
    .get(c.movimiento_id, e.id, e.ambiente, cbteTipo) as { estado: string; sin_respuesta: number; numero: number } | undefined;
  const sinRespuesta = anterior?.estado === 'rechazado' && anterior.sin_respuesta ? anterior : undefined;
  if (sinRespuesta && ultimo >= sinRespuesta.numero && !revisado) {
    throw new ErrorRevisar(`ARCA puede haber autorizado el comprobante n.º ${numeroCbte(e.punto_venta, sinRespuesta.numero)}: `
      + 'revisalo en Comprobantes en Línea antes de reintentar.', sinRespuesta.numero);
  }

  // Plan 033, regla 1: FchVtoPago = CbteFch, que fechaComprobante puede subir hasta el último autorizado.
  const cbteFecha = fechaComprobante({ fechaPago: c.fechaBase, fechaUltimo, hoy });
  const r = c.receptor;
  const a = c.asociado;
  const pedido = {
    cbteTipo, numero: ultimo + 1, docTipo: r.doc_tipo, docNro: r.doc_nro, condIvaReceptor: COND_IVA[r.condicion_iva], imp: c.imp,
    fecha: fechaArca(cbteFecha), concepto: 2 as const, servDesde: fechaArca(c.servDesde), servHasta: fechaArca(c.servHasta), vtoPago: fechaArca(cbteFecha),
    cbteAsoc: a && { tipo: a.cbte_tipo, puntoVenta: a.punto_venta, numero: a.numero, fecha: fechaArca(a.fecha) },
  };
  let res;
  try {
    res = await solicitarCAE({ ta, ...wsfe, ...pedido });
  } catch (err) {
    // Sin respuesta: se guarda lo pedido (sin ticket) para la regla 3. response_json NULL = no contestó.
    throw fallo(err, cbteFecha, (err as ErrorArca).tipo === 'red' ? JSON.stringify(pedido) : null);
  }

  const observaciones = res.observaciones.length ? res.observaciones.join(' | ') : null;
  if (!res.aprobado) {
    guardar({ estado: 'rechazado', fecha: cbteFecha, motivo: res.motivo, observaciones, request: res.request, response: res.response });
    if (esErrorDeToken({ codigos: res.codigos, message: res.motivo })) descartarTicket(db, e);
    throw new ErrorArca(`ARCA rechazó ${a ? 'la nota de crédito' : 'la factura'}: ${res.motivo}`, { codigos: res.codigos });
  }
  const vencimiento = isoDeArca(res.vencimiento);
  const id = guardar({ estado: 'aprobado', fecha: cbteFecha, numero: res.numero, cae: res.cae, vencimiento, observaciones,
    request: res.request, response: res.response });
  auditar(db, 'comprobante', id, 'alta', null, { ...c.auditoria, emisor: e.nombre, cbte_tipo: cbteTipo,
    numero: numeroCbte(e.punto_venta, res.numero), importe: c.importe, ambiente: e.ambiente });
  return { id, cbteTipo, puntoVenta: e.punto_venta, numero: res.numero, cae: res.cae, vencimiento, fecha: cbteFecha, observaciones };
}
