// Datos fiscales del propietario: a quién se le factura los honorarios (plan 031, etapa 4).
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { consultarPadron, ErrorArca, esErrorDeToken, parsearPadron, SERVICIO_PADRON } from './arca.ts';
import type { Fetch } from './cotizacion.ts';
import { descartarTicket, emisorConClave, ticketAcceso, type AlmacenClaves } from './emisores.ts';
import { condicionIvaDePadron, dniDeCuit, validarCuit } from './fiscal.ts';

const CONDICIONES = ['responsable_inscripto', 'monotributista', 'exento', 'consumidor_final'];
// categoria_fiscal del Excel → condición frente al IVA. NI (no informado) no propone nada.
const DE_CATEGORIA: Record<string, string> = { RI: 'responsable_inscripto', RM: 'monotributista', EX: 'exento', CF: 'consumidor_final' };
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const CUIT_INVALIDO = 'El CUIT no es válido: son 11 dígitos y el dígito verificador no cierra.';

interface Fila {
  id: number; nombre: string; documento: string | null; cuit: string | null; categoria_fiscal: string | null;
  fiscal_razon_social: string | null; fiscal_doc_tipo: number | null; fiscal_doc_nro: string | null;
  fiscal_condicion_iva: string | null; fiscal_domicilio: string | null;
}

function leer(db: DatabaseSync, id: number) {
  const p = db.prepare(`SELECT id, nombre, documento, cuit, categoria_fiscal, fiscal_razon_social, fiscal_doc_tipo,
      fiscal_doc_nro, fiscal_condicion_iva, fiscal_domicilio FROM propietario WHERE id = ?`).get(id) as unknown as Fila | undefined;
  if (!p) throw new Error('No existe el propietario.');
  return p;
}

/**
 * Lo guardado; si nunca se cargó, lo que viene del Excel (cuit, documento, categoría) como propuesta.
 * `propuesto` avisa a la UI que todavía no está guardado.
 */
export function datosFiscales(db: DatabaseSync, id: number) {
  const p = leer(db, id);
  const excel = { documento: p.documento, cuit: p.cuit, categoria_fiscal: p.categoria_fiscal };
  const guardado = p.fiscal_razon_social || p.fiscal_doc_tipo || p.fiscal_condicion_iva || p.fiscal_domicilio;
  if (guardado) {
    return { excel, propuesto: false, razon_social: p.fiscal_razon_social, doc_tipo: p.fiscal_doc_tipo, doc_nro: p.fiscal_doc_nro,
      condicion_iva: p.fiscal_condicion_iva, domicilio: p.fiscal_domicilio };
  }
  // ponytail: del documento libre ("DNI N°11.111.111 / ...") se toma el primer número de 7-8 dígitos.
  const dni = (p.documento ?? '').replace(/\./g, '').match(/\b\d{7,8}\b/)?.[0] ?? null;
  const cuit = validarCuit(p.cuit) ? digitos(p.cuit) : null;
  return { excel, propuesto: true, razon_social: p.nombre, doc_tipo: cuit ? 80 : dni ? 96 : null, doc_nro: cuit ?? dni,
    condicion_iva: DE_CATEGORIA[p.categoria_fiscal ?? ''] ?? null, domicilio: null };
}

