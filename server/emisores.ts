// Emisores de las facturas de honorarios (Lautaro, Amancay) y su certificado de ARCA (plan 031, etapa 3).
// La clave privada no va a la base: la guarda el AlmacenClaves (safeStorage en la PC servidor).
import forge from 'node-forge';
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { ErrorArca, esErrorDeToken, obtenerTicketAcceso, ultimoAutorizado, type Ambiente, type TicketAcceso } from './arca.ts';
import type { Fetch } from './cotizacion.ts';
import { tipoComprobante, validarCuit } from './fiscal.ts';

// Dónde vive la clave privada de cada emisor. En Electron, un archivo cifrado por CUIT (electron/main.ts).
export interface AlmacenClaves {
  leer(cuit: string): string | null;
  guardar(cuit: string, keyPem: string): void;
}

export interface Emisor {
  id: number; nombre: string; razon_social: string; cuit: string;
  condicion_iva: 'monotributista' | 'responsable_inscripto' | 'exento'; punto_venta: number;
  domicilio: string | null; ingresos_brutos: string | null; inicio_actividades: string | null;
  ambiente: Ambiente; cert_pem: string | null; activo: number;
}

const CONDICIONES = ['monotributista', 'responsable_inscripto', 'exento'];
const AMBIENTES = ['homologacion', 'produccion'];
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Datos del certificado que importan: de quién es y hasta cuándo vale. */
export function leerCertificado(certPem: string) {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new Error('El archivo .crt no es un certificado válido.');
  }
  // ARCA pone el CUIT en el serialNumber del sujeto: "CUIT 20111111112".
  const serie = String(cert.subject.getField({ name: 'serialNumber' })?.value ?? '');
  return {
    cert,
    cuit: serie.replace(/\D/g, '') || null,
    alias: String(cert.subject.getField({ name: 'commonName' })?.value ?? ''),
    vence: cert.validity.notAfter.toISOString().slice(0, 10),
  };
}

export function listarEmisores(db: DatabaseSync, claves?: AlmacenClaves) {
  return (db.prepare('SELECT * FROM emisor ORDER BY activo DESC, nombre').all() as unknown as Emisor[]).map(({ cert_pem, ...e }) => {
    const c = cert_pem ? leerCertificado(cert_pem) : null;
    return { ...e, certificado: c && { alias: c.alias, vence: c.vence }, tiene_clave: !!claves?.leer(e.cuit) };
  });
}

function validarEmisor(cuerpo: unknown) {
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const e = {
    nombre: texto(b.nombre), razon_social: texto(b.razon_social), cuit: String(b.cuit ?? '').replace(/\D/g, ''),
    condicion_iva: b.condicion_iva as string, punto_venta: b.punto_venta as number,
    domicilio: texto(b.domicilio), ingresos_brutos: texto(b.ingresos_brutos), inicio_actividades: texto(b.inicio_actividades),
    ambiente: b.ambiente as string, activo: b.activo === 0 ? 0 : 1,
  };
  if (!e.nombre || !e.razon_social) throw new Error('Faltan el nombre o la razón social.');
  if (!validarCuit(e.cuit)) throw new Error('El CUIT no es válido: son 11 dígitos y el dígito verificador no cierra.');
  if (!CONDICIONES.includes(e.condicion_iva)) throw new Error('Elegí la condición frente al IVA.');
  if (!Number.isInteger(e.punto_venta) || e.punto_venta < 1 || e.punto_venta > 99999) throw new Error('El punto de venta es un número entre 1 y 99999.');
  if (!AMBIENTES.includes(e.ambiente)) throw new Error('El ambiente es homologación o producción.');
  if (e.inicio_actividades && !/^\d{4}-\d{2}-\d{2}$/.test(e.inicio_actividades)) throw new Error('Inicio de actividades inválido.');
  return e;
}

export function crearEmisor(db: DatabaseSync, cuerpo: unknown) {
  const e = validarEmisor(cuerpo);
  if (db.prepare('SELECT 1 FROM emisor WHERE cuit = ?').get(e.cuit)) throw new Error(`Ya hay un emisor con el CUIT ${e.cuit}.`);
  const id = Number(db.prepare(`INSERT INTO emisor(nombre, razon_social, cuit, condicion_iva, punto_venta, domicilio, ingresos_brutos,
      inicio_actividades, ambiente, activo) VALUES (:nombre, :razon_social, :cuit, :condicion_iva, :punto_venta, :domicilio,
      :ingresos_brutos, :inicio_actividades, :ambiente, :activo)`).run(e).lastInsertRowid);
  auditar(db, 'emisor', id, 'alta', null, e);
  return { id };
}

