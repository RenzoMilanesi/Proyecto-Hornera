// Herramientas del asistente (plan 061): todas de solo lectura. Cada una reusa la función que está detrás de su ruta GET;
// la IA nunca toca la base de otra forma. consulta_sql es la única libre, con tres cercos (ver sqlProceso.ts).
import { fork } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import type Anthropic from '@anthropic-ai/sdk';
import { liquidacionDelMes, listarCuentas, listarDeptos, listarPeriodos, listarPropietarios, reservasDelMes } from '../consultas.ts';
import { hojaDepto } from '../liquidacion/hoja.ts';
import { historial } from '../liquidacion/historial.ts';
import { listarTransferencias } from '../liquidacion/pagos.ts';
import { evolucion, resumenDelMes, resumenHornera } from '../resumen.ts';
import { listarMovimientos } from '../movimientos.ts';
import { listarGastosAjenos } from '../gastosAjenos.ts';
import { ficha, vencimientos } from '../ficha.ts';
import * as limpieza from '../limpieza.ts';
import { listarComprobantes } from '../facturacion.ts';
import { listarMisComprobantes } from '../misComprobantes.ts';
import { MAX_FILAS, OCULTAS, type RespuestaSql } from './sqlProceso.ts';

export interface Herramienta {
  definicion: Anthropic.Tool;
  correr(db: DatabaseSync, entrada: Record<string, unknown>): unknown; // consulta_sql devuelve una promesa
}

export { MAX_FILAS };
export const MAX_MS = 5000;

// ponytail: plata en centavos tal como sale de las funciones, con el aviso en cada descripción. Convertir a pesos por
// nombre de campo es frágil (total = noches en un lado y plata en otro; cotizacion no es centavos); si la IA se equivoca
// al dividir, cada función tendría que declarar sus campos de plata.
const PLATA = 'Importes enteros en CENTAVOS (dividí por 100); ocupacion, *_pct y comisionPct son fracciones; cotizacion y cambio son pesos por dólar.';

const MES = { type: 'string', description: 'Mes YYYY-MM' };
const DEPTO = { type: 'string', description: 'Código del depto, p. ej. ALM (de listar_deptos)' };

const objeto = (props: Record<string, object> = {}) =>
  ({ type: 'object' as const, properties: props, required: Object.keys(props), additionalProperties: false });

// strict solo con parámetros: sin ellos no hay nada que validar, y la API acepta como mucho 20 herramientas strict.
const h = (name: string, description: string, props: Record<string, object>, correr: Herramienta['correr']): Herramienta =>
  ({ definicion: { name, description, input_schema: objeto(props), ...(Object.keys(props).length ? { strict: true } : {}) }, correr });

function idDepto(db: DatabaseSync, codigo: unknown) {
  const d = db.prepare('SELECT id FROM depto WHERE upper(codigo) = upper(?)').get(String(codigo)) as { id: number } | undefined;
  if (!d) throw new Error(`No existe el depto ${codigo}. Los códigos salen de listar_deptos.`);
  return d.id;
}

const s = (v: unknown) => String(v);