/** Se puede guardar incompleto (sin todo no se factura), pero lo que se carga tiene que ser válido. */
export function guardarDatosFiscales(db: DatabaseSync, id: number, cuerpo: unknown) {
  const antes = leer(db, id);
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const f = {
    razon_social: texto(b.razon_social), doc_tipo: b.doc_tipo == null ? null : Number(b.doc_tipo),
    doc_nro: digitos(b.doc_nro) || null, condicion_iva: texto(b.condicion_iva), domicilio: texto(b.domicilio),
  };
  if (f.doc_tipo !== null && f.doc_tipo !== 80 && f.doc_tipo !== 96) throw new Error('El tipo de documento es CUIT o DNI.');
  if (f.doc_nro && !f.doc_tipo) throw new Error('Elegí el tipo de documento.');
  if (f.doc_tipo === 80 && !validarCuit(f.doc_nro)) throw new Error(CUIT_INVALIDO);
  if (f.doc_tipo === 96 && !/^\d{7,8}$/.test(f.doc_nro ?? '')) throw new Error('El DNI son 7 u 8 dígitos.');
  if (f.condicion_iva && !CONDICIONES.includes(f.condicion_iva)) throw new Error('Elegí la condición frente al IVA.');
  // ARCA rechaza una factura a un inscripto o monotributista identificado con DNI.
  if ((f.condicion_iva === 'responsable_inscripto' || f.condicion_iva === 'monotributista') && f.doc_tipo === 96) {
    throw new Error('Un responsable inscripto o monotributista se identifica con CUIT, no con DNI.');
  }
  db.prepare(`UPDATE propietario SET fiscal_razon_social = :razon_social, fiscal_doc_tipo = :doc_tipo, fiscal_doc_nro = :doc_nro,
      fiscal_condicion_iva = :condicion_iva, fiscal_domicilio = :domicilio WHERE id = :id`).run({ ...f, id });
  auditar(db, 'propietario', id, 'modificacion', {
    razon_social: antes.fiscal_razon_social, doc_tipo: antes.fiscal_doc_tipo, doc_nro: antes.fiscal_doc_nro,
    condicion_iva: antes.fiscal_condicion_iva, domicilio: antes.fiscal_domicilio,
  }, f);
}

/**
 * Constancia de inscripción del CUIT con el primer emisor activo en producción (el padrón no existe
 * en homologación). Devuelve los datos sin guardar: el usuario los revisa y guarda.
 */
export async function padronDePropietario(db: DatabaseSync, claves: AlmacenClaves | undefined, id: number, cuerpo: unknown, f?: Fetch) {
  leer(db, id);
  const cuit = digitos((cuerpo as { cuit?: unknown } | null)?.cuit);
  if (!validarCuit(cuit)) throw new Error(CUIT_INVALIDO);
  const fila = db.prepare(`SELECT id FROM emisor WHERE activo = 1 AND ambiente = 'produccion' ORDER BY cert_pem IS NULL, id LIMIT 1`).get() as { id: number } | undefined;
  if (!fila) throw new ErrorArca('La consulta al padrón de ARCA solo está disponible en producción: no hay un emisor activo en producción.', { tipo: 'config' });
  const { e, keyPem } = emisorConClave(db, claves, fila.id);
  let xml: string;
  try {
    const ta = await ticketAcceso(db, e, keyPem, SERVICIO_PADRON, f);
    xml = await consultarPadron({ ta, cuit: e.cuit, ambiente: e.ambiente, cuitConsultado: cuit, fetch: f });
  } catch (err) {
    if (esErrorDeToken(err)) descartarTicket(db, e, SERVICIO_PADRON);
    const m = (err as Error).message;
    if (/no existe|no se encontr/i.test(m)) throw new ErrorArca('ARCA no tiene registrado ese CUIT.');
    // El certificado sirve para wsfe, pero el padrón se habilita aparte en el Administrador de Relaciones.
    if (/no autorizado/i.test(m)) throw new ErrorArca(`El servicio de padrón no está habilitado para el certificado de ${e.nombre} en ARCA.`, { tipo: 'config' });
    // El mensaje de red de arca.ts habla del pago y la factura: acá no hay ninguno.
    if ((err as ErrorArca).tipo === 'red') throw new ErrorArca('ARCA no respondió a tiempo. Reintentá en unos segundos.', { tipo: 'red' });
    throw err;
  }
  const p = parsearPadron(xml);
  if (p.errores.length && !p.impuestos.length) throw new ErrorArca(`ARCA no pudo armar la constancia: ${p.errores.join(' | ')}`);
  const d = p.domicilio;
  return {
    razon_social: p.razonSocial ?? ([p.apellido, p.nombre].filter(Boolean).join(' ') || null),
    doc_tipo: 80, doc_nro: cuit,
    condicion_iva: condicionIvaDePadron(p.impuestos),  // null = no se deduce (exento, etc.): queda lo que estaba
    domicilio: [d.direccion, d.localidad, d.provincia, d.codPostal && `CP ${d.codPostal}`].filter(Boolean).join(', ') || null,
    estado_clave: p.estadoClave,
    // ARCA no lo devuelve: se deduce del CUIT, solo para personas físicas. Es una sugerencia.
    dni: p.tipoPersona === 'FISICA' ? dniDeCuit(cuit) : null,
  };
}
