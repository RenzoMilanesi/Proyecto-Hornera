// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { abrirDb } from '../db.ts';
import { importarHoras } from './limpieza.ts';
import { crearLiquidacion, pagarLiquidacion } from '../limpieza.ts';

const serial = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000 + 25569;
const hora = (h: number) => h / 24; // como guarda el Form la duración: una hora del día

function excel(filas: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Otra cosa']]), 'Liquidaciones');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Marca temporal', 'Fecha', 'Column 33', 'Depto', 'Operaria', 'Horas', 'Extras', 'Horas Totales'], ...filas]), 'Horas Cargadas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'abierto');
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('OVL', 'Depto Uno', 1), ('COT', 'Depto Dos', 1);`);
  return db;
}
const tareas = (db: ReturnType<typeof base>) =>
  db.prepare(`SELECT t.fecha, coalesce(d.codigo, 'INT') depto, t.operaria, t.tipo, t.minutos FROM tarea_limpieza t
    LEFT JOIN depto d ON d.id = t.depto_id ORDER BY t.fecha, t.id`).all().map((t) => ({ ...t }));

test('importar: tipo vacío = Limpieza, alias de deptos, INT = empresa, corte, duplicados y filas inválidas', () => {
  const db = base();
  const r = importarHoras(db, excel([
    ['', serial('2026-09-01'), '', 'OVL', 'ana', hora(2), 'Limpieza'],            // antes del corte
    ['', serial('2026-09-10'), '', 'OVL ', 'ana', hora(2.5), ''],                 // vacío = Limpieza
    ['', serial('2026-09-10'), '', 'COTI', 'BEA', '', 'Check-Out'],               // alias, sin horas
    ['', serial('2026-09-11'), '', 'INT', 'CAMI', hora(15), ''],
    ['', serial('2026-09-11'), '', 'INT', 'CAMI', hora(15), ''],                  // duplicada
    ['', '29/9/25', '', 'OVL', 'ANA', hora(2), 'Limpieza'],                       // fecha en texto, vieja: sin aviso
    ['', '31/07/0225', '', 'OVL', '', hora(2), 'Limpieza'],                       // año mal tipeado y sin operaria, viejo: sin aviso
    ['', '14/9/26', '', 'OVL', 'ANA', hora(1), 'Limpieza'],                       // fecha en texto, nueva: entra
    ['', 'ayer', '', 'OVL', 'ANA', hora(2), 'Limpieza'],                          // no se entiende: aviso
    ['', serial('2026-09-12'), '', 'XYZ', 'ANA', hora(2), 'Limpieza'],            // depto que no existe
    ['', serial('2026-09-12'), '', 'OVL', '', hora(2), 'Limpieza'],               // sin operaria
    ['', serial('2026-09-13'), '', 'OVL', 'BEA', 1 + hora(1.5), 'Cambio Blanqueria'], // días delante: no cuentan
  ]));
  assert.deepEqual(tareas(db), [
    { fecha: '2026-09-10', depto: 'OVL', operaria: 'ANA', tipo: 'Limpieza', minutos: 150 },
    { fecha: '2026-09-10', depto: 'COT', operaria: 'BEA', tipo: 'Check-Out', minutos: 0 },
    { fecha: '2026-09-11', depto: 'INT', operaria: 'CAMI', tipo: 'Limpieza', minutos: 900 },
    { fecha: '2026-09-13', depto: 'OVL', operaria: 'BEA', tipo: 'Cambio Blanqueria', minutos: 90 },
    { fecha: '2026-09-14', depto: 'OVL', operaria: 'ANA', tipo: 'Limpieza', minutos: 60 },
  ]);
  assert.deepEqual([r.importadas, r.duplicadas, r.anteriores], [5, 1, 3]);
  assert.equal(r.avisos.length, 4);
  assert.match(r.avisos.join('\n'), /Fila 6: repetida/);
  assert.match(r.avisos.join('\n'), /Fila 10: fecha inválida \(ayer\)/);
  assert.match(r.avisos.join('\n'), /"XYZ" no existe/);
});

test('reimportar reemplaza lo pendiente y no toca un período pagado (avisa si el Excel cambió)', () => {
  const db = base();
  importarHoras(db, excel([
    ['', serial('2026-09-15'), '', 'OVL', 'ANA', hora(2), ''],
    ['', serial('2026-10-02'), '', 'OVL', 'ANA', hora(2), ''],
  ]));
  pagarLiquidacion(db, crearLiquidacion(db, { desde: '2026-09-10', hasta: '2026-09-30', precio_hora: 600000 }), { fecha: '2026-10-01', cuenta_id: null });
  const r = importarHoras(db, excel([
    ['', serial('2026-09-15'), '', 'OVL', 'ANA', hora(3), ''], // cambió algo ya pagado
    ['', serial('2026-10-03'), '', 'COT', 'BEA', hora(1), ''],
  ]));
  assert.deepEqual(tareas(db).map((t) => [t.fecha, t.minutos]), [['2026-09-15', 120], ['2026-10-03', 60]]);
  assert.equal(r.pagadas, 1);
  assert.match(r.avisos.join('\n'), /10\/09–30\/09 ya está pagado y el Excel cambió/);
});

test('un Excel que no es el de horas se rechaza', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fecha', 'Monto']]), 'Hoja 1');
  assert.throws(() => importarHoras(base(), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), /Horas Cargadas/);
});
