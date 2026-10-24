// Acciones del asistente (plan 068): las herramientas proponer_* arman una propuesta y no guardan nada. Para validarla
// se ensaya la misma función que usa la pantalla dentro de un SAVEPOINT que se deshace: mismos errores, sin escribir.
// Lo que guarda es el botón Confirmar del panel (confirmarPropuesta, paso 5).
import type { DatabaseSync } from 'node:sqlite';
import { anularGastoAjeno, CODIGOS_AJENOS, crearGastoAjeno, editarGastoAjeno, type DatosGastoAjeno } from '../gastosAjenos.ts';
import { agregar, editar, guardarNotas } from '../ficha.ts';
import { anularMovimiento, crearMovimiento, editarMovimiento, periodoAbierto, TIPOS_CARGABLES, type DatosMovimiento } from '../movimientos.ts';

export type Tipo = 'movimiento' | 'gasto_personal' | 'ficha' | 'mes';
export interface Propuesta {
  tipo: Tipo; accion: string;
  args: Record<string, unknown>;          // lo que recibe la función de la pantalla al confirmar
  antes: Record<string, unknown> | null;  // el registro al proponer (edición, anulación, borrado)
  titulo: string;
  campos: [string, string, string?][];    // [etiqueta, valor propuesto, valor anterior] para la tarjeta
}

const plata = (c: number, moneda = 'ARS') =>
  `${moneda === 'USD' ? 'US$' : '$'} ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nulo = (v: unknown) => (v === null || v === undefined || v === '' ? null : v);
const txt = (v: unknown) => (nulo(v) == null ? null : String(v));

// Corre fn y deshace todo lo que haya escrito (también la auditoría y un concepto nuevo). Sin await adentro: nadie más
// escribe en el medio.
function ensayar(db: DatabaseSync, fn: () => unknown) {
  db.exec('SAVEPOINT ensayo');
  try {
    fn();
  } finally {
    db.exec('ROLLBACK TO ensayo');
    db.exec('RELEASE ensayo');
  }
}

function idDepto(db: DatabaseSync, codigo: unknown) {
  const d = db.prepare('SELECT id FROM depto WHERE upper(codigo) = upper(?)').get(String(codigo)) as { id: number } | undefined;
  if (!d) throw new Error(`No existe el depto ${codigo}. Los códigos salen de listar_deptos.`);
  return d.id;
}

// Los campos con el valor anterior al lado solo donde cambió.
const comparar = (nuevos: [string, string][], viejos?: [string, string][]): [string, string, string?][] =>
  nuevos.map(([k, v], i) => (viejos && viejos[i][1] !== v ? [k, v, viejos[i][1]] : [k, v]));

// ---- Movimientos

const TIPOS_MOV: Record<string, string> = {
  gasto: 'Gasto', ingreso: 'Ingreso', pre_liquidacion: 'Adelanto al propietario', pago_directo: 'Cobro directo por plataforma',
  saldo_inicial: 'Saldo inicial', ajuste: 'Ajuste',
};

function vistaMovimiento(db: DatabaseSync, m: { mes: string; fecha: string; depto: string | null; tipo: string; concepto: string | null; detalle: string | null;
  importe_ars: number; importe_usd: number; cuenta_id: number | null; adjunto_id?: number | null }): [string, string][] {
  const cuenta = m.cuenta_id == null ? 'Sin cuenta' : (db.prepare('SELECT nombre FROM cuenta WHERE id = ?').get(m.cuenta_id) as { nombre: string } | undefined)?.nombre ?? `#${m.cuenta_id}`;
  return [['Fecha', m.fecha], ['Mes', m.mes], ['Depto', m.depto ?? 'Empresa'], ['Tipo', TIPOS_MOV[m.tipo] ?? m.tipo], ['Concepto', m.concepto ?? '—'],
    ['Detalle', m.detalle ?? '—'], ['Importe', m.importe_usd ? plata(m.importe_usd, 'USD') : plata(m.importe_ars)], ['Cuenta', cuenta],
    ['Comprobante', m.adjunto_id ? `adjunto #${m.adjunto_id}` : '—']];
}

function movimientoActual(db: DatabaseSync, id: number) {
  const m = db.prepare(`SELECT m.*, p.mes, d.codigo AS depto, c.nombre AS concepto, (SELECT a.id FROM adjunto a WHERE a.movimiento_id = m.id) AS adjunto_id
    FROM movimiento m JOIN periodo p ON p.id = m.periodo_id LEFT JOIN depto d ON d.id = m.depto_id LEFT JOIN concepto c ON c.id = m.concepto_id
    WHERE m.id = ?`).get(id) as Record<string, any> | undefined;
  if (!m) throw new Error(`No existe el movimiento ${id}. Los ids salen de la herramienta movimientos.`);
  return m;
}