const HERRAMIENTAS: Herramienta[] = [
  h('listar_deptos', 'Deptos que administra Hornera: código, nombre, dirección, estado, dueño y comisión.', {},
    (db) => listarDeptos(db).map(({ fotos: _, ...d }) => d)),
  h('listar_propietarios', 'Propietarios activos: id, nombre, moneda en que se les liquida y sus deptos.', {}, (db) => listarPropietarios(db)),
  h('periodos', 'Meses cargados, si están abiertos o cerrados, su cotización del dólar y fecha de pago.', {}, (db) => listarPeriodos(db)),
  h('cuentas', `Cuentas de la empresa con su saldo actual. ${PLATA}`, {}, (db) => listarCuentas(db)),
  h('liquidacion', `Liquidación de todos los deptos de un mes: ingresos, costos, honorarios y saldo a pagar. Un mes cerrado sale como se guardó al cerrar. ${PLATA}`,
    { mes: MES }, (db, e) => liquidacionDelMes(db, s(e.mes))),
  h('hoja_depto', `Hoja de un depto en un mes (lo que va en el PDF al propietario): resumen, noches, reservas y movimientos. ${PLATA}`,
    { mes: MES, depto: DEPTO }, (db, e) => {
      const hoja = hojaDepto(db, s(e.mes), s(e.depto));
      return { ...hoja, facturas: hoja.facturas.map(({ qr: _, ...f }) => f) }; // el QR es un SVG de 35 KB
    }),
  h('reservas', `Reservas que pertenecen a un mes (regla del período: noches en el mes o llegada en el mes), con lo cobrado neto. Usar esta y no SQL para "reservas de un mes". ${PLATA}`,
    { mes: MES, depto: { ...DEPTO, type: ['string', 'null'], description: 'Código del depto, o null para todos' } },
    (db, e) => {
      const filas = reservasDelMes(db, s(e.mes)).filter((r) => e.depto == null || s(r.depto).toUpperCase() === s(e.depto).toUpperCase())
        .map(({ desglose_json: _, ...r }) => r);
      // Un mes importado del Excel no tiene sus reservas: solo las que trajo Stays al traer el mes siguiente.
      const excel = db.prepare(`SELECT sum(l.cant_reservas) n FROM periodo p JOIN liquidacion l ON l.periodo_id = p.id WHERE p.mes = ? AND p.estado = 'cerrado'
        AND NOT EXISTS (SELECT 1 FROM liquidacion l2 JOIN liquidacion_reserva lr ON lr.liquidacion_id = l2.id WHERE l2.periodo_id = p.id)`).get(s(e.mes)) as { n: number | null };
      return excel.n == null ? filas : {
        filas,
        aviso: `${s(e.mes)} vino del Excel: la app no tiene sus reservas (el Excel registró ${excel.n}). Estas ${filas.length} son solo las que se trajeron de Stays con el mes siguiente. No sirven para totales, rankings ni "la más/menos" del mes: decilo así.`,
      };
    }),
  h('resumen_mes', `KPIs de los deptos en un mes: ocupación, ADR, RevPAR, bruto, honorarios, resultado de Hornera y saldos de cuentas. ${PLATA}`,
    { mes: MES }, (db, e) => resumenDelMes(db, s(e.mes))),
  h('evolucion', `Evolución mes a mes (meses cerrados): ocupación, ADR, RevPAR, bruto, honorarios y resultado. ${PLATA}`, {}, (db) => evolucion(db)),
  h('resumen_hornera', `Resultado de la empresa en un mes: honorarios, gastos por concepto, gastos personales, lo que falta pagar y lo disponible. ${PLATA}`,
    { mes: MES }, (db, e) => resumenHornera(db, s(e.mes))),
  h('movimientos', `Movimientos del mes (gastos, ingresos, adelantos, pagos a propietarios, transferencias entre cuentas). ${PLATA}`,
    { mes: MES }, (db, e) => listarMovimientos(db, s(e.mes))),
  h('gastos_personales', `Gastos personales del mes (Amancay, Lautaro, Casa del Estudiante, la casa): no son de Hornera. ${PLATA}`,
    { mes: MES }, (db, e) => listarGastosAjenos(db, s(e.mes))),
  h('transferencias', `Qué se le paga a cada propietario de un mes cerrado: saldo, pagado y pendiente. ${PLATA}`,
    { mes: MES }, (db, e) => listarTransferencias(db, s(e.mes))),
  h('historial_pagos', `Pagos a lo largo del tiempo de un depto o de un propietario (uno de los dos, el otro null). ${PLATA}`,
    { depto: { ...DEPTO, type: ['string', 'null'] }, propietario_id: { type: ['integer', 'null'], description: 'id de listar_propietarios' } },
    (db, e) => historial(db, { deptoId: e.depto == null ? undefined : idDepto(db, e.depto), propietarioId: e.propietario_id == null ? undefined : Number(e.propietario_id) }, false)),
  h('ficha_depto', 'Ficha de un depto: notas, servicios e impuestos con su vencimiento, claves (wifi, alarma, caja de llaves) y contactos.',
    { depto: DEPTO }, (db, e) => ficha(db, idDepto(db, e.depto))),
  h('vencimientos', 'Impuestos y servicios que vencen en un mes y si ya se pagaron.', { mes: MES }, (db, e) => vencimientos(db, s(e.mes))),
  h('limpieza_horas', 'Horas de limpieza cargadas entre dos fechas, por operaria, depto y mes (minutos).',
    { desde: { type: 'string', description: 'YYYY-MM-DD' }, hasta: { type: 'string', description: 'YYYY-MM-DD' } },
    (db, e) => limpieza.horas(db, s(e.desde), s(e.hasta))),
  h('limpieza_liquidaciones', `Períodos de limpieza liquidados a la coordinadora: horas, total y si se pagó. ${PLATA}`, {}, (db) => limpieza.listarLiquidaciones(db)),
  h('comprobantes', `Facturas y notas de crédito emitidas por la app en ARCA en un mes. ${PLATA}`,
    { mes: MES }, (db, e) => listarComprobantes(db, s(e.mes), false)),
  h('mis_comprobantes', `Comprobantes de ARCA importados de Mis Comprobantes (incluye lo facturado por fuera de la app) en un mes. ${PLATA}`,
    { mes: MES }, (db, e) => listarMisComprobantes(db, s(e.mes))),
];