/**
 * El CUIT no se cambia: el certificado y los comprobantes son de ese CUIT (se carga otro emisor).
 * Cambiar de ambiente borra el certificado: el de homologación (WSASS) no sirve en producción.
 */
export function editarEmisor(db: DatabaseSync, id: number, cuerpo: unknown) {
  const antes = db.prepare('SELECT * FROM emisor WHERE id = ?').get(id) as unknown as Emisor | undefined;
  if (!antes) throw new Error('No existe el emisor.');
  const e = validarEmisor({ ...(cuerpo as object), cuit: antes.cuit });
  const certPem = e.ambiente === antes.ambiente ? antes.cert_pem : null;
  const { cuit: _cuit, ...campos } = e;
  db.prepare(`UPDATE emisor SET nombre = :nombre, razon_social = :razon_social, condicion_iva = :condicion_iva,
      punto_venta = :punto_venta, domicilio = :domicilio, ingresos_brutos = :ingresos_brutos,
      inicio_actividades = :inicio_actividades, ambiente = :ambiente, activo = :activo, cert_pem = :cert_pem WHERE id = :id`)
    .run({ ...campos, cert_pem: certPem, id });
  const { cert_pem: _a, ...sinCert } = antes;
  auditar(db, 'emisor', id, 'modificacion', { ...sinCert, certificado: !!antes.cert_pem }, { ...e, certificado: !!certPem });
  return { certificado_borrado: !!antes.cert_pem && !certPem };
}

/** Solo sin comprobantes: los emitidos son de ese emisor y no se pierden (si tiene, se desactiva). */
export function borrarEmisor(db: DatabaseSync, id: number) {
  const e = db.prepare('SELECT * FROM emisor WHERE id = ?').get(id) as unknown as Emisor | undefined;
  if (!e) throw new Error('No existe el emisor.');
  const { n } = db.prepare('SELECT count(*) n FROM comprobante WHERE emisor_id = ?').get(id) as { n: number };
  if (n) throw new Error(`${e.nombre} tiene ${n} comprobante${n === 1 ? '' : 's'}: no se puede borrar. Desactivalo desde Editar.`);
  db.prepare('DELETE FROM emisor WHERE id = ?').run(id);
  db.prepare(`DELETE FROM configuracion WHERE clave LIKE ?`).run(`arca.ta.%.${e.cuit}`);
  // ponytail: la .key cifrada queda en el AlmacenClaves (no tiene "borrar"); si se vuelve a cargar el CUIT, se pisa.
  const { cert_pem: _c, ...sinCert } = e;
  auditar(db, 'emisor', id, 'anulacion', sinCert, null);
}

/**
 * Guarda el .crt en la base y la .key cifrada, si son del mismo par y del CUIT del emisor.
 * Un certificado nuevo invalida los tickets de acceso que se pidieron con el anterior.
 */
export function cargarCertificado(db: DatabaseSync, claves: AlmacenClaves | undefined, id: number, cuerpo: unknown) {
  if (!claves) throw new Error('Esta instalación no puede guardar la clave privada.');
  const { crt, key } = (cuerpo ?? {}) as { crt?: unknown; key?: unknown };
  if (typeof crt !== 'string' || typeof key !== 'string') throw new Error('Faltan el certificado (.crt) o la clave privada (.key).');
  const emisor = db.prepare('SELECT * FROM emisor WHERE id = ?').get(id) as unknown as Emisor | undefined;
  if (!emisor) throw new Error('No existe el emisor.');

  const c = leerCertificado(crt);
  let clave: forge.pki.rsa.PrivateKey;
  try {
    clave = forge.pki.privateKeyFromPem(key) as forge.pki.rsa.PrivateKey;
  } catch {
    throw new Error('El archivo .key no es una clave privada válida (o está protegida con contraseña).');
  }
  if ((c.cert.publicKey as forge.pki.rsa.PublicKey).n.compareTo(clave.n) !== 0) {
    throw new Error('La clave privada no corresponde a este certificado.');
  }
  if (c.cuit !== emisor.cuit) throw new Error(`El certificado es del CUIT ${c.cuit ?? 'desconocido'}, no del de ${emisor.nombre} (${emisor.cuit}).`);
  if (c.vence < new Date().toISOString().slice(0, 10)) throw new Error(`El certificado venció el ${c.vence}.`);

  claves.guardar(emisor.cuit, forge.pki.privateKeyToPem(clave));
  db.prepare('UPDATE emisor SET cert_pem = ? WHERE id = ?').run(crt.trim(), id);
  db.prepare(`DELETE FROM configuracion WHERE clave LIKE ?`).run(`arca.ta.%.${emisor.cuit}`);
  auditar(db, 'emisor', id, 'modificacion', null, { certificado: { alias: c.alias, vence: c.vence } });
  return { alias: c.alias, vence: c.vence };
}

