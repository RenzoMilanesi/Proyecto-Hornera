// Resúmenes de tarjeta de crédito de Galicia (Visa y Mastercard, PDF): control de los gastos, no una fuente.
// El Excel de gastos varios ya trae lo pagado con tarjeta (a veces sumado: "Uber" = todos los viajes), así que cada
// consumo se vincula al gasto que lo incluye, a un gasto personal o se ignora con motivo; los que faltan se cargan
// desde acá ligados a su consumo. Así nada se cuenta dos veces.
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';
import { sello } from './sello.ts';
import { crearMovimiento } from './movimientos.ts';
import { CODIGOS_AJENOS, crearGastoAjeno } from './gastosAjenos.ts';

// ---- Lector del PDF

export interface Pedazo { x: number; ancho: number; texto: string }
export interface ConsumoLeido {
  fecha: string; detalle: string; cuota: string | null; comprobante: string | null; titular: string | null;
  importe_ars: number; importe_usd: number;
}
export interface ResumenLeido { tarjeta: 'VISA' | 'MASTERCARD'; numero: string; cierre: string; consumos: ConsumoLeido[]; aviso: string | null }

const MESES: Record<string, string> = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12' };
// "13-05-26" (Visa) o "13-May-26" (Mastercard) → 2026-05-13
function fechaGalicia(s: string): string | null {
  const m = /^(\d\d)-(\d\d|[A-Za-z]{3})-(\d\d)$/.exec(s.trim());
  const mes = m && (/^\d\d$/.test(m[2]) ? m[2] : MESES[m[2].toLowerCase()]);
  return m && mes ? `20${m[3]}-${mes}-${m[1]}` : null;
}
const PLATA = /^-?\d{1,3}(\.\d{3})*,\d\d$/;
const centavos = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
// Columnas de importes del detalle (puntos PDF, borde derecho): PESOS termina en ~495 y DÓLARES en ~580.
// ponytail: posiciones fijas del formato de Galicia; si cambia, el test con renglones de ejemplo lo marca.
const X_IMPORTES = 420;
const BORDE_PESOS = 530;