// Cada consulta en un proceso aparte, que se mata si pasa el tope de tiempo (plan 063): el servidor sigue atendiendo.
export function consultaSql(db: DatabaseSync, sql: string, maxMs = MAX_MS) {
  const ruta = db.location();
  if (!ruta) throw new Error('consulta_sql necesita una base en archivo');
  return new Promise<{ filas: unknown[]; aviso?: string }>((ok, mal) => {
    // En Electron, fork lanza electron.exe: sin ELECTRON_RUN_AS_NODE abriría otra app en vez de correr el script.
    const hijo = fork(new URL('./sqlProceso.ts', import.meta.url), { serialization: 'advanced', stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const fin = (f: () => void) => { clearTimeout(reloj); hijo.removeAllListeners(); f(); };
    // Se responde recién cuando el proceso terminó: así no queda la base tomada ni un proceso suelto.
    const reloj = setTimeout(() => fin(() => {
      hijo.once('exit', () => mal(new Error(`La consulta tardó más de ${maxMs / 1000} s y se cortó: simplificala (menos tablas cruzadas, un WHERE, sin recursión sin fin).`)));
      hijo.kill();
    }), maxMs);
    hijo.once('message', (r: RespuestaSql) => fin(() => ('error' in r ? mal(new Error(r.error)) : ok(r))));
    hijo.once('error', (e) => fin(() => mal(e)));
    hijo.once('exit', (codigo) => fin(() => mal(new Error(`La consulta terminó sin respuesta (código ${codigo}).`))));
    hijo.send({ ruta, sql });
  });
}

// Tablas y columnas de la base (sin las ocultas), para la descripción de consulta_sql. Siempre igual: no rompe el caché.
function esquema(db: DatabaseSync) {
  const tablas = db.prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`)
    .all() as { name: string; type: string }[];
  return tablas.filter((t) => !OCULTAS.includes(t.name))
    .map((t) => `${t.type === 'view' ? 'vista ' : ''}${t.name}(${(db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t.name) as { name: string }[]).map((x) => x.name).join(', ')})`)
    .join('\n');
}

export function herramientas(db: DatabaseSync): Herramienta[] {
  const sql = h('consulta_sql',
    `SELECT de solo lectura sobre la base SQLite, para lo que ninguna otra herramienta cubre. Máximo ${MAX_FILAS} filas y ${MAX_MS / 1000} s. `
    + `Plata en CENTAVOS (enteros), fechas YYYY-MM-DD, meses YYYY-MM. Para "reservas de un mes" usar la herramienta reservas: `
    + `la regla del período no es trivial en SQL. Evitá SELECT * en reserva y pago (raw_json es grande): elegí columnas. Los movimientos anulados tienen estado = 'anulado' y no cuentan.\n\nTablas:\n${esquema(db)}`,
    { sql: { type: 'string', description: 'Una sola sentencia SELECT (o WITH … SELECT)' } },
    (d, e) => consultaSql(d, s(e.sql)));
  return [...HERRAMIENTAS, sql];
}
