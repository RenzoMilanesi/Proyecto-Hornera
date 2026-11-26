// Correr: npm test. Renglones y nombres ficticios: los PDF reales no van al repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb } from './db.ts';
import { crearMovimiento } from './movimientos.ts';
import { crearGastoAjeno } from './gastosAjenos.ts';
import { importarGastos } from './importador/gastos.ts';
import * as XLSX from 'xlsx';
import { cargar, cruzar, desvincular, guardarResumen, ignorar, interpretarResumen, verResumen, vincular, type Pedazo } from './tarjeta.ts';

// Un renglón como lo da pdfjs: [x, texto]; los importes en la columna de pesos (~455) o de dólares (~555).
const r = (...p: [number, string][]): Pedazo[] => p.map(([x, texto]) => ({ x, ancho: texto.length * 4.5, texto }));
const encabezado = (tarjeta: string) => [
  r([76, 'Resumen N° VI0001']), r([75, 'Tarjeta Crédito'], [157, tarjeta]),
  r([227, '24-Sep-26'], [284, '05-Oct-26'], [340, '22-Oct-26'], [397, '02-Nov-26'], [453, '19-Nov-26'], [510, '01-Dic-26']),
];

const VISA = [
  ...encabezado('VISA'),
  r([23, '14-10-26'], [86, 'SU PAGO EN PESOS'], [442, '-100.000,00']),        // consolidado: no es consumo
  r([23, 'DETALLE DEL CONSUMO']),
  r([23, '17-05-26'], [74, '*'], [86, 'FERRETERIA EJEMPLO'], [325, '05/06'], [365, '399415'], [456, '37.470,00']),
  r([23, '25-09-26'], [74, 'K'], [86, 'PAYU*AR*UBER'], [364, '006020'], [462, '2.781,00']),
  r([23, '25-09-26'], [86, 'GAMMA.APP'], [153, 'in1XUSD'], [227, '12,00'], [364, '783842'], [559, '12,00']),
  r([120, 'TARJETA 0001 Total Consumos de ANA EJEMPLO'], [452, '40.251,00'], [555, '12,00']),
  r([23, '07-10-26'], [74, '*'], [86, 'KIOSCO DEMO'], [365, '001404'], [457, '9.000,00']),
  r([120, 'TARJETA 0002 Total Consumos de LUIS ADICIONAL'], [452, '9.000,00'], [555, '0,00']),
  r([23, '22-10-26'], [86, 'IMPUESTO DE SELLOS $'], [457, '3.107,37']),
  r([38, 'TOTAL A PAGAR'], [449, '52.358,37'], [556, '12,00']),
];

test('lector: consumos, cuotas, dólares, titulares e impuestos; el consolidado no entra y el total cierra', () => {
  const l = interpretarResumen(VISA);
  assert.deepEqual([l.tarjeta, l.numero, l.cierre, l.aviso], ['VISA', 'VI0001', '2026-10-22', null]);
  assert.deepEqual(l.consumos.map((c) => [c.fecha, c.detalle, c.cuota, c.comprobante, c.titular, c.importe_ars, c.importe_usd]), [
    ['2026-05-17', 'FERRETERIA EJEMPLO', '05/06', '399415', 'ANA EJEMPLO', 3747000, 0],
    ['2026-09-25', 'PAYU*AR*UBER', null, '006020', 'ANA EJEMPLO', 278100, 0],
    ['2026-09-25', 'GAMMA.APP in1XUSD 12,00', null, '783842', 'ANA EJEMPLO', 0, 1200],
    ['2026-10-07', 'KIOSCO DEMO', null, '001404', 'LUIS ADICIONAL', 900000, 0],
    ['2026-10-22', 'IMPUESTO DE SELLOS $', null, null, null, 310737, 0],
  ]);
});