export function proponerMovimiento(db: DatabaseSync, e: Record<string, unknown>): Propuesta {
  const accion = String(e.accion);
  if (accion !== 'alta') {
    if (nulo(e.id) == null) throw new Error('Para corregir o anular hace falta el id del movimiento (herramienta movimientos).');
  }
  const id = Number(e.id);
  if (accion === 'anulacion') {
    const antes = movimientoActual(db, id);
    ensayar(db, () => anularMovimiento(db, id));
    return { tipo: 'movimiento', accion, args: { id }, antes, titulo: 'Anular movimiento', campos: vistaMovimiento(db, antes as any) };
  }
  let cuentaId: number | null = null;
  if (nulo(e.cuenta) != null) {
    const c = db.prepare('SELECT id FROM cuenta WHERE lower(nombre) = lower(?)').get(String(e.cuenta)) as { id: number } | undefined;
    if (!c) throw new Error(`No existe la cuenta "${e.cuenta}". Los nombres salen de la herramienta cuentas.`);
    cuentaId = c.id;
  }
  const importe = Number(e.importe_centavos);
  if (!Number.isInteger(importe)) throw new Error('importe_centavos va entero, en centavos.');
  const adjunto = nulo(e.adjunto) == null ? null : Number(e.adjunto);
  if (adjunto != null && !db.prepare('SELECT 1 FROM adjunto WHERE id = ? AND movimiento_id IS NULL').get(adjunto)) {
    throw new Error(`El adjunto #${adjunto} no existe o ya es de otro movimiento.`);
  }
  const d: DatosMovimiento = {
    mes: String(e.mes), fecha: String(e.fecha), depto: txt(e.depto)?.toUpperCase() ?? null, tipo: String(e.tipo), concepto: txt(e.concepto),
    detalle: txt(e.detalle), importe_ars: e.moneda === 'USD' ? 0 : importe, importe_usd: e.moneda === 'USD' ? importe : 0, cuenta_id: cuentaId,
    ...(adjunto != null ? { adjunto_id: adjunto } : {}),
  };
  if (accion === 'alta') {
    ensayar(db, () => crearMovimiento(db, d));
    return { tipo: 'movimiento', accion, args: d as unknown as Record<string, unknown>, antes: null, titulo: `Nuevo ${(TIPOS_MOV[d.tipo] ?? 'movimiento').toLowerCase()}`, campos: vistaMovimiento(db, d) };
  }
  if (accion !== 'edicion') throw new Error(`Acción desconocida: ${accion}.`);
  const antes = movimientoActual(db, id);
  ensayar(db, () => editarMovimiento(db, id, d));
  return { tipo: 'movimiento', accion, args: { id, ...d }, antes, titulo: 'Corregir movimiento', campos: comparar(vistaMovimiento(db, d), vistaMovimiento(db, antes as any)) };
}

// ---- Gastos personales

const vistaGasto = (g: { fecha: string; codigo: string; descripcion: string | null; importe: number }): [string, string][] =>
  [['Fecha', g.fecha], ['Código', g.codigo], ['Descripción', g.descripcion ?? '—'], ['Importe', plata(g.importe)]];