// ---- Ticket de acceso del WSAA: dura 12 h y pedir otro vigente da error, así que se cachea en
// `configuracion` por servicio + ambiente + CUIT (un TA de homologación no vale en producción).
const MARGEN_MS = 60_000;  // no usar uno que vence mientras viaja el pedido
const claveTa = (servicio: string, e: Emisor) => `arca.ta.${servicio}.${e.ambiente}.${e.cuit}`;
// Un pedido por clave a la vez: dos "Probar" seguidos pedirían dos tickets y el segundo da error.
const enCurso = new Map<string, Promise<TicketAcceso>>();

export function ticketAcceso(db: DatabaseSync, e: Emisor, keyPem: string, servicio = 'wsfe', f?: Fetch): Promise<TicketAcceso> {
  const k = claveTa(servicio, e);
  const fila = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(k) as { valor: string } | undefined;
  const guardado = fila && (JSON.parse(fila.valor) as TicketAcceso);
  if (guardado?.expira && new Date(guardado.expira).getTime() > Date.now() + MARGEN_MS) return Promise.resolve(guardado);
  if (!enCurso.has(k)) {
    enCurso.set(k, obtenerTicketAcceso({ certPem: e.cert_pem ?? '', keyPem, ambiente: e.ambiente, servicio, fetch: f })
      .then((ta) => {
        db.prepare('INSERT INTO configuracion(clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(k, JSON.stringify(ta));
        return ta;
      })
      .finally(() => enCurso.delete(k)));
  }
  return enCurso.get(k)!;
}

export function descartarTicket(db: DatabaseSync, e: Emisor, servicio = 'wsfe') {
  db.prepare('DELETE FROM configuracion WHERE clave = ?').run(claveTa(servicio, e));
}

/** Emisor listo para hablar con ARCA: con certificado y con la clave en esta PC. */
export function emisorConClave(db: DatabaseSync, claves: AlmacenClaves | undefined, id: number) {
  const e = db.prepare('SELECT * FROM emisor WHERE id = ?').get(id) as unknown as Emisor | undefined;
  if (!e) throw new Error('No existe el emisor.');
  if (!e.cert_pem) throw new ErrorArca(`Falta cargar el certificado de ${e.nombre}.`, { tipo: 'config' });
  const keyPem = claves?.leer(e.cuit);
  if (!keyPem) throw new ErrorArca(`La clave privada de ${e.nombre} no está en esta PC: volvé a cargar el certificado.`, { tipo: 'config' });
  return { e, keyPem };
}

/**
 * Prueba de punta a punta: login al WSAA y FECompUltimoAutorizado. Si anda, el certificado, la
 * autorización de `wsfe` y el punto de venta Web Services están bien.
 */
export async function probarEmisor(db: DatabaseSync, claves: AlmacenClaves | undefined, id: number, f?: Fetch) {
  const { e, keyPem } = emisorConClave(db, claves, id);
  const cbteTipo = tipoComprobante(e.condicion_iva, null);
  try {
    const ta = await ticketAcceso(db, e, keyPem, 'wsfe', f);
    const ultimo = await ultimoAutorizado({ ta, cuit: e.cuit, ambiente: e.ambiente, puntoVenta: e.punto_venta, cbteTipo, fetch: f });
    return { cbteTipo, ultimo };
  } catch (err) {
    if (esErrorDeToken(err)) descartarTicket(db, e);
    throw err;
  }
}
