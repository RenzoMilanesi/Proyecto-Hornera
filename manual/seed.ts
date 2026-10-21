// Base de demo con datos FICTICIOS para las capturas del manual. Uso: node seed.ts <carpeta userData>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const P = new URL('../server/', import.meta.url).href;
const { abrirDb } = await import(P + 'db.ts');
const { anularMovimiento, crearMovimiento, transferir } = await import(P + 'movimientos.ts');
const { cerrarPeriodo } = await import(P + 'liquidacion/cierre.ts');
const { listarTransferencias, pagarLiquidacion } = await import(P + 'liquidacion/pagos.ts');

const dir = process.argv[2];
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'rol.json'), JSON.stringify({ rol: 'servidor' }));
const db = abrirDb(join(dir, 'hornera.db'));

db.exec(`
INSERT INTO plataforma(nombre_stays, nombre, codigo, gestiona_pago, comision_pct) VALUES
  ('API airbnb', 'Airbnb', 'A', 1, 0.03), ('API booking', 'Booking', 'B', 0, 0.15), ('Directo', 'Directo', 'D', 0, 0);
INSERT INTO propietario(nombre, cuit, cbu, moneda_liquidacion, fiscal_razon_social, fiscal_doc_tipo, fiscal_doc_nro, fiscal_condicion_iva, fiscal_domicilio) VALUES
  ('Pérez, Ana', '27111111112', '0000003100000000000001', 'ARS', 'Pérez Ana', 80, '27111111112', 'consumidor_final', 'Calle Falsa 123, Rosario'),
  ('Gómez, Luis', '20222222223', '0000003100000000000002', 'ARS', NULL, NULL, NULL, NULL, NULL),
  ('Fernández, Clara', NULL, '0000003100000000000003', 'USD', NULL, NULL, NULL, NULL, NULL),
  ('Ruiz, Marcos', '20333333334', NULL, 'ARS', NULL, NULL, NULL, NULL, NULL);
INSERT INTO depto(codigo, nombre, direccion, tipologia, propietario_id, comision_pct) VALUES
  ('ALM', 'Hornera Almendro', 'Av. Ejemplo 100, 3° A', '1 dormitorio', 1, 0.20),
  ('BOS', 'Hornera Bosque', 'Av. Ejemplo 100, 5° B', 'monoambiente', 1, 0.20),
  ('CED', 'Hornera Cedro', 'Bv. Ficticio 2000, 8° C', '2 dormitorios', 2, 0.18),
  ('DUR', 'Hornera Durazno', 'Pasaje Inventado 45', '1 dormitorio', 3, 0.20),
  ('ESC', 'Hornera Escalada', 'Calle Demo 789, PB', '3 dormitorios', 4, 0.22);
INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Ejemplo', 'ARS'), ('Mercado Pago', 'ARS'), ('Efectivo USD', 'USD');
INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda, descuenta_comision, cuenta_id) VALUES
  ('mp1', 'Mercado Pago Hornera', 'mercadopago', 'ARS', 1, 2),
  ('ab1', 'Airbnb USD', 'user', 'USD', 0, 3),
  ('tr1', 'Transferencia bancaria', 'user', 'ARS', 0, 1),
  ('pp1', 'PayPal', 'paypal', 'USD', 1, NULL);
INSERT INTO emisor(nombre, razon_social, cuit, condicion_iva, punto_venta, domicilio, ambiente) VALUES
  ('Emisor Demo', 'Demo Emisor', '20123456786', 'monotributista', 3, 'Calle Ejemplo 1, Rosario', 'homologacion'),
  ('Emisora Prueba', 'Prueba Emisora', '27123456785', 'monotributista', 2, 'Calle Ejemplo 2, Rosario', 'homologacion');
`);

const periodo = db.prepare(`INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion,
  usd_cotizacion_fuente, costo_hora_limpieza, servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento,
  tarifa_base, adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd) VALUES (?, ?, ?, ?, ?, ?, 'manual', 800000, 1120000, 600000, 200000,
  500000, 400000, 4840000, 900000, 1500000, 3000000, 500)`);
const meses = [['2026-08', '2026-09'], ['2026-09', '2026-10'], ['2026-10', '2026-11']];
for (const [m, sig] of meses) periodo.run(m, `${m}-01`, `${sig}-01`, `${m}-28`, `${sig}-10`, m === '2026-10' ? 1460 : 1400);