// Interpreta los renglones del PDF (cada uno, sus pedazos de texto de izquierda a derecha).
export function interpretarResumen(renglones: Pedazo[][]): ResumenLeido {
  const texto = (r: Pedazo[]) => r.map((p) => p.texto).join(' ');
  const todo = renglones.map(texto);
  const numero = todo.map((t) => /Resumen N°\s*(\S+)/.exec(t)?.[1]).find(Boolean);
  const tarjeta = todo.some((t) => /Tarjeta Crédito MASTERCARD/i.test(t)) ? 'MASTERCARD' : todo.some((t) => /Tarjeta Crédito VISA/i.test(t)) ? 'VISA' : null;
  // El ciclo: cierre anterior, vencimiento anterior, cierre actual, vencimiento actual, próximo cierre y vencimiento.
  const ciclo = renglones.find((r) => r.length === 6 && r.every((p) => fechaGalicia(p.texto)));
  if (!numero || !tarjeta || !ciclo) throw new Error('No es un resumen de tarjeta de Galicia (Visa o Mastercard).');
  const cierre = fechaGalicia(ciclo[2].texto)!;

  const consumos: ConsumoLeido[] = [];
  let sinTitular = 0;     // consumos desde el último "Total Consumos de …"
  let detalle = false;    // dentro de DETALLE DEL CONSUMO
  let cargos = false;     // Mastercard: intereses e impuestos del consolidado, entre SUBTOTAL y TOTAL A PAGAR
  let total: { ars: number; usd: number } | null = null;
  for (const r of renglones) {
    const t = texto(r);
    if (/^TOTAL A PAGAR/.test(t)) {
      if (!total) total = { ars: 0, usd: 0 };
      for (const p of r) if (PLATA.test(p.texto)) total[p.x + p.ancho > BORDE_PESOS ? 'usd' : 'ars'] = centavos(p.texto);
      detalle = cargos = false;
      continue;
    }
    if (/^DETALLE DEL CONSUMO/.test(t)) { detalle = true; cargos = false; continue; }
    if (!detalle && /^SUBTOTAL/.test(t)) { cargos = true; continue; }
    if (detalle && /^SUBTOTAL/.test(t)) { sinTitular = 0; continue; } // Mastercard: cierra los del titular; siguen los adicionales
    // "TARJETA 0418 Total Consumos de NOMBRE" (Visa) o "TOTAL ADICIONAL DE NOMBRE" (Mastercard) cierran los de esa tarjeta.
    const titular = /Total Consumos de (.+)$|TOTAL ADICIONAL DE (\D+?)(\s+-?[\d.,]+)*$/i.exec(t);
    if (detalle && titular) {
      const nombre = (titular[1] ?? titular[2]).replace(/(\s+-?\d[\d.,]*)+$/, '').trim();
      consumos.slice(consumos.length - sinTitular).forEach((c) => { c.titular = nombre; });
      sinTitular = 0;
      continue;
    }
    const importes = r.filter((p) => p.x >= X_IMPORTES && PLATA.test(p.texto));
    if (!importes.length || !(detalle || cargos)) continue;
    const fecha = fechaGalicia(r[0].texto);
    if (detalle ? !fecha : fecha) continue;
    if (/SU PAGO|SALDO|^SUBTOTAL|^TOTAL/i.test(t)) continue;
    let ars = 0, usd = 0;
    for (const p of importes) (p.x + p.ancho > BORDE_PESOS ? (usd = centavos(p.texto)) : (ars = centavos(p.texto)));
    if (!ars && !usd) continue;
    const resto = r.slice(fecha ? 1 : 0).filter((p) => !importes.includes(p));
    const cuota = resto.find((p) => /^\d\d\/\d\d$/.test(p.texto) && p.x > 300 && p.x < 355);
    const comprobante = resto.find((p) => /^\d{5,6}$/.test(p.texto) && p.x > 340);
    const desc = resto.filter((p) => p !== cuota && p !== comprobante && !/^[*KFE]$/.test(p.texto)).map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim();
    consumos.push({
      fecha: fecha ?? cierre, detalle: desc || '(sin detalle)', cuota: cuota?.texto ?? null, comprobante: comprobante?.texto ?? null,
      titular: null, importe_ars: ars, importe_usd: usd,
    });
    if (detalle) sinTitular++;
  }
  if (!consumos.length) throw new Error('El resumen no tiene consumos que leer.');
  // Control: lo leído suma el total a pagar (si quedó saldo del resumen anterior, no da y se avisa).
  const suma = (k: 'importe_ars' | 'importe_usd') => consumos.reduce((s, c) => s + c[k], 0);
  const aviso = total && (total.ars !== suma('importe_ars') || total.usd !== suma('importe_usd'))
    ? `Los consumos leídos suman $ ${suma('importe_ars') / 100} y US$ ${suma('importe_usd') / 100}, pero el total a pagar es $ ${total.ars / 100} y US$ ${total.usd / 100}: revisar si quedó saldo anterior o algún renglón sin leer.`
    : null;
  return { tarjeta, numero, cierre, consumos, aviso };
}

// Renglones del PDF: pdfjs da pedazos de texto con su posición; los de la misma altura forman un renglón.
export async function renglonesDePdf(pdf: Uint8Array): Promise<Pedazo[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const tarea = pdfjs.getDocument({ data: pdf });
  const doc = await tarea.promise;
  const renglones: Pedazo[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    const porAltura = new Map<number, Pedazo[]>();
    for (const it of items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const k = [...porAltura.keys()].find((v) => Math.abs(v - y) <= 2) ?? y;
      porAltura.set(k, [...(porAltura.get(k) ?? []), { x: it.transform[4], ancho: it.width, texto: it.str.trim() }]);
    }
    for (const [, r] of [...porAltura].sort((a, b) => b[0] - a[0])) renglones.push(r.sort((a, b) => a.x - b.x));
  }
  await tarea.destroy();
  return renglones;
}

// ---- Importar y cruzar

export interface ReporteTarjeta { resumen_id: number; tarjeta: string; numero: string; consumos: number; vinculados: number; yaEstaba: boolean; aviso: string | null }

export async function importarResumen(db: DatabaseSync, pdf: Uint8Array): Promise<ReporteTarjeta> {
  let leido: ResumenLeido;
  try {
    leido = interpretarResumen(await renglonesDePdf(pdf));
  } catch (e) {
    throw new Error(/resumen/i.test((e as Error).message) ? (e as Error).message : 'No se pudo leer el PDF del resumen.');
  }
  return guardarResumen(db, leido);
}