test('lector Mastercard: cargos del consolidado con la fecha del cierre y los adicionales después del SUBTOTAL', () => {
  const l = interpretarResumen([
    ...encabezado('MASTERCARD INTERNACIONAL'),
    r([23, '14-Oct-26'], [80, 'SU PAGO'], [335, '-1.000,00'], [443, '-1.000,00']),
    r([23, 'SUBTOTAL'], [451, '5.000,00']),
    r([80, 'INTERESES COMPENSATORIOS'], [458, '350,19']),
    r([80, 'IMPUESTO DE SELLOS'], [470, '6,29'], [562, '0,07']),
    r([38, 'TOTAL A PAGAR'], [449, '5.356,48'], [556, '1,07']),
    r([23, 'DETALLE DEL CONSUMO']),
    r([23, '08-Oct-26'], [80, 'CANVA'], [362, '04348'], [458, '5.000,00']),
    r([23, 'SUBTOTAL'], [451, '5.000,00']),
    r([23, '10-Oct-26'], [80, 'Microsoft-X(USA,USD,'], [205, '1,00)'], [362, '00606'], [558, '1,00']),
    r([23, 'TOTAL ADICIONAL DE PEREZ,JUAN'], [476, '0,00'], [557, '1,00']),
    r([40, 'TOTAL A PAGAR'], [449, '5.356,48'], [556, '1,07']),
  ]);
  assert.equal(l.tarjeta, 'MASTERCARD');
  assert.equal(l.aviso, null);
  assert.deepEqual(l.consumos.map((c) => [c.fecha, c.detalle, c.titular, c.importe_ars, c.importe_usd]), [
    ['2026-10-22', 'INTERESES COMPENSATORIOS', null, 35019, 0],
    ['2026-10-22', 'IMPUESTO DE SELLOS', null, 629, 7],
    ['2026-10-08', 'CANVA', null, 500000, 0],
    ['2026-10-10', 'Microsoft-X(USA,USD, 1,00)', 'PEREZ,JUAN', 0, 100],
  ]);
});

test('lector: si no suma el total avisa; un PDF que no es un resumen de Galicia se rechaza', () => {
  const l = interpretarResumen(VISA.map((f) => (f[0].texto === 'TOTAL A PAGAR' ? r([38, 'TOTAL A PAGAR'], [449, '99.999,00'], [556, '12,00']) : f)));
  assert.match(l.aviso ?? '', /total a pagar es \$ 99999/);
  assert.throws(() => interpretarResumen([r([10, 'Factura de luz'])]), /No es un resumen/);
  assert.throws(() => interpretarResumen(encabezado('VISA')), /no tiene consumos/);
});