const reserva = db.prepare(`INSERT INTO reserva(codigo, depto_id, plataforma_id, llegada, salida, huespedes, moneda, estado_stays, huesped_nombre,
  raw_json, sincronizada_en, hora_llegada, hora_salida) VALUES (?, ?, ?, ?, ?, ?, ?, 'Confirmada', ?, '{}', '2026-10-15 10:00:00', '14:00', '10:00')`);
const pago = db.prepare(`INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, descripcion, importe, comision, fecha_pago, raw_json)
  VALUES (?, ?, ?, 'credit', 'completed', 'Pago', ?, ?, ?, '{}')`);
const huespedes = ['Juan Ejemplo', 'María Prueba', 'Carlos Demo', 'Laura Ficticia', 'Pedro Muestra', 'Sofía Inventada'];
let n = 0;
for (const [m] of meses) {
  for (let depto = 1; depto <= 5; depto++) {
    for (let k = 0; k < 3; k++) {
      n++;
      const dia = 2 + k * 9 + depto;
      const noches = 3 + ((n * 7) % 5);
      const ll = `${m}-${String(dia).padStart(2, '0')}`;
      const sal = new Date(Date.parse(ll) + noches * 864e5).toISOString().slice(0, 10);
      const plat = 1 + (n % 3);
      const usd = plat === 1;
      const codigo = `DM${String(n).padStart(3, '0')}`;
      const id = Number(reserva.run(codigo, depto, plat, ll, sal, 2 + (n % 3), usd ? 'USD' : 'ARS', huespedes[n % 6]).lastInsertRowid);
      const importe = usd ? noches * (4500 + depto * 500) : noches * (65000 + depto * 9000) * 100;
      const medio = usd ? 2 : plat === 2 ? 3 : 1;
      // Una de MP sin comisión cargada: aparece el aviso "falta la comisión".
      pago.run(`p${n}`, id, medio, importe, medio === 1 && n !== 14 ? Math.round(importe * 0.07) : null, ll);
    }
  }
}

const mov = (m: string, fecha: string, depto: string | null, tipo: string, concepto: string, detalle: string, ars: number, usd: number, cuenta: number | null) =>
  crearMovimiento(db, { mes: m, fecha, depto, tipo, concepto, detalle, importe_ars: ars, importe_usd: usd, cuenta_id: cuenta });
for (const [m] of meses) {
  mov(m, `${m}-05`, 'ALM', 'gasto', 'EPE', 'Factura de luz', -3850000, 0, 1);
  mov(m, `${m}-07`, 'CED', 'gasto', 'Expensas', 'Expensas del mes', -9200000, 0, 1);
  mov(m, `${m}-12`, 'ESC', 'gasto', 'Cerrajería', 'Copia de llaves', -1500000, 0, 2);
  mov(m, `${m}-15`, null, 'gasto', 'Viáticos', 'Movilidad del equipo', -2200000, 0, 2);
  mov(m, `${m}-20`, 'BOS', 'gasto', 'Ferretería', 'Lamparitas y pilas', -780000, 0, 2);
}
mov('2026-08', '2026-08-01', null, 'saldo_inicial', 'Saldo inicial', 'Saldo del banco al 01/08', 450000000, 0, 1);
mov('2026-08', '2026-08-01', null, 'saldo_inicial', 'Saldo inicial', 'Saldo de MP al 01/08', 120000000, 0, 2);
mov('2026-08', '2026-08-01', null, 'saldo_inicial', 'Saldo inicial', 'Caja en dólares', 0, 300000, 3);
mov('2026-10', '2026-10-09', 'DUR', 'pre_liquidacion', 'Adelanto', 'Adelanto pedido por la propietaria', 0, -20000, 3);
transferir(db, { mes: '2026-10', fecha: '2026-10-18', desde_cuenta_id: 1, hacia_cuenta_id: 3, importe_desde: 146000000, importe_hacia: 100000, detalle: 'Compra de dólares' });

