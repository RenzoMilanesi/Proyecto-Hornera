// Marcha en paralelo: compara la liquidación que calcula la app para un mes con las
// hojas por depto del Excel de ese mes, sin importar nada.
import * as XLSX from 'xlsx';
import type { DatabaseSync } from 'node:sqlite';
import { hojasDeDepto, leerHojaDepto } from '../importador/excel.ts';
import { liquidarPeriodo } from './servicio.ts';
import { auditar } from '../auditoria.ts';

// Tolerancia de la comparación, en % del valor del Excel: el dólar con que se armó el Excel casi nunca es
// exactamente el del sistema. No se aplica a las noches, que tienen que coincidir.
const TOLERANCIA_INICIAL = 3;
export function leerTolerancia(db: DatabaseSync): number {
  const v = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'comparar.tolerancia_pct'`).get() as { valor: string } | undefined;
  return v ? Number(v.valor) : TOLERANCIA_INICIAL;
}
export function guardarTolerancia(db: DatabaseSync, pct: unknown) {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 50) throw new Error('La tolerancia va de 0 a 50 %.');
  const antes = leerTolerancia(db);
  db.prepare(`INSERT INTO configuracion(clave, valor) VALUES ('comparar.tolerancia_pct', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(String(pct));
  auditar(db, 'configuracion', null, 'modificacion', { 'comparar.tolerancia_pct': antes }, { 'comparar.tolerancia_pct': pct });
}
/** Distinto si la diferencia pasa la tolerancia fija (centavos) y también el % del valor del Excel. */
export const fueraDeTolerancia = (app: number, excel: number, fija: number, pct: number) =>
  Math.abs(app - excel) > Math.max(fija, Math.abs(excel) * pct / 100);

export interface Diferencia { campo: string; unidad: 'ARS' | 'USD' | 'noches'; app: number; excel: number }
export interface ComparacionDepto { codigo: string; estado: 'igual' | 'distinto' | 'solo_excel' | 'solo_app'; diferencias: Diferencia[] }

export function compararConExcel(db: DatabaseSync, mes: string, contenido: Buffer): { mes: string; tolerancia: number; deptos: ComparacionDepto[] } {
  const wb = XLSX.read(contenido, { type: 'buffer', cellFormula: true });
  const b1 = wb.Sheets['Datos balance']?.B1?.v;
  const mesExcel = typeof b1 === 'number'
    ? new Date(Date.UTC(1899, 11, 30) + Math.floor(b1) * 86_400_000).toISOString().slice(0, 7) : null;
  if (mesExcel !== mes) throw new Error(`El Excel es de ${mesExcel ?? 'un mes que no se pudo leer'}, no de ${mes}.`);

  const calculo = liquidarPeriodo(db, mes);
  if (calculo.cambio === null) throw new Error(calculo.avisos[0]);
  const pct = leerTolerancia(db);
  const p = db.prepare('SELECT fecha_inicio, fecha_cierre_reservas FROM periodo WHERE mes = ?').get(mes) as { fecha_inicio: string; fecha_cierre_reservas: string };
  const app = new Map(calculo.deptos.map((d) => [d.codigo, d]));

  const deptos: ComparacionDepto[] = [];
  for (const [codigo, hoja] of hojasDeDepto(wb)) {
    const d = app.get(codigo);
    app.delete(codigo);
    if (!d) { deptos.push({ codigo, estado: 'solo_excel', diferencias: [] }); continue; }
    const x = leerHojaDepto(hoja, p.fecha_inicio, p.fecha_cierre_reservas);
    const r = d.resultado;
    // [campo, unidad, app, excel, tolerancia en centavos]: los ingresos prorrateados no se redondean.
    const campos: [string, Diferencia['unidad'], number, number, number][] = [
      ['Ingresos', 'ARS', r.ingresos.ars, x.ingresos.ars, 1],
      ['Ingresos', 'USD', r.ingresos.usd, x.ingresos.usd, 1],
      ['Costos operativos', 'ARS', r.costosOperativos, x.costosOperativos, 0],
      ['Comisiones', 'ARS', d.comisiones.ars, x.comisiones.ars, 1],
      ['Comisiones', 'USD', d.comisiones.usd, x.comisiones.usd, 1],
      ['Bruto', 'ARS', r.bruto, x.bruto, 0],
      ['Honorarios', 'ARS', r.honorarios, x.honorarios, 0],
      ['Saldo', 'ARS', r.saldo.ars, x.saldo.ars, 0],
      ['Saldo', 'USD', r.saldo.usd, x.saldo.usd, 0],
      ['Noches ocupadas', 'noches', r.nochesOcupadas, x.nochesOcupadas, 0],
    ];
    const diferencias = campos.filter(([, unidad, a, e, tol]) => fueraDeTolerancia(a, e, tol, unidad === 'noches' ? 0 : pct))
      .map(([campo, unidad, a, e]) => ({ campo, unidad, app: Math.round(a), excel: e }));
    deptos.push({ codigo, estado: diferencias.length ? 'distinto' : 'igual', diferencias });
  }
  for (const codigo of app.keys()) deptos.push({ codigo, estado: 'solo_app', diferencias: [] });
  return { mes, tolerancia: pct, deptos: deptos.sort((a, b) => a.codigo.localeCompare(b.codigo)) };
}
