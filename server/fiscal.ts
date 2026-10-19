// Reglas fiscales puras (sin base, sin red) para facturar los honorarios (plan 031).
// Porte de electron/fiscal.js de Roble, que está en producción: ante un cambio de ARCA,
// mirar primero ahí.

export type CondicionIva = 'responsable_inscripto' | 'exento' | 'consumidor_final' | 'monotributista';
export type CondicionEmisor = 'monotributista' | 'responsable_inscripto' | 'exento';

// Condición frente al IVA -> CondicionIVAReceptorId de ARCA (RG 5616).
export const COND_IVA: Record<CondicionIva, number> = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributista: 6,
};

// Tipos de comprobante de ARCA (FEParamGetTiposCbte).
export const CBTE = {
  FACTURA_A: 1, NOTA_CREDITO_A: 3,
  FACTURA_B: 6, NOTA_CREDITO_B: 8,
  FACTURA_C: 11, NOTA_CREDITO_C: 13,
} as const;

/**
 * Qué comprobante emitir: única función que decide la letra.
 * Monotributista o exento -> C. Responsable inscripto -> A si el receptor también lo es, si no B.
 * Receptor sin definir = consumidor final.
 */
export function tipoComprobante(emisor: string, receptor?: string | null, nota = false): number {
  const r = receptor || 'consumidor_final';
  if (!(emisor in COND_IVA) || emisor === 'consumidor_final') throw new Error(`condición de emisor inválida: ${emisor}`);
  if (!(r in COND_IVA)) throw new Error(`condición de receptor inválida: ${r}`);

  if (emisor !== 'responsable_inscripto') return nota ? CBTE.NOTA_CREDITO_C : CBTE.FACTURA_C;
  if (r === 'responsable_inscripto') return nota ? CBTE.NOTA_CREDITO_A : CBTE.FACTURA_A;
  return nota ? CBTE.NOTA_CREDITO_B : CBTE.FACTURA_B;
}

// La NC de una factura concreta sale de su tipo, no de las condiciones actuales: si alguna
// cambió entre la factura y la anulación, recalcular daría otra letra y la NC no anularía nada.
const NOTA_DE: Record<number, number> = {
  [CBTE.FACTURA_A]: CBTE.NOTA_CREDITO_A,
  [CBTE.FACTURA_B]: CBTE.NOTA_CREDITO_B,
  [CBTE.FACTURA_C]: CBTE.NOTA_CREDITO_C,
};
export function notaCreditoDe(cbteTipo: number): number {
  const nc = NOTA_DE[Number(cbteTipo)];
  if (!nc) throw new Error(`no hay nota de crédito para el comprobante tipo ${cbteTipo}`);
  return nc;
}

export const esNotaCredito = (cbteTipo: number) =>
  ([CBTE.NOTA_CREDITO_A, CBTE.NOTA_CREDITO_B, CBTE.NOTA_CREDITO_C] as number[]).includes(Number(cbteTipo));

// Para el papel: nombre completo y la letra del recuadro.
export const NOMBRE_CBTE: Record<number, string> = {
  [CBTE.FACTURA_A]: 'FACTURA A', [CBTE.NOTA_CREDITO_A]: 'NOTA DE CRÉDITO A',
  [CBTE.FACTURA_B]: 'FACTURA B', [CBTE.NOTA_CREDITO_B]: 'NOTA DE CRÉDITO B',
  [CBTE.FACTURA_C]: 'FACTURA C', [CBTE.NOTA_CREDITO_C]: 'NOTA DE CRÉDITO C',
};
export const LETRA_CBTE: Record<number, string> = {
  [CBTE.FACTURA_A]: 'A', [CBTE.NOTA_CREDITO_A]: 'A',
  [CBTE.FACTURA_B]: 'B', [CBTE.NOTA_CREDITO_B]: 'B',
  [CBTE.FACTURA_C]: 'C', [CBTE.NOTA_CREDITO_C]: 'C',
};

// Alícuotas que acepta ARCA, con sus ids (FEParamGetTiposIva).
export const IVA_ID: Record<number, number> = { 0: 3, 10.5: 4, 21: 5, 27: 6, 2.5: 9, 5: 8 };

export type Importes = {
  ImpNeto: number; ImpIVA: number; ImpTotal: number;
  Iva: { Id: number; BaseImp: number; Importe: number }[] | null;
};

/**
 * Desglosa un total final (IVA incluido, centavos) para FECAESolicitar.
 * Emisor no inscripto -> comprobante C: neto = total y sin array Iva (mandarlo es error 10071).
 * El IVA sale por diferencia: neto + IVA == total siempre (ARCA valida la suma, error 10048).
 * ponytail: una sola línea (los honorarios); si hubiera varias alícuotas, ver Roble.
 */