cerrarPeriodo(db, '2026-08');
const pagos08: Record<string, number> = {};
for (const t of listarTransferencias(db, '2026-08')) if (t.pendiente > 0) pagos08[t.codigo] = pagarLiquidacion(db, t.liquidacionId, { cuenta_id: t.moneda === 'USD' ? 3 : 1, fecha: '2026-09-10', importe: t.pendiente, detalle: 'Transferencia' });
// Pagos de agosto anulados (sus facturas, más abajo) antes de cerrar septiembre: con septiembre cerrado ya no se puede.
anularMovimiento(db, pagos08.ESC);
anularMovimiento(db, pagos08.DUR);
cerrarPeriodo(db, '2026-09');
const [alm, bos, ced] = listarTransferencias(db, '2026-09');
const pagoAlm = pagarLiquidacion(db, alm.liquidacionId, { cuenta_id: 1, fecha: '2026-10-10', importe: alm.pendiente, detalle: 'Transferencia' });
const pagoCed = pagarLiquidacion(db, ced.liquidacionId, { cuenta_id: 1, fecha: '2026-10-10', importe: Math.round(ced.pendiente / 2), detalle: 'Primera parte' });
void bos;
// Factura de prueba (homologación) del pago de ALM: datos inventados, sin pasar por ARCA.
db.prepare(`INSERT INTO comprobante(periodo_id, depto_id, propietario_id, movimiento_id, emisor_id, cbte_tipo, punto_venta, numero, cae, cae_vencimiento,
  fecha, serv_desde, serv_hasta, importe, receptor_json, estado, ambiente, creado_en) VALUES
  ((SELECT id FROM periodo WHERE mes = '2026-09'), 1, 1, ?, 1, 11, 3, 15, '76123456789012', '2026-10-20', '2026-10-10', '2026-09-01', '2026-09-30',
   ?, ?, 'aprobado', 'homologacion', '2026-10-10 12:00:00')`)
  .run(pagoAlm, 9500000, JSON.stringify({ razon_social: 'Pérez Ana', doc_tipo: 80, doc_nro: '27111111112', condicion_iva: 'consumidor_final', domicilio: 'Calle Falsa 123, Rosario' }));

// Más ejemplos para la pantalla Comprobantes (octubre): un rechazo pendiente, una factura anulada por su NC y una
// factura de un pago anulado esperando su NC. Fuera de ALM y BOS, que salen en las capturas.
const comprobante = db.prepare(`INSERT INTO comprobante(periodo_id, depto_id, propietario_id, movimiento_id, emisor_id, cbte_tipo, punto_venta,
  numero, cae, cae_vencimiento, fecha, serv_desde, serv_hasta, importe, receptor_json, estado, ambiente, motivo, request_json, response_json,
  asociado_id, creado_en) VALUES ((SELECT id FROM periodo WHERE mes = ?), (SELECT id FROM depto WHERE codigo = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  'homologacion', ?, ?, ?, ?, ?)`);
const receptor = (razon_social: string, doc_nro: string) =>
  JSON.stringify({ razon_social, doc_tipo: 80, doc_nro, condicion_iva: 'consumidor_final', domicilio: 'Calle Demo 789, Rosario' });
const gomez = receptor('Gómez Luis', '20222222223');
const ruiz = receptor('Ruiz Marcos', '20333333334');
const sep = ['2026-09-01', '2026-09-30'], ago = ['2026-08-01', '2026-08-31'];
comprobante.run('2026-09', 'CED', 2, pagoCed, 2, 11, 2, null, null, null, '2026-10-11', ...sep, 4000000, gomez, 'rechazado',
  '10015: El número de documento del receptor no es válido', '{"cbteTipo":11,"numero":5}',
  '<FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp></FECAESolicitarResult>', null, '2026-10-11 09:30:00');
const facEsc = comprobante.run('2026-08', 'ESC', 4, pagos08.ESC, 2, 11, 2, 4, '76123456789104', '2026-10-22', '2026-10-12', ...ago, 5200000, ruiz,
  'aprobado', null, '{"cbteTipo":11,"numero":4}', '<FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp></FECAESolicitarResult>',
  null, '2026-10-12 10:00:00').lastInsertRowid;
comprobante.run('2026-08', 'ESC', 4, pagos08.ESC, 2, 13, 2, 1, '76123456789201', '2026-10-25', '2026-10-15', ...ago, 5200000, ruiz,
  'aprobado', null, '{"cbteTipo":13,"numero":1}', '<FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp></FECAESolicitarResult>',
  facEsc, '2026-10-15 11:00:00');
comprobante.run('2026-08', 'DUR', 3, pagos08.DUR, 1, 11, 3, 16, '76123456789016', '2026-10-26', '2026-10-16', ...ago, 3000000,
  receptor('Fernández Clara', '27444444449'), 'aprobado', null, '{"cbteTipo":11,"numero":16}', null, null, '2026-10-16 12:00:00');

const hist = db.prepare('INSERT INTO historico_mensual(depto_id, mes, noches_ocupadas) VALUES (?, ?, ?)');
for (let i = 1; i <= 7; i++) for (let d = 1; d <= 5; d++) hist.run(d, `2026-0${i}`, 12 + ((i * d * 5) % 15));
db.close();
console.log('ok', dir);
