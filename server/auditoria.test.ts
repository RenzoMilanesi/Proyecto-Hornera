// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import type { AddressInfo } from 'node:net';
import * as XLSX from 'xlsx';
import { crearApp } from './app.ts';
import { abrirDb } from './db.ts';
import { auditar, listarAuditoria, nombrarPc, pcActual } from './auditoria.ts';
import { crearMovimiento, editarMovimiento, anularMovimiento } from './movimientos.ts';

const hoy = () => new Date().toLocaleDateString('sv').slice(0, 7);

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd) VALUES
      ('2026-05', '2026-05-01', '2026-06-01', '2026-05-28', '2026-06-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0);
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1);
    INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Prueba', 'ARS');`);
  return db;
}
const gasto = { mes: '2026-05', fecha: '2026-05-04', depto: 'AAA', tipo: 'gasto' as const, concepto: 'Expensas', detalle: 'Expensas mayo',
  importe_ars: -1000000, importe_usd: 0, cuenta_id: 1 };

test('la auditoría muestra quién y solo lo que cambió, legible', () => {
  const db = base();
  const id = crearMovimiento(db, gasto);
  pcActual.run('PC Dos', () => editarMovimiento(db, id, { ...gasto, importe_ars: -1200000 }));
  anularMovimiento(db, id);
  const [anulacion, edicion, alta] = listarAuditoria(db, hoy());
  assert.deepEqual([alta.pc, edicion.pc], [hostname(), 'PC Dos']);
  assert.equal(edicion.referencia, 'AAA · Expensas');
  assert.equal(edicion.cambios, 'Importe $: $ -10.000,00 → $ -12.000,00');
  assert.match(alta.cambios, /Depto: AAA · Tipo: gasto · Concepto: Expensas/);
  assert.equal(anulacion.cambios, 'Anulado');
  assert.deepEqual(listarAuditoria(db, '2020-01'), []);
});

test('ponerle nombre a esta PC renombra lo que ya estaba con el nombre anterior', () => {
  const db = base();
  crearMovimiento(db, gasto);
  pcActual.run('PC Dos', () => crearMovimiento(db, gasto));
  nombrarPc(db, ' Lautaro ');
  assert.deepEqual(listarAuditoria(db, hoy()).map((f) => f.pc), ['PC Dos', 'Lautaro']);
  nombrarPc(db, 'Lauti');
  crearMovimiento(db, gasto);
  assert.deepEqual(listarAuditoria(db, hoy()).map((f) => f.pc), ['Lauti', 'PC Dos', 'Lauti']);
  assert.throws(() => nombrarPc(db, '  '), /Escribí el nombre/);
});

test('importar los gastos varios deja un renglón con el resumen', async () => {
  const db = base();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fecha', 'Hora', 'Remitente', 'Departamento', 'Descripción', 'Monto', 'Mensaje original', 'Otro'],
    [(Date.parse('2026-05-04') - Date.UTC(1899, 11, 30)) / 86_400_000, '10:00', 'Uno', 'AAA', 'pilas', 8500, 'X1', '']]));
  const server = crearApp(db, '0.0.0').listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/importar/gastos`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
    });
    assert.equal(r.status, 200);
  } finally {
    server.close();
  }
  const importacion = listarAuditoria(db, hoy()).find((f) => f.accion === 'Importación');
  assert.equal(importacion?.tipo, 'Gastos varios');
  assert.equal(importacion?.cambios, 'Importados: 1');  // los ceros no se muestran
});

test('altas e importaciones: sin ceros, vacíos ni el mes, y con el nombre del propietario', () => {
  const db = base();
  auditar(db, 'depto', 1, 'alta', null, { codigo: 'AAA', propietario_id: 1, desde: 'Stays' });
  auditar(db, 'stays', null, 'importacion', null,
    { mes: '2026-05', periodoCreado: false, reservas: 83, pagos: 221, eliminadas: 0, deptosNuevos: [], avisos: 8 });
  const [stays, depto] = listarAuditoria(db, hoy());
  assert.equal(depto.cambios, 'Código: AAA · Propietario: Propietario Uno · Desde: Stays');
  assert.equal(stays.cambios, 'Reservas: 83 · Pagos: 221 · Avisos: 8');
});

test('limpieza: con su período, precio en pesos y el plus leído del JSON', () => {
  const db = base();
  db.exec(`INSERT INTO liquidacion_limpieza(desde, hasta, precio_hora, plus_json, creado_en) VALUES ('2026-05-01', '2026-05-15', 450000, '{}', 'x')`);
  auditar(db, 'liquidacion_limpieza', 1, 'alta', null, { desde: '2026-05-01', precio_hora: 450000, plus_json: '{"Check-Out":{"modo":"horas","valor":30}}' });
  const [f] = listarAuditoria(db, hoy());
  assert.deepEqual([f.tipo, f.referencia, f.cambios],
    ['Limpieza', '01/05–15/05/2026', 'Desde: 2026-05-01 · Precio por hora: $ 4.500,00 · Plus: Check-Out: Modo: horas, Valor: 30']);
});

test('saldado por fuera: con su depto y mes, y sin repetir el contexto', () => {
  const db = base();
  db.exec(`INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_ocupadas, cant_reservas, ingresos_ars,
    ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars, saldo_anterior_usd, movimientos_ars,
    movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
    VALUES (1, 1, 1000, 0.2, 31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5000, 0, '2026-05-31')`);
  auditar(db, 'liquidacion', 1, 'modificacion', { saldado_fuera: null, pendiente: 5000 },
    { saldado_fuera: '2026-05-31', nota: 'pagado en efectivo', depto: 'AAA', mes: '2026-05', moneda: 'ARS' });
  const [f] = listarAuditoria(db, hoy());
  assert.deepEqual([f.tipo, f.referencia, f.cambios], ['Saldado por fuera', 'AAA · 2026-05', 'Saldado el: — → 2026-05-31 · Nota: — → pagado en efectivo']);
});
