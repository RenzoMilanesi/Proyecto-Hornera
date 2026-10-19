// Cliente de los webservices de ARCA: WSAA (login), WSFEv1 (emisión) y padrón A5.
// Transporte puro, no sabe nada de la base (plan 031). Porte de electron/arca.js de Roble,
// que está en producción: ante un cambio de ARCA, mirar primero ahí.
// node-forge firma el CMS del login: no se puede asumir openssl en la PC.

import forge from 'node-forge';
import tls from 'node:tls';
import type { Fetch } from './cotizacion.ts';
import type { Importes } from './fiscal.ts';

// El WSFEv1 de producción negocia una clave Diffie-Hellman por debajo del mínimo del OpenSSL
// de Node ("dh key too small"); homologación no tiene el problema. Se excluye DH para forzar
// ECDHE, sin bajar el SECLEVEL de toda la app.
tls.DEFAULT_CIPHERS = 'DEFAULT:!DH';

export type Ambiente = 'homologacion' | 'produccion';

export const URLS: Record<Ambiente, { wsaa: string; wsfe: string; padron?: string }> = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    // El padrón no existe en homologación.
    padron: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  },
};

export const SERVICIO_PADRON = 'ws_sr_constancia_inscripcion';

const TIMEOUT_MS = 20_000;

// `(?=[ />])` ancla el fin del nombre del tag: sin eso, buscar CAE matchea CAEFchVto.
export const entre = (xml: string, tag: string): string | undefined =>
  xml.match(new RegExp(`<${tag}(?=[ />])[^>]*>([\\s\\S]*?)</${tag}>`))?.[1];
export const todos = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}(?=[ />])[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);

// El padrón manda las letras no ASCII escapadas DOS veces (una Ñ llega `&amp;#209;`): las
// referencias numéricas se decodifican después de `&amp;`. Las entidades con nombre, una sola
// vez (`&amp;lt;` queda `&lt;`), que es lo que necesita el ticket del WSAA (XML dentro de XML).
const desescapar = (s: string | undefined) => String(s ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/&#(\d+);/g, (m, n) => (Number(n) <= 0x10FFFF ? String.fromCodePoint(Number(n)) : m))
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => (parseInt(h, 16) <= 0x10FFFF ? String.fromCodePoint(parseInt(h, 16)) : m));
const escapar = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** La UI trata distinto "no hay internet" (reintentable) que "ARCA rechazó". */
export class ErrorArca extends Error {
  tipo: 'red' | 'arca' | 'config';
  codigos: number[];
  causa?: string;
  constructor(mensaje: string, { tipo = 'arca', codigos = [] }: { tipo?: ErrorArca['tipo']; codigos?: number[] } = {}) {
    super(mensaje);
    this.name = 'ErrorArca';
    this.tipo = tipo;
    this.codigos = codigos;
  }
}

const SIN_RED = 'Sin conexión con ARCA. El pago quedó registrado y la factura pendiente: '
  + 'reintentá desde Transferencias cuando vuelva internet.';

async function soap(url: string, action: string, body: string, f: Fetch = fetch, timeoutMs = TIMEOUT_MS): Promise<string> {
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`
    + `<soap:Body>${body}</soap:Body></soap:Envelope>`;
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action },
      body: sobre,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // undici dice solo "fetch failed": la causa útil (ENOTFOUND, TLS, timeout) está en err.cause.
    const e = new ErrorArca(SIN_RED, { tipo: 'red' });
    const x = err as Error & { cause?: { code?: string; message?: string } };
    e.causa = [x.name, x.message, x.cause?.code, x.cause?.message].filter(Boolean).join(' | ');
    console.error(`[arca] Sin conexión con ${url} (${action || 'loginCms'}): ${e.causa}`);
    throw e;
  }
  const txt = await res.text();
  const falla = entre(txt, 'faultstring');
  if (falla) throw new ErrorArca(desescapar(falla));
  if (!res.ok) {
    const e = new ErrorArca(`ARCA no está respondiendo (HTTP ${res.status}). El pago quedó registrado y la `
      + 'factura pendiente: reintentá desde Transferencias en un rato.', { tipo: 'red' });
    e.causa = `HTTP ${res.status}`;
    console.error(`[arca] ${url} (${action || 'loginCms'}) respondió HTTP ${res.status}`);
    throw e;
  }
  return txt;
}

export type TicketAcceso = { token: string; sign: string; expira?: string };

/**
 * Firma el LoginTicketRequest (CMS/PKCS#7) y lo cambia por un ticket de acceso. Dura 12 h y
 * pedir otro vigente da "El CEE ya posee un TA valido": quien llama lo cachea.
 */
export async function obtenerTicketAcceso({ certPem, keyPem, ambiente, servicio = 'wsfe', fetch: f }: {
  certPem: string; keyPem: string; ambiente: Ambiente; servicio?: string; fetch?: Fetch;
}): Promise<TicketAcceso> {
  if (!certPem || !keyPem) throw new ErrorArca('Falta el certificado digital de ARCA.', { tipo: 'config' });

  let cert: forge.pki.Certificate, key: forge.pki.PrivateKey;
  try {
    cert = forge.pki.certificateFromPem(certPem);
    key = forge.pki.privateKeyFromPem(keyPem);
  } catch (err) {
    throw new ErrorArca(`El certificado o la clave privada no se pudieron leer: ${(err as Error).message}`, { tipo: 'config' });
  }

  const ahora = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().replace('Z', '-00:00');
  // ±10 minutos: absorbe el desfasaje del reloj de la PC, que en la práctica hace fallar el login.
  const tra = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<loginTicketRequest version="1.0"><header>`
    + `<uniqueId>${Math.floor(ahora / 1000)}</uniqueId>`
    + `<generationTime>${iso(ahora - 600_000)}</generationTime>`
    + `<expirationTime>${iso(ahora + 600_000)}</expirationTime>`
    + `</header><service>${servicio}</service></loginTicketRequest>`;

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  const xml = await soap(URLS[ambiente].wsaa, '',
    `<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><in0>${cms}</in0></loginCms>`, f);

  const ta = desescapar(entre(xml, 'loginCmsReturn'));
  const token = entre(ta, 'token');
  const sign = entre(ta, 'sign');
  if (!token || !sign) throw new ErrorArca('ARCA no devolvió un ticket de acceso válido.');
  return { token, sign, expira: entre(ta, 'expirationTime') };
}

