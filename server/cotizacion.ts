// Cotización del dólar cripto (venta) del período: la del día de cierre, o la de hoy como
// provisoria si el cierre todavía no llegó. DECISIONES: "Tipo de cambio".
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from './auditoria.ts';

const URL_HISTORICO = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/cripto';
const URL_ACTUAL = 'https://dolarapi.com/v1/dolares/cripto';

export type Fetch = typeof fetch;
export interface Cotizacion { cotizacion: number; fecha: string; provisoria: boolean }

const DIA = 86_400_000;
// Día de cierre: el anterior a fecha_cierre_reservas (exclusiva).
export const diaDeCierre = (cierreReservas: string) => new Date(Date.parse(cierreReservas) - DIA).toISOString().slice(0, 10);
// Hoy en la hora de esta PC (Argentina), no en UTC.
export const hoyLocal = () => new Date().toLocaleDateString('sv');

async function venta(url: string, fetchFn: Fetch): Promise<number | null> {
  let res: Response;
  try {
    res = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Error(`No se pudo traer el dólar: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`No se pudo traer el dólar: la API respondió ${res.status}.`);
  const v = (await res.json() as { venta?: unknown }).venta;
  if (typeof v !== 'number' || !(v > 0)) throw new Error('No se pudo traer el dólar: la API devolvió un valor inválido.');
  return v;
}

// Del cierre si ya pasó y la API lo tiene; si no, la de ahora (provisoria, aunque sea del mismo día del cierre).
export async function cotizacionCripto(cierre: string, hoy: string, fetchFn: Fetch = fetch): Promise<Cotizacion> {
  if (hoy > cierre) {
    const v = await venta(`${URL_HISTORICO}/${cierre.replaceAll('-', '/')}`, fetchFn);
    if (v != null) return { cotizacion: v, fecha: cierre, provisoria: false };
  }
  const v = await venta(URL_ACTUAL, fetchFn);
  if (v == null) throw new Error('No se pudo traer el dólar: la API respondió 404.');
  return { cotizacion: v, fecha: hoy, provisoria: true };
}

interface Periodo { id: number; estado: string; fecha_cierre_reservas: string; usd_cotizacion: number | null; usd_cotizacion_fuente: string | null; usd_cotizacion_fecha: string | null; usd_cotizacion_provisoria: number }

// forzar: la pide aunque esté cargada a mano ("Pedir a la API"). Sin forzar ("traer mes"),
// la manual manda y se devuelve un aviso. Errores de red: excepción; la cotización queda como estaba.
export async function actualizarCotizacion(db: DatabaseSync, mes: string, forzar: boolean, fetchFn: Fetch = fetch, hoy = hoyLocal()):
  Promise<Partial<Cotizacion> & { aviso?: string }> {
  const p = db.prepare('SELECT id, estado, fecha_cierre_reservas, usd_cotizacion, usd_cotizacion_fuente, usd_cotizacion_fecha, usd_cotizacion_provisoria FROM periodo WHERE mes = ?')
    .get(mes) as Periodo | undefined;
  if (!p) throw new Error(`No existe el período ${mes}`);
  if (p.estado !== 'abierto') throw new Error('El período está cerrado');
  const cierre = diaDeCierre(p.fecha_cierre_reservas);
  if (!forzar && p.usd_cotizacion_fuente === 'manual') {
    return { aviso: `La cotización del dólar de ${mes} está cargada a mano ($ ${p.usd_cotizacion}): no se pidió a la API.` };
  }
  if (!forzar && p.usd_cotizacion_fuente === 'api' && !p.usd_cotizacion_provisoria && p.usd_cotizacion_fecha === cierre) {
    return { cotizacion: p.usd_cotizacion!, fecha: cierre, provisoria: false }; // ya es la del cierre
  }
  const c = await cotizacionCripto(cierre, hoy, fetchFn);
  if (c.cotizacion !== p.usd_cotizacion || p.usd_cotizacion_fuente !== 'api' || c.fecha !== p.usd_cotizacion_fecha || +c.provisoria !== p.usd_cotizacion_provisoria) {
    // Sin forzar, una manual guardada mientras se esperaba a la API manda.
    // Solo si el período sigue abierto: mientras se esperaba a la API lo pudieron cerrar (es congelado).
    const { changes } = db.prepare(`UPDATE periodo SET usd_cotizacion = ?, usd_cotizacion_fuente = 'api', usd_cotizacion_fecha = ?,
        usd_cotizacion_provisoria = ? WHERE id = ? AND estado = 'abierto' AND (? OR usd_cotizacion_fuente IS NOT 'manual')`)
      .run(c.cotizacion, c.fecha, c.provisoria ? 1 : 0, p.id, forzar ? 1 : 0);
    if (!changes) {
      const ahora = db.prepare('SELECT estado FROM periodo WHERE id = ?').get(p.id) as { estado: string };
      return { aviso: ahora.estado !== 'abierto' ? `Se cerró ${mes} mientras se pedía la cotización a la API: no se cambió.`
        : 'La cotización del dólar se cargó a mano mientras se pedía a la API: se dejó la manual.' };
    }
    auditar(db, 'periodo', p.id, 'modificacion',
      { usd_cotizacion: p.usd_cotizacion, fuente: p.usd_cotizacion_fuente, fecha: p.usd_cotizacion_fecha },
      { usd_cotizacion: c.cotizacion, fuente: 'api', fecha: c.fecha });
  }
  const aviso = c.provisoria && hoy >= cierre
    ? `Todavía no está la cotización del dólar del ${cierre}${hoy === cierre ? ' (el día no terminó)' : ''}: se usó la de ahora como provisoria.` : undefined;
  return { ...c, aviso };
}