export function desglosarIva(totalCentavos: number, emisor: string, ivaPct = 21): Importes {
  if (emisor !== 'responsable_inscripto') {
    return { ImpNeto: totalCentavos, ImpIVA: 0, ImpTotal: totalCentavos, Iva: null };
  }
  if (!(ivaPct in IVA_ID)) throw new Error(`alícuota de IVA no aceptada por ARCA: ${ivaPct}`);
  const neto = Math.round(totalCentavos / (1 + ivaPct / 100));
  const iva = totalCentavos - neto;
  return { ImpNeto: neto, ImpIVA: iva, ImpTotal: totalCentavos, Iva: [{ Id: IVA_ID[ivaPct], BaseImp: neto, Importe: iva }] };
}

/** Dígito verificador de CUIT (módulo 11). Un CUIT mal tipeado hace fallar todos los comprobantes. */
export function validarCuit(cuit: unknown): boolean {
  const s = String(cuit ?? '').replace(/\D/g, '');
  if (s.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const resto = pesos.reduce((acc, p, i) => acc + p * Number(s[i]), 0) % 11;
  const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return dv === Number(s[10]);
}

// Ids de impuesto del padrón (ws_sr_constancia_inscripcion) que definen la condición frente al IVA.
const IMPUESTO_MONOTRIBUTO = 20;
const IMPUESTO_IVA = 30;

/** Condición frente al IVA según los impuestos activos ('AC') del padrón. null = otra (no se asigna sola). */
export function condicionIvaDePadron(impuestos: { id: number; estado: string | null }[] = []): CondicionEmisor | null {
  const activos = new Set(impuestos.filter((i) => i.estado === 'AC').map((i) => Number(i.id)));
  if (activos.has(IMPUESTO_IVA)) return 'responsable_inscripto';
  if (activos.has(IMPUESTO_MONOTRIBUTO)) return 'monotributista';
  return null;
}

/**
 * DNI que lleva adentro el CUIT de una persona física (prefijo 20/23/24/27 + DNI + verificador).
 * Es la regla de ARCA pero no infalible: se SUGIERE, nunca pisa un DNI cargado. El padrón no lo trae.
 */
export function dniDeCuit(cuit: unknown): string | null {
  const s = String(cuit ?? '').replace(/\D/g, '');
  if (s.length !== 11 || !['20', '23', '24', '27'].includes(s.slice(0, 2))) return null;
  const dni = s.slice(2, 10).replace(/^0+/, '');
  return dni.length >= 7 ? dni : null;
}

// ARCA acepta CbteFch hasta 10 días antes o después de hoy para Concepto 2 (servicios),
// que es lo único que emite Hornera (en productos son 5).
const DIAS_TOLERANCIA = 10;

const restarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};

/**
 * CbteFch a informar (AAAA-MM-DD): la del pago mientras ARCA la acepte; si quedó fuera de la
 * ventana (o es futura), hoy. Y nunca anterior al último autorizado del punto de venta
 * (error 10016). Las fechas ISO se comparan como texto.
 */
export function fechaComprobante({ fechaPago, fechaUltimo = null, hoy }: { fechaPago: string; fechaUltimo?: string | null; hoy: string }): string {
  let fecha = (fechaPago < restarDias(hoy, DIAS_TOLERANCIA) || fechaPago > hoy) ? hoy : fechaPago;
  if (fechaUltimo && fecha < fechaUltimo) fecha = fechaUltimo;
  return fecha;
}

/** AAAA-MM-DD -> AAAAMMDD, el formato de fechas de ARCA. "Hoy" va en hora local (`hoyLocal`), nunca
 *  `toISOString()`: después de las 21 h es mañana, y un comprobante con fecha de mañana bloquea los de hoy (10016). */
export const fechaArca = (iso: string) => iso.replaceAll('-', '');
/** AAAAMMDD (CbteFch, CAEFchVto) -> AAAA-MM-DD. */
export const isoDeArca = (f: string) => `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;

/**
 * URL del QR obligatorio (RG 4892): un JSON en base64 que ARCA lee para verificar el
 * comprobante. El importe va en pesos con decimales, no en centavos.
 */
export function qrArca({ fecha, cuitEmisor, puntoVenta, cbteTipo, numero, impTotalCentavos, docTipo, docNro, cae }: {
  fecha: string; cuitEmisor: string; puntoVenta: number; cbteTipo: number; numero: number;
  impTotalCentavos: number; docTipo: number; docNro: string; cae: string;
}): string {
  const datos = {
    ver: 1,
    fecha,
    cuit: Number(String(cuitEmisor).replace(/\D/g, '')),
    ptoVta: Number(puntoVenta),
    tipoCmp: Number(cbteTipo),
    nroCmp: Number(numero),
    importe: Number((impTotalCentavos / 100).toFixed(2)),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: Number(docTipo),
    nroDocRec: Number(String(docNro).replace(/\D/g, '')) || 0,
    tipoCodAut: 'E',  // CAE (la 'A' es CAEA)
    codAut: Number(cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(datos), 'utf8').toString('base64')}`;
}