function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-09', '2026-09-01', '2026-10-01', '2026-09-28', '2026-10-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'cerrado'),
      ('2026-10', '2026-10-01', '2026-11-01', '2026-10-28', '2026-11-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'abierto');
    INSERT INTO propietario(nombre) VALUES ('Dueña Ficticia');
    INSERT INTO depto(codigo, nombre, propietario_id, comision_pct) VALUES ('OVL', 'Depto demo', 1, 0.2);`);
  return db;
}
const gasto = (db: ReturnType<typeof base>, importe: number, depto: string | null = 'OVL', fecha = '2026-10-01') =>
  crearMovimiento(db, { mes: '2026-10', fecha, depto, tipo: 'gasto', concepto: 'Mantenimiento', detalle: null, importe_ars: -importe, importe_usd: 0, cuenta_id: null });
const estados = (db: ReturnType<typeof base>, id: number) => (verResumen(db, id).consumos as any[]).map((c) => c.estado);

test('cruce: cada consumo en pesos va solo al gasto del mismo importe (±$1) que no tiene consumo; reimportar no duplica', () => {
  const db = base();
  const ferreteria = gasto(db, 3747000);
  gasto(db, 900050);                                   // el Excel redondeó: igual vincula
  gasto(db, 278100, null, '2026-02-01');               // lejos de la fecha y del cierre: no
  const rep = guardarResumen(db, interpretarResumen(VISA));
  assert.equal(rep.vinculados, 2);
  assert.deepEqual(estados(db, rep.resumen_id), ['gasto', 'pendiente', 'pendiente', 'gasto', 'pendiente']);
  assert.equal((verResumen(db, rep.resumen_id).consumos as any[])[0].movimiento_id, ferreteria);
  assert.equal(guardarResumen(db, interpretarResumen(VISA)).yaEstaba, true);
  assert.equal((db.prepare('SELECT count(*) n FROM consumo_tarjeta').get() as { n: number }).n, 5);
});

test('varios consumos a un gasto sumado del Excel; personal, ignorar y desvincular; un gasto anulado deja el consumo pendiente', () => {
  const db = base();
  const { resumen_id: id } = guardarResumen(db, interpretarResumen(VISA));
  const ids = (verResumen(db, id).consumos as any[]).map((c) => c.id as number);
  const sumado = gasto(db, 5000000, null);              // "Uber" del Excel: varios viajes
  vincular(db, [ids[1], ids[2]], { movimiento_id: sumado });
  const personal = crearGastoAjeno(db, { fecha: '2026-10-07', codigo: 'LAU', descripcion: 'kiosco', importe: 900000 });
  vincular(db, [ids[3]], { gasto_ajeno_id: personal });
  ignorar(db, [ids[4]], 'intereses: van en Gastos de tarjetas');
  assert.deepEqual(estados(db, id), ['pendiente', 'gasto', 'gasto', 'personal', 'ignorado']);
  assert.throws(() => ignorar(db, [ids[0]], ' '), /por qué/);
  assert.throws(() => vincular(db, [], { movimiento_id: sumado }), /al menos un consumo/);
  desvincular(db, [ids[4]]);
  db.prepare(`UPDATE movimiento SET estado = 'anulado' WHERE id = ?`).run(sumado);
  assert.deepEqual(estados(db, id), ['pendiente', 'pendiente', 'pendiente', 'personal', 'pendiente']);
  assert.equal((db.prepare(`SELECT count(*) n FROM auditoria WHERE tabla = 'tarjeta'`).get() as { n: number }).n, 5);
});

test('cargar: crea el gasto o el personal ya vinculado, en el mes abierto; con dólares pide el importe en pesos', () => {
  const db = base();
  const { resumen_id: id } = guardarResumen(db, interpretarResumen(VISA));
  const ids = (verResumen(db, id).consumos as any[]).map((c) => c.id as number);
  const mov = cargar(db, { consumos: [ids[0], ids[1]], codigo: 'OVL', concepto: 'Mantenimiento' });
  const m = db.prepare('SELECT mes, fecha, importe_ars, detalle FROM movimiento m JOIN periodo p ON p.id = m.periodo_id WHERE m.id = ?').get(mov) as any;
  // El último consumo es de septiembre (cerrado): va al primer mes abierto.
  assert.deepEqual({ ...m }, { mes: '2026-10', fecha: '2026-10-01', importe_ars: -(3747000 + 278100), detalle: 'Tarjeta: FERRETERIA EJEMPLO, PAYU*AR*UBER' });
  assert.throws(() => cargar(db, { consumos: [ids[2]], codigo: 'INT' }), /dólares/);
  cargar(db, { consumos: [ids[2]], codigo: 'INT', concepto: 'Suscripción', importe: 1821960 });
  cargar(db, { consumos: [ids[3]], codigo: 'CAY' });
  assert.deepEqual(estados(db, id), ['gasto', 'gasto', 'gasto', 'personal', 'pendiente']);
  assert.throws(() => cargar(db, { consumos: [ids[4]], codigo: 'XXX' }), /No existe el depto/);
});

test('importar el Excel después del resumen: "Cruzar de nuevo" vincula lo que entró y avisa lo ya cargado desde la tarjeta', () => {
  const db = base();
  const { resumen_id: id } = guardarResumen(db, interpretarResumen(VISA));
  const ids = (verResumen(db, id).consumos as any[]).map((c) => c.id as number);
  cargar(db, { consumos: [ids[4]], codigo: 'INT' });   // sellos: $3.107,37 cargado desde la tarjeta
  const hoja = XLSX.utils.json_to_sheet([
    { Fecha: 46302, Departamento: 'OVL', Descripción: 'Kiosco', Monto: 9000, Otro: '', 'Mensaje original': 'G1' },
    { Fecha: 46302, Departamento: 'INT', Descripción: 'Sellos tarjeta', Monto: 3107.37, Otro: '', 'Mensaje original': 'G2' },
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja, 'Gastos');
  const rep = importarGastos(db, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(rep.importados, 2);
  assert.equal(rep.avisos.length, 1);
  assert.match(rep.avisos[0], /^Fila 3: "Sellos tarjeta" tiene el mismo importe que un gasto cargado desde la tarjeta/);
  assert.equal(cruzar(db, id), 1);
  assert.deepEqual(estados(db, id), ['pendiente', 'pendiente', 'pendiente', 'gasto', 'gasto']);
});
