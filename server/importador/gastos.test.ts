// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { abrirDb } from '../db.ts';
import { importarGastos } from './gastos.ts';
import { crearMovimiento, editarMovimiento } from '../movimientos.ts';

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-09', '2026-09-01', '2026-10-01', '2026-09-28', '2026-10-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'cerrado'),
      ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'abierto');
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);`);
  return db;
}

const excel = (filas: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fecha', 'Hora', 'Remitente', 'Departamento', 'Descripción', 'Monto', 'Mensaje original', 'Otro'], ...filas]));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const d = (iso: string) => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000; // serial de Excel

const archivo = excel([
  [d('2026-09-20'), '10:00', 'Uno', 'AAA', 'ferretería', 1000, 'X1', ''],             // mes anterior: ya descontado
  [d('2026-10-02'), '10:00', 'Uno', 'AAA', 'pilas', 8500.5, 'X2', 'VISA'],
  [d('2026-10-02'), '10:01', 'Uno', 'AAA', 'pilas', 8500.5, 'X3', 'VISA'],            // igual a la anterior: entra también
  [d('2026-10-03'), '10:00', 'Uno', 'INT', 'Honorarios', 500000, 'X4', 'A5CBD7AEEA8A4E9A4CA1A7EC74A03EF9'],
  [d('2026-10-03'), '10:00', 'Uno', 'CASA', 'Agua', 3000, 'X5', ''],
  [d('2026-10-04'), '10:00', 'Uno', 'ZZZ', 'súper', 2000, 'X6', ''],
  [d('2026-10-05'), '10:00', 'Uno', 'AAA', 'Pre-liquidación', 100000, 'X7', ''],
  [d('2026-10-05'), '10:00', 'Uno', '', 'Imagen sin descripcion', 0, 'X8', ''],
  [d('2026-11-01'), '10:00', 'Uno', 'AAA', 'luz', 100, 'X9', ''],
  [d('2026-10-06'), '10:00', 'Uno', 'CAY', 'ropa', 1500, 'X10', ''],                // personales y de la Casa del Estudiante: solo se cuentan
  [d('2026-10-06'), '10:00', 'Uno', 'casaest', 'pintura', 700, 'X11', ''],
  [d('2026-10-06'), '10:00', 'Uno', 'LAU / CAY', 'cena', 400, 'X12', ''],
  [d('2026-10-06'), '10:00', 'Uno', 'BBVA', '?', 100, 'X13', ''],                   // error de carga: aviso
]);

test('importa los gastos del mes abierto con depto, empresa y adelantos; reimportar no duplica ni lo anulado ni lo editado', () => {
  const db = base();
  const r = importarGastos(db, archivo);
  assert.deepEqual({ ...r, avisos: r.avisos.length },
    { importados: 5, repetidos: 0, anulados: 0, anteriores: 1, codigosDesconocidos: { ZZZ: 1 }, avisos: 3,
      cuenta: { DEPTOS: 11700100, INT: 50000000, CASA: 300000, ZZZ: 200000, CAY: 150000, CASEST: 70000, 'CAY/LAU': 40000 } });
  const movs = db.prepare(`SELECT d.codigo, m.tipo, c.nombre AS concepto, m.detalle, m.importe_ars, m.cuenta_id FROM movimiento m
    LEFT JOIN depto d ON d.id = m.depto_id JOIN concepto c ON c.id = m.concepto_id ORDER BY m.id`).all().map((m) => ({ ...m }));
  assert.deepEqual(movs, [
    { codigo: 'AAA', tipo: 'gasto', concepto: 'Gastos varios', detalle: 'pilas · VISA', importe_ars: -850050, cuenta_id: null },
    { codigo: 'AAA', tipo: 'gasto', concepto: 'Gastos varios', detalle: 'pilas · VISA', importe_ars: -850050, cuenta_id: null },
    { codigo: null, tipo: 'gasto', concepto: 'Gastos varios', detalle: 'Honorarios', importe_ars: -50000000, cuenta_id: null },
    { codigo: null, tipo: 'gasto', concepto: 'Gastos varios', detalle: '[ZZZ] · súper', importe_ars: -200000, cuenta_id: null },
    { codigo: 'AAA', tipo: 'pre_liquidacion', concepto: 'Adelanto', detalle: 'Pre-liquidación', importe_ars: -10000000, cuenta_id: null },
  ]);

  db.prepare(`UPDATE movimiento SET estado = 'anulado' WHERE detalle = 'Honorarios'`).run(); // anulado a mano: no vuelve
  const zzz = (db.prepare("SELECT id FROM movimiento WHERE detalle LIKE '[ZZZ]%'").get() as { id: number }).id;
  editarMovimiento(db, zzz, { mes: '2026-10', fecha: '2026-10-04', depto: 'AAA', tipo: 'gasto', concepto: 'Supermercado', detalle: 'súper',
    importe_ars: -250000, importe_usd: 0, cuenta_id: null });                                // reasignado a mano: tampoco vuelve
  const otra = importarGastos(db, archivo);
  assert.equal(otra.importados, 0);
  assert.equal(otra.repetidos, 5);
});

test('rechaza un Excel que no es el de gastos', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Otra', 'Cosa'], [1, 2]]));
  assert.throws(() => importarGastos(base(), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), /No es el Excel de gastos/);
});

test('corregir el depto o el monto en el Excel no lo duplica; los avisos dicen el renglón real', () => {
  const db = base();
  importarGastos(db, excel([[d('2026-10-04'), '10:00', 'Uno', 'ZZZ', 'súper', 2000, 'M1', '']]));
  const corregido = excel([[], [d('2026-10-04'), '10:00', 'Uno', 'AAA', 'súper', 2100, 'M1', ''], ['x', '', '', 'AAA', 'luz', 5, 'M2', '']]);
  const r = importarGastos(db, corregido);
  assert.deepEqual([r.importados, r.repetidos], [0, 1]);
  assert.deepEqual(r.avisos, ['Fila 4: fecha inválida, no se importa.']);

});

test('reimportar anula los gastos ajenos que una versión anterior cargó a Hornera, salvo los corregidos a mano', () => {
  const db = base();
  const viejo = (origen: string, detalle: string) => crearMovimiento(db, { mes: '2026-10', fecha: '2026-10-06', depto: null, tipo: 'gasto',
    concepto: 'Gastos varios', detalle, importe_ars: -150000, importe_usd: 0, cuenta_id: null, origen });
  viejo('gastos:V1:1', '[CAY] · ropa');
  viejo('gastos:V2:1', '[BBVA] · ?');
  viejo('gastos:V3:1', 'ropa de Amancay');                                             // ya corregido a mano
  const r = importarGastos(db, excel([
    [d('2026-10-06'), '10:00', 'Uno', 'CAY', 'ropa', 1500, 'V1', ''],
    [d('2026-10-06'), '10:00', 'Uno', 'BBVA', '?', 1500, 'V2', ''],
    [d('2026-10-06'), '10:00', 'Uno', 'CAY', 'ropa', 1500, 'V3', ''],
  ]));
  assert.equal(r.anulados, 2);
  const estados = db.prepare('SELECT origen, estado FROM movimiento ORDER BY id').all().map((m) => ({ ...m }));
  assert.deepEqual(estados, [
    { origen: 'gastos:V1:1', estado: 'anulado' }, { origen: 'gastos:V2:1', estado: 'anulado' }, { origen: 'gastos:V3:1', estado: 'vigente' },
  ]);
  assert.equal(importarGastos(db, excel([[d('2026-10-06'), '10:00', 'Uno', 'CAY', 'ropa', 1500, 'V1', '']])).anulados, 0);
});