// Guarda lo leído y lo cruza con los gastos. El mismo resumen otra vez no cambia nada.
export function guardarResumen(db: DatabaseSync, leido: ResumenLeido): ReporteTarjeta {
  const ya = db.prepare('SELECT id FROM tarjeta_resumen WHERE tarjeta = ? AND numero = ?').get(leido.tarjeta, leido.numero) as { id: number } | undefined;
  if (ya) return { resumen_id: ya.id, tarjeta: leido.tarjeta, numero: leido.numero, consumos: leido.consumos.length, vinculados: 0, yaEstaba: true, aviso: null };
  return enTransaccion(db, () => {
    const id = Number(db.prepare('INSERT INTO tarjeta_resumen(tarjeta, numero, cierre, importado_en) VALUES (?, ?, ?, ?)')
      .run(leido.tarjeta, leido.numero, leido.cierre, sello()).lastInsertRowid);
    const alta = db.prepare(`INSERT INTO consumo_tarjeta(resumen_id, fecha, detalle, cuota, comprobante, titular, importe_ars, importe_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of leido.consumos) alta.run(id, c.fecha, c.detalle, c.cuota, c.comprobante, c.titular, c.importe_ars, c.importe_usd);
    const vinculados = cruzar(db, id);
    auditar(db, 'tarjeta', id, 'importacion', null, { tarjeta: leido.tarjeta, numero: leido.numero, consumos: leido.consumos.length, vinculados });
    return { resumen_id: id, tarjeta: leido.tarjeta, numero: leido.numero, consumos: leido.consumos.length, vinculados, yaEstaba: false, aviso: leido.aviso };
  });
}

const DIAS_VENTANA = 45;
const TOLERANCIA = 100; // centavos: el Excel a veces redondea ($20.617 contra $20.617,52)

// Vincula solo cada consumo en pesos pendiente con un gasto (o gasto personal) del mismo importe que todavía no tiene
// consumo, cerca de la fecha del consumo o del cierre (las cuotas son de compras viejas). Si hay más de un candidato en
// cualquiera de las dos direcciones (importes redondos: $7.000 de viandas y $7.000 de ferretería), queda pendiente
// para elegirlo a mano: un vínculo equivocado nadie lo revisa.
// ponytail: uno a uno; los sumados (Uber, viandas) y los de dólares se vinculan a mano.
export function cruzar(db: DatabaseSync, resumenId: number): number {
  const r = db.prepare('SELECT cierre FROM tarjeta_resumen WHERE id = ?').get(resumenId) as { cierre: string } | undefined;
  if (!r) throw new Error('No existe el resumen.');
  const pendientes = db.prepare(`SELECT c.id, c.fecha, c.importe_ars FROM consumo_tarjeta c ${PENDIENTE} AND c.resumen_id = ? AND c.importe_ars > 0
    ORDER BY c.fecha`).all(resumenId) as { id: number; fecha: string; importe_ars: number }[];
  const cerca = `(abs(julianday(x.fecha) - julianday(:fecha)) <= ${DIAS_VENTANA} OR abs(julianday(x.fecha) - julianday(:cierre)) <= ${DIAS_VENTANA})`;
  const candidato = db.prepare(`
    SELECT 'mov' AS tipo, x.id FROM movimiento x
     WHERE x.estado = 'vigente' AND x.tipo IN ('gasto', 'pre_liquidacion') AND abs(-x.importe_ars - :importe) <= ${TOLERANCIA} AND ${cerca}
       AND NOT EXISTS (SELECT 1 FROM consumo_tarjeta c WHERE c.movimiento_id = x.id)
    UNION ALL
    SELECT 'ajeno', x.id FROM gasto_ajeno x
     WHERE x.estado = 'vigente' AND abs(x.importe - :importe) <= ${TOLERANCIA} AND ${cerca}
       AND NOT EXISTS (SELECT 1 FROM consumo_tarjeta c WHERE c.gasto_ajeno_id = x.id)
  `);
  const ponerMov = db.prepare('UPDATE consumo_tarjeta SET movimiento_id = ?, gasto_ajeno_id = NULL, ignorado = NULL WHERE id = ?');
  const ponerAjeno = db.prepare('UPDATE consumo_tarjeta SET gasto_ajeno_id = ?, movimiento_id = NULL, ignorado = NULL WHERE id = ?');
  // Candidatos de cada consumo y de cuántos consumos es candidato cada gasto: solo los pares únicos en las dos direcciones.
  const candidatos = pendientes.map((c) => (candidato.all({ fecha: c.fecha, cierre: r.cierre, importe: c.importe_ars }) as { tipo: string; id: number }[]));
  const veces = new Map<string, number>();
  for (const g of candidatos.flat()) veces.set(`${g.tipo}:${g.id}`, (veces.get(`${g.tipo}:${g.id}`) ?? 0) + 1);
  return enTransaccion(db, () => {
    let n = 0;
    pendientes.forEach((c, i) => {
      const [g, otro] = candidatos[i];
      if (!g || otro || veces.get(`${g.tipo}:${g.id}`) !== 1) return;
      (g.tipo === 'mov' ? ponerMov : ponerAjeno).run(g.id, c.id);
      n++;
    });
    return n;
  });
}

// Pendiente: sin destino, o con un gasto que después se anuló.
const PENDIENTE = `LEFT JOIN movimiento m ON m.id = c.movimiento_id LEFT JOIN gasto_ajeno ga ON ga.id = c.gasto_ajeno_id
  WHERE c.ignorado IS NULL AND COALESCE(m.estado, ga.estado, 'anulado') = 'anulado'`;

function enTransaccion<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Pantalla

export function listarResumenes(db: DatabaseSync) {
  return db.prepare(`
    SELECT r.id, r.tarjeta, r.numero, r.cierre, count(c.id) AS consumos,
           sum(c.ignorado IS NULL AND COALESCE(m.estado, ga.estado, 'anulado') = 'anulado') AS pendientes
      FROM tarjeta_resumen r JOIN consumo_tarjeta c ON c.resumen_id = r.id
      LEFT JOIN movimiento m ON m.id = c.movimiento_id LEFT JOIN gasto_ajeno ga ON ga.id = c.gasto_ajeno_id
     GROUP BY r.id ORDER BY r.cierre DESC, r.tarjeta`).all();
}

export function verResumen(db: DatabaseSync, id: number) {
  const r = db.prepare('SELECT id, tarjeta, numero, cierre FROM tarjeta_resumen WHERE id = ?').get(id) as { cierre: string } | undefined;
  if (!r) throw new Error('No existe el resumen.');
  const consumos = db.prepare(`
    SELECT c.id, c.fecha, c.detalle, c.cuota, c.comprobante, c.titular, c.importe_ars, c.importe_usd, c.ignorado,
           CASE WHEN m.estado = 'vigente' THEN 'gasto' WHEN ga.estado = 'vigente' THEN 'personal'
                WHEN c.ignorado IS NOT NULL THEN 'ignorado' ELSE 'pendiente' END AS estado,
           CASE WHEN m.estado = 'vigente' THEN c.movimiento_id END AS movimiento_id,
           CASE WHEN ga.estado = 'vigente' THEN c.gasto_ajeno_id END AS gasto_ajeno_id,
           CASE WHEN m.estado = 'vigente' THEN COALESCE(d.codigo, 'INT') || ' · ' || COALESCE(co.nombre, '') || COALESCE(' · ' || m.detalle, '')
                WHEN ga.estado = 'vigente' THEN ga.codigo || COALESCE(' · ' || ga.descripcion, '') END AS destino,
           CASE WHEN m.estado = 'vigente' THEN -m.importe_ars WHEN ga.estado = 'vigente' THEN ga.importe END AS destino_importe
      FROM consumo_tarjeta c
      LEFT JOIN movimiento m ON m.id = c.movimiento_id LEFT JOIN depto d ON d.id = m.depto_id LEFT JOIN concepto co ON co.id = m.concepto_id
      LEFT JOIN gasto_ajeno ga ON ga.id = c.gasto_ajeno_id
     WHERE c.resumen_id = ? ORDER BY c.id`).all(id);
  // Gastos cerca del cierre a los que se pueden vincular consumos, con lo que ya tienen vinculado (los sumados del Excel
  // se completan en varias vueltas: primero los UBER, después los UBR). Primero los que no tienen ninguno.
  const ventana = `abs(julianday(x.fecha) - julianday(:cierre)) <= ${DIAS_VENTANA}`;
  const gastos = db.prepare(`SELECT * FROM (
    SELECT 'mov' AS tipo, x.id, x.fecha, COALESCE(d.codigo, 'INT') AS codigo, COALESCE(co.nombre, '') || COALESCE(' · ' || x.detalle, '') AS descripcion,
           -x.importe_ars AS importe, (SELECT COALESCE(sum(c.importe_ars), 0) FROM consumo_tarjeta c WHERE c.movimiento_id = x.id) AS vinculado
      FROM movimiento x LEFT JOIN depto d ON d.id = x.depto_id LEFT JOIN concepto co ON co.id = x.concepto_id
     WHERE x.estado = 'vigente' AND x.tipo IN ('gasto', 'pre_liquidacion') AND x.importe_ars < 0 AND ${ventana}
    UNION ALL
    SELECT 'ajeno', x.id, x.fecha, x.codigo, COALESCE(x.descripcion, ''), x.importe,
           (SELECT COALESCE(sum(c.importe_ars), 0) FROM consumo_tarjeta c WHERE c.gasto_ajeno_id = x.id)
      FROM gasto_ajeno x WHERE x.estado = 'vigente' AND ${ventana}
    ) ORDER BY vinculado > 0, fecha, codigo`).all({ cierre: r.cierre });
  return { ...r, consumos, gastos };
}

// ---- Acciones sobre consumos elegidos (todos del mismo resumen)

function elegidos(db: DatabaseSync, ids: unknown): { id: number; resumen_id: number; fecha: string; detalle: string; importe_ars: number; importe_usd: number }[] {
  if (!Array.isArray(ids) || !ids.length || !ids.every((i) => Number.isInteger(i))) throw new Error('Elegí al menos un consumo.');
  const filas = db.prepare(`SELECT id, resumen_id, fecha, detalle, importe_ars, importe_usd FROM consumo_tarjeta WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as any[];
  if (filas.length !== new Set(ids).size) throw new Error('Algún consumo ya no existe.');
  if (new Set(filas.map((f) => f.resumen_id)).size > 1) throw new Error('Los consumos tienen que ser del mismo resumen.');
  return filas;
}

function marcar(db: DatabaseSync, filas: { id: number; resumen_id: number }[], destino: { movimiento_id?: number; gasto_ajeno_id?: number; ignorado?: string }, accion: string) {
  const upd = db.prepare('UPDATE consumo_tarjeta SET movimiento_id = ?, gasto_ajeno_id = ?, ignorado = ? WHERE id = ?');
  for (const f of filas) upd.run(destino.movimiento_id ?? null, destino.gasto_ajeno_id ?? null, destino.ignorado ?? null, f.id);
  auditar(db, 'tarjeta', filas[0].resumen_id, 'modificacion', null, { accion, consumos: filas.map((f) => f.id), ...destino });
}

export function vincular(db: DatabaseSync, ids: unknown, destino: { movimiento_id?: unknown; gasto_ajeno_id?: unknown }) {
  enTransaccion(db, () => {
    const filas = elegidos(db, ids);
    if (destino.movimiento_id != null) {
      const ok = db.prepare(`SELECT 1 FROM movimiento WHERE id = ? AND estado = 'vigente' AND tipo IN ('gasto', 'pre_liquidacion')`).get(Number(destino.movimiento_id));
      if (!ok) throw new Error('El gasto no existe o está anulado.');
      marcar(db, filas, { movimiento_id: Number(destino.movimiento_id) }, 'vincular');
    } else if (destino.gasto_ajeno_id != null) {
      if (!db.prepare(`SELECT 1 FROM gasto_ajeno WHERE id = ? AND estado = 'vigente'`).get(Number(destino.gasto_ajeno_id))) throw new Error('El gasto personal no existe o está anulado.');
      marcar(db, filas, { gasto_ajeno_id: Number(destino.gasto_ajeno_id) }, 'vincular');
    } else {
      throw new Error('Elegí el gasto.');
    }
  });
}

export function ignorar(db: DatabaseSync, ids: unknown, motivo: unknown) {
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  if (!m) throw new Error('Escribí por qué no va como gasto.');
  enTransaccion(db, () => marcar(db, elegidos(db, ids), { ignorado: m }, 'ignorar'));
}

// Un gasto cargado desde la tarjeta no se suelta: quedaría vigente sin consumo y se podría cargar dos veces.
// Se anula en su pantalla y el consumo vuelve solo a pendiente.
export function desvincular(db: DatabaseSync, ids: unknown) {
  enTransaccion(db, () => {
    const filas = elegidos(db, ids);
    const desTarjeta = db.prepare(`
      SELECT CASE WHEN m.origen LIKE 'tarjeta:%' AND m.estado = 'vigente' THEN 'Movimientos'
                  WHEN ga.origen LIKE 'tarjeta:%' AND ga.estado = 'vigente' THEN 'Gastos personales' END AS pantalla
        FROM consumo_tarjeta c LEFT JOIN movimiento m ON m.id = c.movimiento_id LEFT JOIN gasto_ajeno ga ON ga.id = c.gasto_ajeno_id
       WHERE c.id IN (${filas.map(() => '?').join(',')}) AND pantalla IS NOT NULL LIMIT 1`).get(...filas.map((f) => f.id)) as { pantalla: string } | undefined;
    if (desTarjeta) throw new Error(`Ese gasto se cargó desde la tarjeta: anulalo en ${desTarjeta.pantalla} y el consumo vuelve a pendiente.`);
    marcar(db, filas, {}, 'desvincular');
  });
}

export interface DatosCargar { consumos: unknown; codigo: unknown; concepto?: unknown; detalle?: unknown; importe?: unknown }

// Carga los consumos elegidos como un gasto (depto o INT) o un gasto personal (CAY, LAU…), ya vinculado.
// Va en el mes abierto de la fecha del último consumo o, si ese mes está cerrado, en el primer mes abierto.
export function cargar(db: DatabaseSync, d: DatosCargar): number {
  return enTransaccion(db, () => {
    const filas = elegidos(db, d.consumos);
    const usd = filas.some((f) => f.importe_usd !== 0);
    const importe = d.importe == null || d.importe === '' ? (usd ? 0 : filas.reduce((s, f) => s + f.importe_ars, 0)) : Number(d.importe);
    if (!Number.isInteger(importe) || importe <= 0) throw new Error(usd ? 'Hay consumos en dólares: poné el importe en pesos.' : 'El importe tiene que ser positivo.');
    const abiertos = (db.prepare(`SELECT mes FROM periodo WHERE estado = 'abierto' ORDER BY mes`).all() as { mes: string }[]).map((p) => p.mes);
    if (!abiertos.length) throw new Error('No hay un mes abierto.');
    const ultima = filas.map((f) => f.fecha).sort().at(-1)!;
    const fecha = abiertos.includes(ultima.slice(0, 7)) ? ultima : `${abiertos[0]}-01`;
    const detalle = (typeof d.detalle === 'string' && d.detalle.trim()) || filas.map((f) => f.detalle).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const codigo = String(d.codigo ?? '').trim().toUpperCase();
    // Marca del gasto creado acá: el primer consumo y la vez (uno anulado conserva su origen y se puede volver a cargar).
    const base = `tarjeta:${filas[0].id}:`;
    const vez = (db.prepare(`SELECT (SELECT count(*) FROM movimiento WHERE origen LIKE :o) + (SELECT count(*) FROM gasto_ajeno WHERE origen LIKE :o) AS n`)
      .get({ o: `${base}%` }) as { n: number }).n + 1;
    const origen = `${base}${vez}`;
    if (CODIGOS_AJENOS.includes(codigo)) {
      const id = crearGastoAjeno(db, { fecha, codigo, descripcion: `Tarjeta: ${detalle}`, importe, origen });
      marcar(db, filas, { gasto_ajeno_id: id }, 'cargar');
      return id;
    }
    const id = crearMovimiento(db, {
      mes: fecha.slice(0, 7), fecha, depto: codigo && codigo !== 'INT' ? codigo : null, tipo: 'gasto',
      concepto: typeof d.concepto === 'string' && d.concepto.trim() ? d.concepto : 'Gastos varios',
      detalle: `Tarjeta: ${detalle}`, importe_ars: -importe, importe_usd: 0, cuenta_id: null, origen,
    });
    marcar(db, filas, { movimiento_id: id }, 'cargar');
    return id;
  });
}