const auth = (ta: TicketAcceso, cuit: string) =>
  `<Auth><Token>${ta.token}</Token><Sign>${ta.sign}</Sign><Cuit>${cuit}</Cuit></Auth>`;

// Los <Err> son fatales; los <Obs> no: el comprobante se aprueba igual.
export const errores = (xml: string) => todos(xml, 'Err').map((e) => `${entre(e, 'Code')}: ${desescapar(entre(e, 'Msg'))}`);
export const observaciones = (xml: string) => todos(xml, 'Obs').map((o) => `${entre(o, 'Code')}: ${desescapar(entre(o, 'Msg'))}`);
const soloCodigos = (msgs: string[]) => msgs.map((m) => Number(m.split(':')[0])).filter(Number.isFinite);

// El ticket no sirve aunque no haya vencido (certificado revocado, reloj desfasado al pedirlo):
// 600/601 en WSFEv1, o el mensaje del WSAA, que no manda códigos ("El CEE ya posee un TA
// valido..."). Quien cachea el ticket lo descarta para que el próximo intento pida otro.
export const esErrorDeToken = (err: unknown) => {
  const e = err as Partial<ErrorArca> | null;
  return (e?.codigos ?? []).some((c) => c === 600 || c === 601)
    || /token|ticket de acceso|\bTA\b/i.test(String(e?.message ?? ''));
};
// Lo que se arregla esperando: la red y el ticket. Un rechazo por datos da lo mismo al reintentar.
export const esReintentable = (err: unknown) => (err as Partial<ErrorArca> | null)?.tipo === 'red' || esErrorDeToken(err);

type Wsfe = { ta: TicketAcceso; cuit: string; ambiente: Ambiente; puntoVenta: number; fetch?: Fetch };

/** Último número autorizado para ese punto de venta y tipo. 0 = ninguno todavía. */
export async function ultimoAutorizado({ ta, cuit, ambiente, puntoVenta, cbteTipo, fetch: f }: Wsfe & { cbteTipo: number }): Promise<number> {
  const xml = await soap(URLS[ambiente].wsfe, 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
    `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">${auth(ta, cuit)}`
    + `<PtoVta>${puntoVenta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo></FECompUltimoAutorizado>`, f);
  const errs = errores(xml);
  if (errs.length) throw new ErrorArca(errs.join(' | '), { codigos: soloCodigos(errs) });
  return Number(entre(xml, 'CbteNro'));
}

/**
 * CbteFch (AAAAMMDD) de un comprobante ya autorizado: ARCA rechaza uno posterior con fecha
 * anterior. Un <Err> devuelve `{ fecha: null }` a propósito: esta consulta mejora el cálculo
 * de la fecha, no lo habilita. Los errores de red sí se propagan.
 */
