// Importa las horas de limpieza del Google Form (hoja "Horas Cargadas" del Excel "HORAS LIMPIEZA", plan 057).
// Columnas por encabezado: Fecha, Depto, Operaria, Horas (duración como hora del día), Extras (tipo de tarea).
// El Form no tiene un id estable por fila: cada importación reemplaza las tareas que no están en un período pagado.
import * as XLSX from 'xlsx';
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from '../auditoria.ts';

// ponytail: corte fijo; lo anterior se pagó por fuera de la app (el último período ya está cargado a mano como movimiento).
export const LIMPIEZA_DESDE = '2026-09-10';
const ALIAS: Record<string, string> = { COTI: 'COT', MAIPU: 'MAPU' };
// Nombre de cada tipo como lo usa la app; vacío = Limpieza (desde mayo-2026 el Form deja vacía esa opción).
const TIPOS: Record<string, string> = {
  '': 'Limpieza', limpieza: 'Limpieza', 'check-in': 'Check-In', 'check-out': 'Check-Out', 'cambio blanqueria': 'Cambio Blanqueria', oficina: 'Oficina',
};

export interface ReporteHoras { importadas: number; duplicadas: number; anteriores: number; pagadas: number; avisos: string[] }

const DIA = 86_400_000;
const fechaSerial = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DIA).toISOString().slice(0, 10);
const clave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const texto = (v: unknown) => (v == null ? '' : String(v).trim());
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

