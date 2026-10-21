// Importa el Excel de gastos varios ("Comprobantes Hornera": Fecha, Departamento, Descripción, Monto,
// Otro…) como movimientos del mes abierto. Reglas en plans/037-importar-gastos-varios.md.
import * as XLSX from 'xlsx';
import type { DatabaseSync } from 'node:sqlite';
import { crearMovimiento } from '../movimientos.ts';

export interface ReporteGastos {
  importados: number;
  repetidos: number;                    // ya estaban (reimportación)
  anteriores: number;                   // de meses anteriores al abierto: ya descontados por fuera
  casa: number;                         // CASA: no se importa
  codigosDesconocidos: Record<string, number>; // entraron como gasto de la empresa
  avisos: string[];
}

const DIA = 86_400_000;
const fechaSerial = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DIA).toISOString().slice(0, 10);
const clave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function importarGastos(db: DatabaseSync, archivo: Buffer): ReporteGastos {
  const wb = XLSX.read(archivo);
  const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    // __rowNum__ (no enumerable) es el renglón real: sheet_to_json saltea los vacíos y el índice no sirve para los avisos.
    .map((f): Record<string, unknown> & { renglon: number } =>
      ({ ...Object.fromEntries(Object.entries(f).map(([k, v]) => [clave(k), v])), renglon: (f as { __rowNum__: number }).__rowNum__ + 1 }));
  if (!filas.length || !['fecha', 'departamento', 'descripcion', 'monto'].every((c) => c in filas[0])) {
    throw new Error('No es el Excel de gastos: la primera hoja tiene que tener Fecha, Departamento, Descripción y Monto.');
  }

  const abiertos = new Set((db.prepare(`SELECT mes FROM periodo WHERE estado = 'abierto'`).all() as { mes: string }[]).map((p) => p.mes));
  if (!abiertos.size) throw new Error('No hay un mes abierto para cargar los gastos.');
  const primero = [...abiertos].sort()[0];
  const deptos = new Set((db.prepare('SELECT codigo FROM depto').all() as { codigo: string }[]).map((d) => d.codigo));
  const yaEsta = db.prepare('SELECT 1 FROM movimiento WHERE origen = ?'); // vigente o anulado: un anulado no vuelve

  const r: ReporteGastos = { importados: 0, repetidos: 0, anteriores: 0, casa: 0, codigosDesconocidos: {}, avisos: [] };
  const vistas = new Map<string, number>(); // filas de un mismo mensaje: cada una con su número de aparición
  const texto = (v: unknown) => (v == null ? '' : String(v).trim());
  filas.forEach((f) => {
    const fila = f.renglon;
    if (typeof f.fecha !== 'number') {
      if (f.fecha !== '' || f.monto !== '') r.avisos.push(`Fila ${fila}: fecha inválida, no se importa.`);
      return;
    }
    const fecha = fechaSerial(f.fecha);
    // Identidad de la fila, no su contenido: corregir el depto o el monto (en la app o en el Excel) no la vuelve a importar.
    // Un mensaje puede traer varios gastos (las expensas de varios deptos): se distinguen por el orden dentro del mensaje.
    const k = ['gastos', texto(f['mensaje original']) || `${fecha} ${texto(f.hora)}`].join(':');
    const vez = (vistas.get(k) ?? 0) + 1;
    vistas.set(k, vez);
    const origen = `${k}:${vez}`;
    const mes = fecha.slice(0, 7); // ponytail: mes calendario; fecha_corte_gastos no se aplica (hoy no la usa nadie)
    const codigo = texto(f.departamento).toUpperCase();
    const descripcion = texto(f.descripcion);
    if (codigo === 'CASA') { r.casa++; return; }
    if (mes < primero) { r.anteriores++; return; }
    if (!abiertos.has(mes)) { r.avisos.push(`Fila ${fila}: ${fecha} no es de un mes abierto, no se importa.`); return; }
    const monto = Math.round(Number(f.monto) * 100);
    if (!monto || monto < 0) { r.avisos.push(`Fila ${fila}: "${descripcion}" sin monto válido, no se importa.`); return; }

    const depto = deptos.has(codigo) ? codigo : null;
    if (!depto && codigo !== 'INT') r.codigosDesconocidos[codigo || '(vacío)'] = (r.codigosDesconocidos[codigo || '(vacío)'] ?? 0) + 1;
    const adelanto = depto !== null && /adelanto|pre.?liquidaci/i.test(clave(descripcion));
    const tipo = adelanto ? 'pre_liquidacion' : 'gasto';
    const otro = texto(f.otro);
    // "Otro" a veces trae el medio de pago (VISA, GAL CAY…) y a veces un id de mensaje: solo se suma lo corto.
    // Un código desconocido queda en el detalle para reasignarlo cuando se sepa qué es.
    const detalle = [depto || codigo === 'INT' ? '' : `[${codigo || 'sin depto'}]`, descripcion, otro.length <= 12 ? otro : '']
      .filter(Boolean).join(' · ') || null;

    if (yaEsta.get(origen)) { r.repetidos++; return; }
    // ponytail: una transacción por fila (la de crearMovimiento); si algo corta a mitad, reimportar completa sin duplicar.
    crearMovimiento(db, {
      mes, fecha, depto, tipo, concepto: adelanto ? 'Adelanto' : 'Gastos varios', detalle,
      importe_ars: -monto, importe_usd: 0, cuenta_id: null, origen,
    });
    r.importados++;
  });
  return r;
}