export function proponerGastoPersonal(db: DatabaseSync, e: Record<string, unknown>): Propuesta {
  const accion = String(e.accion);
  const id = Number(e.id);
  const actual = () => {
    const g = db.prepare('SELECT * FROM gasto_ajeno WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!g) throw new Error(`No existe el gasto personal ${e.id}. Los ids salen de la herramienta gastos_personales.`);
    return g;
  };
  if (accion === 'anulacion') {
    const antes = actual();
    ensayar(db, () => anularGastoAjeno(db, id));
    return { tipo: 'gasto_personal', accion, args: { id }, antes, titulo: 'Anular gasto personal', campos: vistaGasto(antes as any) };
  }
  const d: DatosGastoAjeno = { fecha: String(e.fecha), codigo: String(e.codigo), descripcion: txt(e.descripcion), importe: Number(e.importe_centavos) };
  if (accion === 'alta') {
    ensayar(db, () => crearGastoAjeno(db, d));
    return { tipo: 'gasto_personal', accion, args: d as unknown as Record<string, unknown>, antes: null, titulo: 'Nuevo gasto personal', campos: vistaGasto(d) };
  }
  if (accion !== 'edicion') throw new Error(`Acción desconocida: ${accion}.`);
  const antes = actual();
  ensayar(db, () => editarGastoAjeno(db, id, d));
  return { tipo: 'gasto_personal', accion, args: { id, ...d }, antes, titulo: 'Corregir gasto personal', campos: comparar(vistaGasto(d), vistaGasto(antes as any)) };
}

// ---- Ficha del depto

const LISTAS: Record<string, { tabla: string; nombre: string; campos: string[] }> = {
  servicios: { tabla: 'depto_servicio', nombre: 'servicio', campos: ['concepto', 'cuenta', 'titular', 'paga', 'dia', 'cada_meses', 'mes_desde', 'nota'] },
  claves: { tabla: 'depto_clave', nombre: 'clave', campos: ['nombre', 'usuario', 'clave', 'nota'] },
  contactos: { tabla: 'depto_contacto', nombre: 'contacto', campos: ['nombre', 'rol', 'telefono', 'nota'] },
};
const vistaFila = (l: (typeof LISTAS)[string], f: Record<string, unknown>): [string, string][] =>
  l.campos.map((k) => [k.charAt(0).toUpperCase() + k.slice(1).replace('_', ' '), txt(f[k]) ?? '—']);

export function proponerFicha(db: DatabaseSync, e: Record<string, unknown>): Propuesta {
  const accion = String(e.accion);
  const deptoId = idDepto(db, e.depto);
  const codigo = String(e.depto).toUpperCase();
  let campos: Record<string, unknown> = {};
  if (nulo(e.campos_json) != null) {
    try { campos = JSON.parse(String(e.campos_json)); } catch { throw new Error('campos_json no es un JSON válido.'); }
  }
  if (accion === 'notas') {
    const antes = db.prepare('SELECT notas FROM depto WHERE id = ?').get(deptoId) as { notas: string | null };
    const args = { depto_id: deptoId, notas: txt(campos.notas) };
    ensayar(db, () => guardarNotas(db, deptoId, args));
    return { tipo: 'ficha', accion, args, antes, titulo: `Notas de ${codigo}`, campos: comparar([['Notas', args.notas ?? '—']], [['Notas', antes.notas ?? '—']]) };
  }
  const lista = String(e.lista);
  const l = LISTAS[lista];
  if (!l) throw new Error('lista va servicios, claves o contactos.');
  const actual = () => {
    const f = db.prepare(`SELECT t.*${lista === 'servicios' ? ', (SELECT nombre FROM concepto WHERE id = t.concepto_id) AS concepto' : ''}
      FROM ${l.tabla} t WHERE t.id = ? AND t.depto_id = ?`).get(Number(e.id), deptoId) as Record<string, unknown> | undefined;
    if (!f) throw new Error(`No existe ese renglón en la ficha de ${codigo}. Los ids salen de ficha_depto.`);
    return f;
  };
  if (accion === 'alta') {
    ensayar(db, () => agregar(db, lista, deptoId, campos));
    return { tipo: 'ficha', accion, args: { lista, depto_id: deptoId, campos }, antes: null, titulo: `Nuevo ${l.nombre} en ${codigo}`, campos: vistaFila(l, campos) };
  }
  if (accion === 'edicion') {
    const antes = actual();
    ensayar(db, () => editar(db, lista, Number(e.id), campos));
    return { tipo: 'ficha', accion, args: { lista, id: Number(e.id), campos }, antes, titulo: `Corregir ${l.nombre} de ${codigo}`, campos: comparar(vistaFila(l, campos), vistaFila(l, antes)) };
  }
  if (accion === 'borrado') {
    const antes = actual();
    return { tipo: 'ficha', accion, args: { lista, id: Number(e.id) }, antes, titulo: `Borrar ${l.nombre} de ${codigo}`, campos: vistaFila(l, antes) };
  }
  throw new Error(`Acción desconocida: ${accion}.`);
}

// ---- El mes: traer de Stays y la cotización. Cerrar y reabrir, no (decisión 2 del plan 068).

export function proponerMes(db: DatabaseSync, e: Record<string, unknown>): Propuesta {
  const accion = String(e.accion), mes = String(e.mes);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('mes va YYYY-MM.');
  if (accion === 'traer_stays') {
    const p = db.prepare('SELECT estado FROM periodo WHERE mes = ?').get(mes) as { estado: string } | undefined;
    if (p?.estado === 'cerrado') throw new Error(`${mes} está cerrado: no se puede volver a traer de Stays.`);
    return { tipo: 'mes', accion, args: { mes }, antes: null, titulo: `Traer ${mes} de Stays`,
      campos: [['Mes', mes], ['Qué hace', 'Actualiza reservas y pagos; respeta los ajustes cargados a mano']] };
  }
  if (accion !== 'cotizacion') throw new Error(`Acción desconocida: ${accion}. Cerrar o reabrir el mes se hace en Liquidación.`);
  periodoAbierto(db, mes);
  const antes = db.prepare('SELECT usd_cotizacion FROM periodo WHERE mes = ?').get(mes) as { usd_cotizacion: number | null };
  const valor = nulo(e.cotizacion) == null ? null : Number(e.cotizacion);
  if (valor != null && !(valor > 0)) throw new Error('La cotización tiene que ser mayor que 0.');
  return { tipo: 'mes', accion, args: { mes, cotizacion: valor }, antes, titulo: `Cotización del dólar de ${mes}`,
    campos: comparar([['Cotización', valor == null ? 'La de la API (dólar cripto)' : `$ ${valor.toLocaleString('es-AR')}`]],
      [['Cotización', antes.usd_cotizacion == null ? '—' : `$ ${antes.usd_cotizacion.toLocaleString('es-AR')}`]]) };
}

// ---- Definiciones para la API (strict: todos los campos, los que no van en null).

const n = (type: string, description: string) => ({ type: [type, 'null'], description });
const NO_GUARDA = 'No guarda nada: arma una tarjeta que la persona confirma con un botón.';
export const DEFINICIONES = {
  proponer_movimiento: {
    descripcion: `Propone cargar, corregir o anular un movimiento (gasto, ingreso, adelanto, cobro directo, saldo inicial, ajuste). ${NO_GUARDA} `
      + 'En una corrección mandá todos los campos con el valor final. Importe en CENTAVOS, con signo: negativo si sale plata.',
    props: {
      accion: { type: 'string', enum: ['alta', 'edicion', 'anulacion'] },
      id: n('integer', 'id del movimiento (herramienta movimientos) para corregir o anular; null en alta'),
      mes: n('string', 'Mes del período al que se imputa, YYYY-MM'), fecha: n('string', 'YYYY-MM-DD'),
      depto: n('string', 'Código del depto; null = la empresa'), tipo: { type: ['string', 'null'], enum: [...TIPOS_CARGABLES, null] },
      concepto: n('string', 'Nombre del concepto (EPE, Expensas, Limpieza…)'), detalle: n('string', 'Texto libre'),
      importe_centavos: n('integer', 'Centavos con signo: -1000000 = sale $ 10.000'), moneda: { type: ['string', 'null'], enum: ['ARS', 'USD', null] },
      cuenta: n('string', 'Nombre exacto de la cuenta (herramienta cuentas); null = no mueve plata de una cuenta'),
      adjunto: n('integer', 'Número del comprobante adjunto a la pregunta, si lo hay'),
    },
    correr: proponerMovimiento,
  },
  proponer_gasto_personal: {
    descripcion: `Propone cargar, corregir o anular un gasto personal (no es de Hornera). ${NO_GUARDA} Importe en CENTAVOS, positivo.`,
    props: {
      accion: { type: 'string', enum: ['alta', 'edicion', 'anulacion'] }, id: n('integer', 'id (herramienta gastos_personales); null en alta'),
      fecha: n('string', 'YYYY-MM-DD; el mes es el de la fecha'), codigo: { type: ['string', 'null'], enum: [...CODIGOS_AJENOS, null] },
      descripcion: n('string', 'Qué fue'), importe_centavos: n('integer', 'Centavos, positivo'),
    },
    correr: proponerGastoPersonal,
  },
  proponer_ficha: {
    descripcion: `Propone cambiar la ficha de un depto: notas, o agregar, corregir o borrar un servicio, una clave o un contacto. ${NO_GUARDA} `
      + 'campos_json: servicios {concepto, cuenta, titular, paga ("hornera"|"propietario"), dia, cada_meses, mes_desde, nota}; '
      + 'claves {nombre, usuario, clave, nota}; contactos {nombre, rol, telefono, nota}; notas {notas}. En una corrección, todos los campos con el valor final.',
    props: {
      accion: { type: 'string', enum: ['alta', 'edicion', 'borrado', 'notas'] }, depto: { type: 'string', description: 'Código del depto' },
      lista: { type: ['string', 'null'], enum: ['servicios', 'claves', 'contactos', null] }, id: n('integer', 'id del renglón (ficha_depto); null en alta y notas'),
      campos_json: n('string', 'Los campos, como JSON; null en borrado'),
    },
    correr: proponerFicha,
  },
  proponer_mes: {
    descripcion: `Propone traer un mes de Stays o poner la cotización del dólar de un mes abierto (un valor, o null para pedirla a la API). ${NO_GUARDA} `
      + 'Cerrar o reabrir el mes no: eso se hace en la pantalla Liquidación.',
    props: {
      accion: { type: 'string', enum: ['traer_stays', 'cotizacion'] }, mes: { type: 'string', description: 'YYYY-MM' },
      cotizacion: n('number', 'Pesos por dólar; null = la de la API'),
    },
    correr: proponerMes,
  },
};

export const resumenPropuesta = (p: Propuesta) =>
  `Propuesta lista, todavía NO guardada (la persona la confirma o la descarta con los botones): ${p.titulo}. `
  + p.campos.map(([k, v, a]) => (a ? `${k}: ${a} → ${v}` : `${k}: ${v}`)).join(' · ');