// Fecha escrita a mano como texto ("29/9/25", "31/07/0225"): día/mes/año, año de 2 dígitos = 20xx. Lo que no se
// entiende da null (aviso); lo que se entiende y es anterior al corte se descarta sin avisar, como el resto.
function fechaTexto(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])];
  const iso = `${String(a).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return mes >= 1 && mes <= 12 && d >= 1 && new Date(`${iso}T00:00:00Z`).getUTCDate() === d ? iso : null;
}

// "Horas" viene como hora del día (fracción de día; a veces con días delante que no cuentan) o como texto "2:30".
function minutos(v: unknown): number | null {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return Math.round((v % 1) * 1440);
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function importarHoras(db: DatabaseSync, archivo: Buffer): ReporteHoras {
  const wb = XLSX.read(archivo);
  const hoja = wb.Sheets['Horas Cargadas'];
  if (!hoja) throw new Error('No es el Excel de horas de limpieza: falta la hoja "Horas Cargadas".');
  const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: '' })
    .map((f) => ({ ...Object.fromEntries(Object.entries(f).map(([k, v]) => [clave(k), v])), renglon: (f as { __rowNum__: number }).__rowNum__ + 1 })) as
    (Record<string, unknown> & { renglon: number })[];
  if (!filas.length || !['fecha', 'depto', 'operaria', 'horas', 'extras'].every((c) => c in filas[0])) {
    throw new Error('La hoja "Horas Cargadas" tiene que tener Fecha, Depto, Operaria, Horas y Extras.');
  }

  const deptos = new Map((db.prepare('SELECT id, codigo FROM depto').all() as { id: number; codigo: string }[]).map((d) => [d.codigo, d.id]));
  const pagadas = db.prepare('SELECT desde, hasta FROM liquidacion_limpieza WHERE movimiento_id IS NOT NULL ORDER BY desde').all() as { desde: string; hasta: string }[];
  const enPagada = (f: string) => pagadas.find((p) => f >= p.desde && f <= p.hasta);
  const r: ReporteHoras = { importadas: 0, duplicadas: 0, anteriores: 0, pagadas: 0, avisos: [] };

  const nuevas: { fecha: string; depto_id: number | null; operaria: string; tipo: string; minutos: number; fila: number }[] = [];
  const vistas = new Set<string>();
  const enPeriodoPagado = new Map<string, { tareas: number; minutos: number }>(); // lo del Excel que cae en uno pagado
  for (const f of filas) {
    const fila = f.renglon;
    const operaria = texto(f.operaria).toUpperCase();
    const crudo = texto(f.depto).toUpperCase().replace(/\s+/g, '');
    if (f.fecha === '' && !operaria && !crudo) continue; // renglón vacío
    const fecha = typeof f.fecha === 'number' ? fechaSerial(f.fecha) : fechaTexto(texto(f.fecha));
    if (!fecha) { r.avisos.push(`Fila ${fila}: fecha inválida (${texto(f.fecha) || 'vacía'}), no se importa.`); continue; }
    if (fecha < LIMPIEZA_DESDE) { r.anteriores++; continue; }
    if (!operaria) { r.avisos.push(`Fila ${fila}: sin operaria, no se importa.`); continue; }
    const codigo = ALIAS[crudo] ?? crudo;
    const deptoId = codigo === 'INT' ? null : deptos.get(codigo);
    if (deptoId === undefined) { r.avisos.push(`Fila ${fila}: el depto "${crudo || 'vacío'}" no existe, no se importa.`); continue; }
    const tipoCrudo = texto(f.extras);
    const tipo = TIPOS[clave(tipoCrudo)] ?? tipoCrudo; // un tipo nuevo entra tal cual, sin plus hasta que se le ponga
    const min = minutos(f.horas);
    if (min === null) { r.avisos.push(`Fila ${fila}: horas inválidas (${texto(f.horas)}), no se importa.`); continue; }

    const k = [fecha, codigo, operaria, tipo, min].join('|');
    if (vistas.has(k)) { r.duplicadas++; r.avisos.push(`Fila ${fila}: repetida (${ddmm(fecha)} ${codigo} ${operaria} ${tipo}), se cuenta una sola vez.`); continue; }
    vistas.add(k);
    const pagada = enPagada(fecha);
    if (pagada) {
      const pk = `${pagada.desde}|${pagada.hasta}`;
      const x = enPeriodoPagado.get(pk) ?? { tareas: 0, minutos: 0 };
      x.tareas++;
      x.minutos += min;
      enPeriodoPagado.set(pk, x);
      r.pagadas++;
      continue;
    }
    nuevas.push({ fecha, depto_id: deptoId, operaria, tipo, minutos: min, fila });
  }

  // Lo pagado no se toca; si el Excel cambió en ese período, se avisa.
  for (const p of pagadas) {
    const hoy = db.prepare('SELECT count(*) tareas, coalesce(sum(minutos), 0) minutos FROM tarea_limpieza WHERE fecha BETWEEN ? AND ?')
      .get(p.desde, p.hasta) as { tareas: number; minutos: number };
    const excel = enPeriodoPagado.get(`${p.desde}|${p.hasta}`) ?? { tareas: 0, minutos: 0 };
    if (excel.tareas !== hoy.tareas || excel.minutos !== hoy.minutos) {
      r.avisos.push(`El período ${ddmm(p.desde)}–${ddmm(p.hasta)} ya está pagado y el Excel cambió (${excel.tareas} tareas y ${excel.minutos / 60} h en el Excel, ${hoy.tareas} y ${hoy.minutos / 60} h en la app): no se toca.`);
    }
  }

  db.exec('BEGIN');
  try {
    const borrar = db.prepare('DELETE FROM tarea_limpieza WHERE fecha >= ? AND NOT EXISTS (SELECT 1 FROM liquidacion_limpieza l WHERE l.movimiento_id IS NOT NULL AND tarea_limpieza.fecha BETWEEN l.desde AND l.hasta)');
    borrar.run(LIMPIEZA_DESDE);
    const insertar = db.prepare('INSERT INTO tarea_limpieza(fecha, depto_id, operaria, tipo, minutos, fila_excel) VALUES (?, ?, ?, ?, ?, ?)');
    for (const t of nuevas) insertar.run(t.fecha, t.depto_id, t.operaria, t.tipo, t.minutos, t.fila);
    r.importadas = nuevas.length;
    auditar(db, 'tarea_limpieza', null, 'importacion', null, { importadas: r.importadas, duplicadas: r.duplicadas, pagadas: r.pagadas, avisos: r.avisos.length });
    db.exec('COMMIT');
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
  return r;
}