export async function consultarComprobante({ ta, cuit, ambiente, puntoVenta, cbteTipo, numero, fetch: f }: Wsfe & { cbteTipo: number; numero: number }): Promise<{ fecha: string | null }> {
  const xml = await soap(URLS[ambiente].wsfe, 'http://ar.gov.afip.dif.FEV1/FECompConsultar',
    `<FECompConsultar xmlns="http://ar.gov.afip.dif.FEV1/">${auth(ta, cuit)}`
    + `<FeCompConsReq><CbteTipo>${cbteTipo}</CbteTipo><CbteNro>${numero}</CbteNro>`
    + `<PtoVta>${puntoVenta}</PtoVta></FeCompConsReq></FECompConsultar>`, f);
  if (errores(xml).length) return { fecha: null };
  const fch = entre(xml, 'CbteFch');
  return { fecha: /^\d{8}$/.test(String(fch)) ? String(fch) : null };
}

// ARCA trabaja en pesos con 2 decimales; Hornera en centavos.
export const pesos = (centavos: number) => (centavos / 100).toFixed(2);

export type ResultadoCAE =
  | { aprobado: true; cae: string; vencimiento: string; numero: number; observaciones: string[]; request: string; response: string }
  | { aprobado: false; motivo: string; codigos: number[]; observaciones: string[]; request: string; response: string };

/**
 * Pide el CAE de un comprobante. Fechas en AAAAMMDD. Concepto 2 (servicios, lo de Hornera) y 3
 * llevan período del servicio y vencimiento del pago; Concepto 1 (productos) no.
 * Un rechazo no tira: devuelve `aprobado: false` con el motivo, para guardar el intento.
 */
export async function solicitarCAE({ ta, cuit, ambiente, puntoVenta, cbteTipo, numero, docTipo, docNro,
  condIvaReceptor, imp, fecha, concepto = 2, servDesde, servHasta, vtoPago, cbteAsoc = null, fetch: f }: Wsfe & {
  cbteTipo: number; numero: number; docTipo: number; docNro: string; condIvaReceptor: number; imp: Importes;
  fecha: string; concepto?: 1 | 2 | 3; servDesde?: string; servHasta?: string; vtoPago?: string;
  cbteAsoc?: { tipo: number; puntoVenta: number; numero: number; fecha: string } | null;
}): Promise<ResultadoCAE> {
  if (concepto !== 1 && !(servDesde && servHasta && vtoPago)) {
    throw new ErrorArca('Un comprobante de servicios necesita el período del servicio y el vencimiento del pago.', { tipo: 'config' });
  }
  // Una NC dice qué comprobante corrige: sin esto ARCA la autoriza igual, huérfana.
  const asociado = cbteAsoc
    ? `<CbtesAsoc><CbteAsoc><Tipo>${cbteAsoc.tipo}</Tipo><PtoVta>${cbteAsoc.puntoVenta}</PtoVta>`
      + `<Nro>${cbteAsoc.numero}</Nro><Cuit>${escapar(cuit)}</Cuit>`
      + `<CbteFch>${cbteAsoc.fecha}</CbteFch></CbteAsoc></CbtesAsoc>`
    : '';
  const arrayIva = imp.Iva
    ? `<Iva>${imp.Iva.map((i) => `<AlicIva><Id>${i.Id}</Id>`
        + `<BaseImp>${pesos(i.BaseImp)}</BaseImp><Importe>${pesos(i.Importe)}</Importe></AlicIva>`).join('')}</Iva>`
    : '';
  const servicio = concepto === 1 ? ''
    : `<FchServDesde>${servDesde}</FchServDesde><FchServHasta>${servHasta}</FchServHasta><FchVtoPago>${vtoPago}</FchVtoPago>`;

  // El ORDEN de los elementos importa (esquema de wsfev1): un elemento mal ubicado ARCA lo
  // ignora en silencio. Fechas del servicio después de ImpIVA y antes de MonId; CbtesAsoc
  // después de CondicionIVAReceptorId y antes de Iva.
  const detalle =
      `<Concepto>${concepto}</Concepto><DocTipo>${docTipo}</DocTipo><DocNro>${escapar(docNro)}</DocNro>`
    + `<CbteDesde>${numero}</CbteDesde><CbteHasta>${numero}</CbteHasta><CbteFch>${fecha}</CbteFch>`
    + `<ImpTotal>${pesos(imp.ImpTotal)}</ImpTotal><ImpTotConc>0.00</ImpTotConc>`
    + `<ImpNeto>${pesos(imp.ImpNeto)}</ImpNeto><ImpOpEx>0.00</ImpOpEx>`
    + `<ImpTrib>0.00</ImpTrib><ImpIVA>${pesos(imp.ImpIVA)}</ImpIVA>`
    + servicio
    + `<MonId>PES</MonId><MonCotiz>1</MonCotiz>`
    // Obligatorio sin excepción desde el 01/09/2026 (RG 5616).
    + `<CondicionIVAReceptorId>${condIvaReceptor}</CondicionIVAReceptorId>`
    + asociado
    + arrayIva;

  const cuerpo = `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">${auth(ta, cuit)}<FeCAEReq>`
    + `<FeCabReq><CantReg>1</CantReg><PtoVta>${puntoVenta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo></FeCabReq>`
    + `<FeDetReq><FECAEDetRequest>${detalle}</FECAEDetRequest></FeDetReq></FeCAEReq></FECAESolicitar>`;

  const xml = await soap(URLS[ambiente].wsfe, 'http://ar.gov.afip.dif.FEV1/FECAESolicitar', cuerpo, f);

  const errs = errores(xml);
  const obs = observaciones(xml);
  // El token y la firma no se guardan en la base.
  const request = cuerpo.replace(/<Auth>[\s\S]*?<\/Auth>/, '<Auth/>');

  if (errs.length) return { aprobado: false, motivo: errs.join(' | '), codigos: soloCodigos(errs), observaciones: obs, request, response: xml };
  // 'A' aprobado, 'R' rechazado ('P' parcial no aplica con CantReg = 1).
  const resultado = entre(xml, 'Resultado');
  const cae = entre(xml, 'CAE');
  const vencimiento = entre(xml, 'CAEFchVto');
  if (resultado !== 'A' || !cae || !vencimiento) {
    return { aprobado: false, motivo: obs.length ? obs.join(' | ') : `ARCA devolvió resultado ${resultado}.`,
      codigos: soloCodigos(obs), observaciones: obs, request, response: xml };
  }
  return { aprobado: true, cae, vencimiento, numero, observaciones: obs, request, response: xml };
}

