// Factura de los honorarios al pagar la liquidación de un depto y su NC si el pago se anula (plan 031, etapas 5-6; plan 033).
// Una factura por pago. Se escribe en la base DESPUÉS de que ARCA responde, nunca antes; cada intento
// (aprobado o rechazado) queda en `comprobante`. Lógica de Roble (electron/db/repos/facturacion.js).
import type { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import { auditar } from './auditoria.ts';
import { sello } from './sello.ts';
import { consultarComprobante, ErrorArca, esErrorDeToken, solicitarCAE, ultimoAutorizado } from './arca.ts';
import { hoyLocal, type Fetch } from './cotizacion.ts';
import { descartarTicket, emisorConClave, ticketAcceso, type AlmacenClaves, type Emisor } from './emisores.ts';
import { externaDePago, facturasExternas } from './misComprobantes.ts';
import { COND_IVA, desglosarIva, fechaArca, fechaComprobante, isoDeArca, LETRA_CBTE, NOMBRE_CBTE, notaCreditoDe, qrArca, tipoComprobante, type CondicionIva, type Importes } from './fiscal.ts';

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
// homologación es de prueba: no cuenta para el tope ni impide la de producción), más las hechas por fuera
// y vinculadas a sus pagos (plan 036; esas son siempre de producción).
const facturado = (db: DatabaseSync, p: Pago, ambiente: string) => (db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN cbte_tipo IN (3, 8, 13) THEN -importe ELSE importe END), 0)
    + CASE WHEN ? = 'produccion' THEN (SELECT COALESCE(SUM(ca.importe), 0) FROM comprobante_arca ca JOIN movimiento m ON m.id = ca.movimiento_id
        WHERE m.periodo_id = ? AND m.depto_id = ? AND m.estado = 'vigente') ELSE 0 END AS n FROM comprobante
  WHERE periodo_id = ? AND depto_id = ? AND estado = 'aprobado' AND ambiente = ?`)
  .get(ambiente, p.periodo_id, p.depto_id, p.periodo_id, p.depto_id, ambiente) as { n: number }).n;

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
  const externa = externaDePago(db, movimientoId);
  if (externa) return { ...base, ofrece: false as const, motivo: `Ya tiene la factura ${numeroCbte(externa.punto_venta, externa.numero)} de ${externa.emisor}, hecha por fuera de Hornera.` };
  const ya = facturado(db, p, ambienteDe(db, emisorId));
  const propuesto = Math.round(p.honorarios * p.importe / p.saldo);
  return {
    ...base, ofrece: true as const, facturado: ya, propuesto, externas: facturasExternas(db, p.propietario_id, p.mes),
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
  const b = (cuerpo ?? {}) as { emisor_id?: unknown; importe?: unknown; revisado?: unknown; ignorar_externas?: unknown };
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
  // Plan 036: lo facturado por fuera (Comprobantes en Línea) no se factura de nuevo sin confirmarlo.
  const externa = externaDePago(db, movimientoId);
  if (externa) throw new Error(`Este pago ya tiene la factura ${numeroCbte(externa.punto_venta, externa.numero)}, hecha por fuera de Hornera.`);
  const externas = facturasExternas(db, p.propietario_id, p.mes);
  if (externas.length && b.ignorar_externas !== true) {
    throw new Error(`En ARCA ya hay ${externas.length === 1 ? 'una factura' : `${externas.length} facturas`} a ${p.propietario} hecha${externas.length === 1 ? '' : 's'} por fuera de Hornera: `
      + 'revisá si es de este pago antes de emitir otra.');
  }

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
      sello(),
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
  // Cuenta el último intento que llegó a pedir el CAE (con request_json), de cualquier emisor: los que fallaron antes
  // (login, último autorizado) no lo tapan, y uno posterior que ARCA contestó (ya revisado) responde por él.
  const anterior = db.prepare(`SELECT c.emisor_id, c.punto_venta, e.nombre AS emisor, c.response_json IS NULL AS sin_respuesta,
      json_extract(c.request_json, '$.numero') AS numero FROM comprobante c JOIN emisor e ON e.id = c.emisor_id
      WHERE c.movimiento_id = ? AND c.ambiente = ? AND c.cbte_tipo = ? AND json_valid(c.request_json) ORDER BY c.id DESC LIMIT 1`)
    .get(c.movimiento_id, e.ambiente, cbteTipo) as { emisor_id: number; punto_venta: number; emisor: string; sin_respuesta: number; numero: number } | undefined;
  const sinRespuesta = anterior?.sin_respuesta ? anterior : undefined;
  // Con otro emisor o punto de venta la numeración de ahora no dice nada del intento colgado: siempre se revisa.
  const mismaNumeracion = sinRespuesta?.emisor_id === e.id && sinRespuesta.punto_venta === e.punto_venta;
  if (sinRespuesta && (!mismaNumeracion || ultimo >= sinRespuesta.numero) && !revisado) {
    throw new ErrorRevisar(`ARCA puede haber autorizado el comprobante n.º ${numeroCbte(sinRespuesta.punto_venta, sinRespuesta.numero)}`
      + `${mismaNumeracion ? '' : ` de ${sinRespuesta.emisor}`}: revisalo en Comprobantes en Línea antes de reintentar.`, sinRespuesta.numero);
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

// ---- Pantalla Comprobantes (plan 035): lo emitido en un mes, por fecha de emisión.

/**
 * Comprobantes con fecha en `mes`: los aprobados y los rechazos pendientes (el último por pago y tipo, de una
 * factura cuyo pago sigue vigente o de una NC cuya factura sigue sin anular). Los de homologación, solo con la
 * app sin instalar (`desarrollo`).
 */
export function listarComprobantes(db: DatabaseSync, mes: string, desarrollo: boolean) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido (AAAA-MM).');
  const [a, m] = mes.split('-').map(Number);
  const siguiente = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  const crudas = db.prepare(`
    SELECT c.id, c.fecha, c.cbte_tipo, c.punto_venta, c.numero, c.cae, c.estado, c.ambiente, c.motivo, c.importe, c.emisor_id,
           c.movimiento_id, c.cbte_tipo IN (3, 8, 13) AS es_nc, d.codigo, json_extract(c.receptor_json, '$.razon_social') AS propietario,
           e.nombre AS emisor, m.estado = 'anulado' AS pago_anulado, pr.moneda_liquidacion AS moneda,
           (SELECT nc.punto_venta || '-' || nc.numero FROM comprobante nc WHERE nc.asociado_id = c.id AND nc.estado = 'aprobado') AS anulada_por,
           (SELECT f.punto_venta || '-' || f.numero FROM comprobante f WHERE f.id = c.asociado_id) AS anula,
           (${SQL_FACTURA_VIGENTE}) AND m.estado = 'anulado' AS nc_pendiente
    FROM comprobante c JOIN depto d ON d.id = c.depto_id JOIN emisor e ON e.id = c.emisor_id
    JOIN movimiento m ON m.id = c.movimiento_id JOIN propietario pr ON pr.id = c.propietario_id
    WHERE c.fecha >= ? AND c.fecha < ? AND (? OR c.ambiente = 'produccion')
      AND (c.estado = 'aprobado' OR (
        NOT EXISTS (SELECT 1 FROM comprobante o WHERE o.movimiento_id = c.movimiento_id AND o.cbte_tipo = c.cbte_tipo AND o.ambiente = c.ambiente
          AND (o.estado = 'aprobado' OR o.id > c.id))
        AND CASE WHEN c.asociado_id IS NULL THEN m.estado = 'vigente'
          ELSE NOT EXISTS (SELECT 1 FROM comprobante nc WHERE nc.asociado_id = c.asociado_id AND nc.estado = 'aprobado') END))
    ORDER BY c.fecha, c.id`).all(`${mes}-01`, `${siguiente}-01`, desarrollo ? 1 : 0) as any[];
  // "3-16" → "00003-00000016"
  const formato = (s: string | null) => s && numeroCbte(...(s.split('-').map(Number) as [number, number]));
  const filas = crudas.map((c) => ({
    id: c.id as number, fecha: c.fecha as string, tipo: NOMBRE_CBTE[c.cbte_tipo], es_nc: !!c.es_nc,
    numero: c.numero == null ? null : numeroCbte(c.punto_venta, c.numero), punto_venta: c.punto_venta as number, numero_n: c.numero as number | null,
    cae: c.cae as string | null, estado: c.estado as 'aprobado' | 'rechazado', ambiente: c.ambiente as 'homologacion' | 'produccion', motivo: c.motivo as string | null,
    importe: c.importe as number, codigo: c.codigo as string, propietario: c.propietario as string, emisor_id: c.emisor_id as number, emisor: c.emisor as string,
    movimiento_id: c.movimiento_id as number, pago_anulado: !!c.pago_anulado, moneda: c.moneda as 'ARS' | 'USD',
    anulada_por: formato(c.anulada_por), anula: formato(c.anula), nc_pendiente: !!c.nc_pendiente,
  }));
  const totales = new Map<number, { emisor_id: number; emisor: string; neto: number; cantidad: number }>();
  for (const f of filas.filter((x) => x.estado === 'aprobado')) {
    const t = totales.get(f.emisor_id) ?? { emisor_id: f.emisor_id, emisor: f.emisor, neto: 0, cantidad: 0 };
    t.neto += f.es_nc ? -f.importe : f.importe;
    t.cantidad++;
    totales.set(f.emisor_id, t);
  }
  return { filas, totales: [...totales.values()] };
}
export type FilaComprobante = ReturnType<typeof listarComprobantes>['filas'][number];

/** Todo el intento, con lo que mandó y contestó ARCA (el request se guarda sin el ticket). */
export function detalleComprobante(db: DatabaseSync, id: number) {
  const c = db.prepare(`SELECT c.*, e.nombre AS emisor, d.codigo FROM comprobante c JOIN emisor e ON e.id = c.emisor_id
      JOIN depto d ON d.id = c.depto_id WHERE c.id = ?`).get(id) as any;
  if (!c) throw new Error('No existe el comprobante.');
  const { receptor_json, ...resto } = c;
  return { ...resto, tipo: NOMBRE_CBTE[c.cbte_tipo], numero: c.numero == null ? null : numeroCbte(c.punto_venta, c.numero), receptor: JSON.parse(receptor_json) as Receptor };
}

// ---- Para el papel (etapa 7): todo lo que muestra el PDF de un comprobante aprobado.

// QR como SVG, armado acá (sincrónico): la vista imprimible lo pega tal cual.
function qrSvg(texto: string) {
  const { size, data } = QRCode.create(texto, { errorCorrectionLevel: 'M' }).modules;
  let d = '';
  for (let i = 0; i < data.length; i++) if (data[i]) d += `M${(i % size) + 4} ${Math.floor(i / size) + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" shape-rendering="crispEdges">`
    + `<rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export function datosComprobante(db: DatabaseSync, id: number) {
  const c = db.prepare(`SELECT c.*, p.mes, d.codigo, d.nombre AS depto, a.cbte_tipo AS asoc_tipo, a.punto_venta AS asoc_pv, a.numero AS asoc_numero,
      a.fecha AS asoc_fecha FROM comprobante c JOIN periodo p ON p.id = c.periodo_id JOIN depto d ON d.id = c.depto_id
      LEFT JOIN comprobante a ON a.id = c.asociado_id WHERE c.id = ? AND c.estado = 'aprobado'`).get(id) as any;
  if (!c) throw new Error('No existe ese comprobante aprobado.');
  const e = db.prepare(`SELECT razon_social, cuit, condicion_iva, domicilio, ingresos_brutos, inicio_actividades FROM emisor WHERE id = ?`)
    .get(c.emisor_id) as Pick<Emisor, 'razon_social' | 'cuit' | 'condicion_iva' | 'domicilio' | 'ingresos_brutos' | 'inicio_actividades'>;
  const receptor = JSON.parse(c.receptor_json) as Receptor;
  return {
    id: c.id as number, tipo: NOMBRE_CBTE[c.cbte_tipo], letra: LETRA_CBTE[c.cbte_tipo], codigo: String(c.cbte_tipo).padStart(2, '0'),  // "COD. 11" del recuadro
    numero: numeroCbte(c.punto_venta, c.numero), fecha: c.fecha as string, servDesde: c.serv_desde as string, servHasta: c.serv_hasta as string,
    importe: c.importe as number, iva: desglosarIva(c.importe, LETRA_CBTE[c.cbte_tipo] === 'C' ? 'monotributista' : 'responsable_inscripto').ImpIVA,
    cae: c.cae as string, caeVencimiento: c.cae_vencimiento as string, ambiente: c.ambiente as string,
    detalle: `Honorarios de administración — ${c.codigo} ${c.depto} — ${c.mes}`,
    asociado: c.asociado_id ? { tipo: NOMBRE_CBTE[c.asoc_tipo], numero: numeroCbte(c.asoc_pv, c.asoc_numero), fecha: c.asoc_fecha as string } : null,
    emisor: e, receptor,
    qr: qrSvg(qrArca({ fecha: c.fecha, cuitEmisor: e.cuit, puntoVenta: c.punto_venta, cbteTipo: c.cbte_tipo, numero: c.numero,
      impTotalCentavos: c.importe, docTipo: receptor.doc_tipo, docNro: receptor.doc_nro, cae: c.cae })),
  };
}
export type DatosComprobante = ReturnType<typeof datosComprobante>;

/**
 * Las facturas vigentes de la liquidación de un depto, para sumarlas al PDF que recibe el propietario.
 * ponytail: las de homologación entran solo mientras ningún emisor activo está en producción (la etapa de
 * prueba); después de pasar a producción, las de prueba no salen en el papel del propietario.
 */
export function facturasDeLiquidacion(db: DatabaseSync, periodoId: number, deptoId: number) {
  return (db.prepare(`SELECT c.id FROM comprobante c WHERE c.periodo_id = ? AND c.depto_id = ? AND ${SQL_FACTURA_VIGENTE}
      AND (c.ambiente = 'produccion' OR NOT EXISTS (SELECT 1 FROM emisor WHERE activo = 1 AND ambiente = 'produccion'))
      ORDER BY c.fecha, c.id`).all(periodoId, deptoId) as { id: number }[]).map((x) => datosComprobante(db, x.id));
}
