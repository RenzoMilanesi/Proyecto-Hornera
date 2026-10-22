// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from './db.ts';
import { anularGastoAjeno, crearGastoAjeno, editarGastoAjeno, listarGastosAjenos } from './gastosAjenos.ts';

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-09', '2026-09-01', '2026-10-01', '2026-09-28', '2026-10-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'cerrado'),
      ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'abierto');`);
  return db;
}
const gasto = (codigo: string, importe: number, fecha = '2026-10-05') => ({ fecha, codigo, descripcion: 'algo', importe });

test('totales: los compartidos se parten mitad y mitad (el centavo impar a Amancay) y un anulado no suma', () => {
  const db = base();
  crearGastoAjeno(db, gasto('CAY', 1000));
  crearGastoAjeno(db, gasto('LAU', 500));
  crearGastoAjeno(db, gasto('CAY/LAU', 301));
  crearGastoAjeno(db, gasto('CASEST', 700));
  anularGastoAjeno(db, crearGastoAjeno(db, gasto('CASA', 9999)));
  const { gastos, totales } = listarGastosAjenos(db, '2026-10');
  assert.equal(gastos.length, 5);
  assert.deepEqual(totales, { porCodigo: { CAY: 1000, LAU: 500, 'CAY/LAU': 301, CASEST: 700, CASA: 0 }, amancay: 1151, lautaro: 650 });
});

test('editar en el mes abierto queda auditado; mes cerrado, código o importe inválido se rechazan', () => {
  const db = base();
  const id = crearGastoAjeno(db, gasto('CAY', 1000));
  editarGastoAjeno(db, id, gasto('LAU', 1200));
  assert.deepEqual({ ...db.prepare('SELECT codigo, importe FROM gasto_ajeno WHERE id = ?').get(id) }, { codigo: 'LAU', importe: 1200 });
  assert.equal((db.prepare(`SELECT count(*) n FROM auditoria WHERE tabla = 'gasto_ajeno'`).get() as { n: number }).n, 2);
  assert.throws(() => editarGastoAjeno(db, id, gasto('LAU', 1200, '2026-09-05')), /cerrado/);
  assert.throws(() => crearGastoAjeno(db, gasto('BBVA', 100)), /Código inválido/);
  assert.throws(() => crearGastoAjeno(db, gasto('CAY', 0)), /importe/);
  db.exec(`UPDATE periodo SET estado = 'cerrado' WHERE mes = '2026-10'`);
  assert.throws(() => anularGastoAjeno(db, id), /cerrado/);
});