// aws.afip.gov.ar descarta conexiones nuevas de forma intermitente: intentos cortos y varios.
// Solo el padrón reintenta: es de solo lectura, repetir no duplica nada.
const PADRON_INTENTOS = 3;
const PADRON_TIMEOUT_MS = 5_000;

/** Constancia de inscripción de un CUIT (solo producción). Devuelve el XML crudo: lo lee `parsearPadron`. */
export async function consultarPadron({ ta, cuit, ambiente, cuitConsultado, fetch: f }: {
  ta: TicketAcceso; cuit: string; ambiente: Ambiente; cuitConsultado: string; fetch?: Fetch;
}): Promise<string> {
  const url = URLS[ambiente].padron;
  if (!url) throw new ErrorArca('La consulta al padrón de ARCA solo está disponible en producción.', { tipo: 'config' });
  const cuerpo = `<a5:getPersona xmlns:a5="http://a5.soap.ws.server.puc.sr/">`
    + `<token>${ta.token}</token><sign>${ta.sign}</sign>`
    + `<cuitRepresentada>${escapar(cuit)}</cuitRepresentada><idPersona>${escapar(cuitConsultado)}</idPersona>`
    + `</a5:getPersona>`;
  let ultimo: unknown;
  for (let i = 0; i < PADRON_INTENTOS; i++) {
    try {
      return await soap(url, '', cuerpo, f, PADRON_TIMEOUT_MS);
    } catch (err) {
      if ((err as ErrorArca).tipo !== 'red') throw err;  // un rechazo no mejora reintentando
      ultimo = err;
    }
  }
  throw ultimo;
}

/**
 * Lee la respuesta del padrón. No decide nada fiscal (eso es `condicionIvaDePadron`). Los
 * impuestos se buscan solo dentro de <impuesto>: la categoría de monotributo trae su propio
 * <idImpuesto> y no es un impuesto.
 */
export function parsearPadron(xml: string) {
  const persona = entre(xml, 'personaReturn');
  if (!persona) throw new ErrorArca('ARCA devolvió una respuesta de padrón que no se entiende.');
  const texto = (bloque: string | undefined, tag: string) => {
    const v = entre(bloque ?? '', tag);
    return v === undefined ? null : desescapar(v).trim();
  };
  const generales = entre(persona, 'datosGenerales') ?? '';
  const domicilio = entre(generales, 'domicilioFiscal') ?? '';
  return {
    tipoPersona: texto(generales, 'tipoPersona'),
    estadoClave: texto(generales, 'estadoClave'),
    razonSocial: texto(generales, 'razonSocial'),
    nombre: texto(generales, 'nombre'),
    apellido: texto(generales, 'apellido'),
    domicilio: {
      direccion: texto(domicilio, 'direccion'),
      localidad: texto(domicilio, 'localidad'),
      provincia: texto(domicilio, 'descripcionProvincia'),
      codPostal: texto(domicilio, 'codPostal'),
    },
    impuestos: todos(persona, 'impuesto').map((i) => ({
      id: Number(entre(i, 'idImpuesto')),
      descripcion: texto(i, 'descripcionImpuesto'),
      estado: texto(i, 'estadoImpuesto'),
    })),
    // Persona existente sin constancia armable (p. ej. clave inactiva): <errorConstancia>.
    errores: todos(persona, 'error').map((e) => desescapar(e).trim()),
  };
}
