// Correr: npm test
// Contra un Stays simulado (datos ficticios con el formato real de la API).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as XLSX from 'xlsx';
import { abrirDb } from '../db.ts';
import { crearClienteStays, type AlojamientoStays, type FilaReserva, type MedioStays, type PagoStays } from './cliente.ts';
import { fechaStays, sincronizarMes, sumarMeses } from './sync.ts';

const reserva = (codigo: string, depto: string, llegada: string, salida: string, canal: string, moneda = 'USD'): FilaReserva => ({
  Reserva: codigo, 'Nombre interno del alojamiento': depto, Llegada: llegada, 'Fecha de salida': salida, Canal: canal,
  Moneda: moneda, 'Total de huéspedes': 2, 'Total de factura de hospedaje': 311.45, 'Precio de compra': 140.85,
  'Tipo de documento': 'ID', 'Numero de documento': 11111111, 'Nombre del huésped': 'Huésped Ficticio',
});
const pago = (id: string, medio: string, val: number, extra: Partial<PagoStays> = {}): PagoStays =>
  ({ _id: id, _idpaymentProvider: medio, _idreserve: 'int-' + id, type: 'credit', status: 'completed', _f_val: val, paymentDate: '2026-05-02', ...extra });

// Stays simulado: devuelve las mismas reservas para cualquier dateType (el filtro es nuestro)
// y anota cada pedido. `fallan`: reservas cuyos pagos responden 500 ('listings': los alojamientos).
interface DatosStays { reservas: FilaReserva[]; pagos: Record<string, PagoStays[]>; alojamientos: AlojamientoStays[]; fallan: Set<string>; pedidos: string[] }
async function conStays(fn: (url: string, datos: DatosStays, medios: MedioStays[]) => Promise<void>) {
  const medios: MedioStays[] = [
    { _id: 'mp', type: 'mercadopago', status: 'active', internalName: 'Mercado Pago Prueba', currencies: ['ARS'] },
    { _id: 'payo', type: 'bank', status: 'active', internalName: 'Payoneer' },
    { _id: 'efe', type: 'user', status: 'active' },
  ];
  const datos = {
    reservas: [
      reserva('R1', 'AAA', '01 may. 2026', '05 may. 2026', 'API airbnb'),
      reserva('R2', 'BBB', '28 abr. 2026', '03 may. 2026', '', 'ARS'),      // viene de abril; sin canal
      reserva('R3', 'ZZZ', '10 may. 2026', '12 may. 2026', 'API airbnb'),   // depto desconocido
      reserva('R4', 'AAA', '20 abr. 2026', '01 may. 2026', 'API airbnb'),   // sale el 1: 0 noches en mayo
      reserva('R5', 'AAA', '31 may. 2026', '31 may. 2026', 'VRBO nuevo'),   // cancelación de 0 noches; canal nuevo
    ],
    pagos: {
      R1: [pago('p1', 'payo', 300), pago('p2', 'payo', 48.28, { type: 'debit', name: 'res. fee API airbnb' }),
        pago('p3', 'payo', 48.28, { name: 'res. fee API airbnb' })],
      R2: [pago('p4', 'mp', 100000, { _f_tax: 5000 }), pago('p5', 'mp', 50000)],  // p5: MP sin comisión
      R5: [pago('p6', 'efe', 20000)],
    } as Record<string, PagoStays[]>,
    alojamientos: [
      { _id: 'la', internalName: 'AAA', status: 'active', address: { street: 'Calle Falsa', streetNumber: '123', additional: '4B' },
        _t_mainImageMeta: { url: 'https://prueba.stays.net/image/f1' },
        _t_imagesMeta: [{ url: 'https://prueba.stays.net/image/f1' }, { url: 'https://prueba.stays.net/image/f2' }, { url: 'http://inseguro/f3' }] },
      { _id: 'lb', internalName: 'BBB', status: 'active' },
      { _id: 'lz', internalName: 'ZZZ', status: 'active' },
      // 20 dados de baja: obligan a pedir una segunda página.
      ...Array.from({ length: 20 }, (_, i) => ({ _id: `lv${i}`, internalName: `VIEJO${i}`, status: 'inactive' })),
    ] as AlojamientoStays[],
    fallan: new Set<string>(),
    pedidos: [] as string[],
  };
  const esperado = 'Basic ' + Buffer.from('usuario:clave').toString('base64');
  const server = createServer((req, res) => {
    if (req.headers.authorization !== esperado) { res.writeHead(401).end('unauthorized'); return; }
    const url = new URL(req.url!, 'http://x');
    datos.pedidos.push(req.url!);
    if (url.pathname === '/finance/payment-providers') { res.end(JSON.stringify(medios)); return; }
    if (url.pathname === '/content/listings') {
      if (datos.fallan.has('listings')) { res.writeHead(403).end('sin permiso'); return; }
      const skip = Number(url.searchParams.get('skip')), limit = Number(url.searchParams.get('limit'));
      res.end(JSON.stringify(datos.alojamientos.slice(skip, skip + Math.min(limit, 20))));
      return;
    }
    if (url.pathname === '/booking/reservations-export') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos.reservas), 'Sheet1');
      res.end(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
      return;
    }
    const m = /^\/booking\/reservations\/([^/]+)\/payments$/.exec(url.pathname);
    if (m && datos.fallan.has(m[1])) { res.writeHead(500).end('error interno'); return; }
    if (m) { res.end(JSON.stringify(datos.pagos[m[1]] ?? [])); return; }
    res.writeHead(404).end();
  }).listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, datos, medios);
  } finally {
    server.close();
  }
}

function baseConAbril() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO propietario(nombre) VALUES ('Propietario Uno');
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1), ('BBB', 'Depto B', 1);
    INSERT INTO plataforma(nombre_stays, nombre, codigo, gestiona_pago) VALUES ('API airbnb', 'Airbnb', 'A', 1), ('Carga Agente', 'Carga Agente', 'W', 0);
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base,
      adicional_huesped, cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado)
    VALUES ('2026-04', '2026-04-01', '2026-05-01', '2026-04-28', '2026-05-10', 1, 1, 1, 1, 1, 1, 6978520, 1, 1, 1, 2000, 'cerrado');`);
  return db;
}

test('fechas de Stays y meses', () => {
  assert.equal(fechaStays('01 oct. 2026'), '2026-10-01');
  assert.equal(fechaStays('9 dic. 2026'), '2026-12-09');
  assert.equal(fechaStays('2026-05-03'), '2026-05-03');
  assert.equal(fechaStays('ayer'), null);
  assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(sumarMeses('2026-04-28', 1), '2026-05-28');
});

test('traer mayo: crea el período, trae reservas y pagos del mes y avisa lo que falta', () => conStays(async (url) => {
  const db = baseConAbril();
  const r = await sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');

  assert.equal(r.periodoCreado, true);
  assert.deepEqual([r.reservas, r.pagos, r.eliminadas], [3, 6, 0]);
  const periodo = db.prepare(`SELECT fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, tarifa_base, estado FROM periodo WHERE mes = '2026-05'`).get() as any;
  assert.deepEqual({ ...periodo }, { fecha_cierre_reservas: '2026-06-01', fecha_corte_gastos: '2026-05-28', fecha_pago: '2026-06-10', tarifa_base: 6978520, estado: 'abierto' });

  const reservas = db.prepare(`
    SELECT r.codigo, d.codigo depto, p.nombre_stays canal, r.llegada, r.salida, r.moneda, r.huesped_doc_tipo, r.precio_compra
    FROM reserva r JOIN depto d ON d.id = r.depto_id LEFT JOIN plataforma p ON p.id = r.plataforma_id ORDER BY r.codigo`).all() as any[];
  assert.deepEqual(reservas.map((x) => ({ ...x })), [
    { codigo: 'R1', depto: 'AAA', canal: 'API airbnb', llegada: '2026-05-01', salida: '2026-05-05', moneda: 'USD', huesped_doc_tipo: 'DNI', precio_compra: 14085 },
    { codigo: 'R2', depto: 'BBB', canal: 'Carga Agente', llegada: '2026-04-28', salida: '2026-05-03', moneda: 'ARS', huesped_doc_tipo: 'DNI', precio_compra: 14085 },
    { codigo: 'R5', depto: 'AAA', canal: null, llegada: '2026-05-31', salida: '2026-05-31', moneda: 'USD', huesped_doc_tipo: 'DNI', precio_compra: 14085 },
  ]);

  // Lo que entra en la liquidación: sin débitos ni "res. fee"; MP neto de comisión.
  const liquidable = db.prepare(`
    SELECT r.codigo, v.moneda, sum(v.importe_neto) neto FROM v_pago_liquidable v JOIN reserva r ON r.id = v.reserva_id
    GROUP BY r.codigo, v.moneda ORDER BY r.codigo`).all() as any[];
  assert.deepEqual(liquidable.map((x) => ({ ...x })), [
    { codigo: 'R1', moneda: 'USD', neto: 30000 },
    { codigo: 'R2', moneda: 'ARS', neto: 14500000 },
    { codigo: 'R5', moneda: 'ARS', neto: 2000000 },
  ]);

  for (const texto of ['Se creó el período 2026-05', 'Reserva R3: el alojamiento "ZZZ"', 'Canal "VRBO nuevo"',
    'sin comisión cargada en Stays (R2)', 'Medios de pago sin cuenta asociada: Efectivo, Mercado Pago Prueba, Payoneer']) {
    assert.ok(r.avisos.some((a) => a.includes(texto)), `falta el aviso "${texto}" en ${JSON.stringify(r.avisos)}`);
  }
}));

test('volver a traer el mes respeta los ajustes manuales y borra lo que Stays ya no tiene', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  const cliente = crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url);
  await sincronizarMes(db, cliente, '2026-05');
  db.exec(`UPDATE reserva SET ajuste_ars = -500000, observacion = 'descuento acordado' WHERE codigo = 'R2'`);
  db.exec(`UPDATE medio_pago SET moneda = 'ARS' WHERE stays_id = 'payo'`); // editado en la app: se respeta

  datos.reservas = datos.reservas.filter((x) => x.Reserva !== 'R5');
  datos.reservas[0]['Total de huéspedes'] = 4;
  datos.pagos.R2 = [datos.pagos.R2[0]];
  const r = await sincronizarMes(db, cliente, '2026-05');

  assert.equal(r.periodoCreado, false);
  assert.deepEqual([r.reservas, r.pagos, r.eliminadas], [2, 4, 1]);
  assert.ok(r.avisos.some((a) => a === 'Reserva R5: ya no está en Stays, se borró.'));
  const r2 = db.prepare(`SELECT ajuste_ars, observacion, (SELECT count(*) FROM pago WHERE reserva_id = reserva.id) pagos FROM reserva WHERE codigo = 'R2'`).get() as any;
  assert.deepEqual({ ...r2 }, { ajuste_ars: -500000, observacion: 'descuento acordado', pagos: 1 });
  assert.equal((db.prepare(`SELECT huespedes FROM reserva WHERE codigo = 'R1'`).get() as any).huespedes, 4);
  assert.equal((db.prepare(`SELECT moneda FROM medio_pago WHERE stays_id = 'payo'`).get() as any).moneda, 'ARS');
  assert.equal((db.prepare(`SELECT count(*) n FROM sincronizacion`).get() as any).n, 2);
}));

test('no borra reservas que Stays devolvió pero se descartaron, ni todo el mes si el export viene vacío', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  const cliente = crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url);
  await sincronizarMes(db, cliente, '2026-05');
  const cantidad = () => (db.prepare('SELECT count(*) n FROM reserva').get() as any).n;
  assert.equal(cantidad(), 3);

  datos.reservas[0]['Nombre interno del alojamiento'] = 'RENOMBRADO'; // R1 sigue en Stays, con otro alojamiento
  const r1 = await sincronizarMes(db, cliente, '2026-05');
  assert.equal(r1.eliminadas, 0);
  assert.equal(cantidad(), 3);

  datos.reservas = [];
  const r2 = await sincronizarMes(db, cliente, '2026-05');
  assert.equal(r2.eliminadas, 0);
  assert.equal(cantidad(), 3);
  assert.ok(r2.avisos.some((a) => a.includes('Stays no devolvió ninguna reserva para 2026-05')));
}));

test('una reserva con ajustes que deja de aparecer en el mes (p. ej. cambió de fecha) no se borra', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  const cliente = crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url);
  await sincronizarMes(db, cliente, '2026-05');
  db.exec(`UPDATE reserva SET ajuste_ars = -500000 WHERE codigo = 'R2'`);

  datos.reservas = datos.reservas.filter((x) => x.Reserva !== 'R2');
  const r = await sincronizarMes(db, cliente, '2026-05');
  assert.equal(r.eliminadas, 0);
  assert.equal((db.prepare(`SELECT ajuste_ars FROM reserva WHERE codigo = 'R2'`).get() as any).ajuste_ars, -500000);
  assert.ok(r.avisos.some((a) => a.startsWith('Reserva R2: ya no aparece en 2026-05 en Stays pero tiene ajustes')));
}));

test('moneda desconocida avisa; un medio que primero llegó como desconocido toma sus datos reales; stays_id no se pierde', () => conStays(async (url, datos, medios) => {
  const db = baseConAbril();
  const cliente = crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url);
  datos.reservas[0].Moneda = 'EUR';
  datos.pagos.R1.push(pago('p9', 'nuevo-mp', 1000, { _f_tax: 50 })); // medio que Stays todavía no informa
  const r1 = await sincronizarMes(db, cliente, '2026-05');
  assert.ok(r1.avisos.some((a) => a.includes('Reserva R1: moneda "EUR" desconocida')));
  const medio = () => ({ ...(db.prepare(`SELECT nombre, moneda, descuenta_comision FROM medio_pago WHERE stays_id = 'nuevo-mp'`).get() as any) });
  assert.deepEqual(medio(), { nombre: '(medio desconocido)', moneda: 'USD', descuenta_comision: 0 });
  const staysId = (db.prepare(`SELECT stays_id FROM reserva WHERE codigo = 'R1'`).get() as any).stays_id;
  assert.ok(staysId);

  medios.push({ _id: 'nuevo-mp', type: 'mercadopago', status: 'active', internalName: 'MP Nuevo', currencies: ['ARS'] });
  datos.pagos.R1 = []; // la reserva se queda sin pagos en Stays
  await sincronizarMes(db, cliente, '2026-05');
  assert.deepEqual(medio(), { nombre: 'MP Nuevo', moneda: 'ARS', descuenta_comision: 1 });
  assert.equal((db.prepare(`SELECT stays_id FROM reserva WHERE codigo = 'R1'`).get() as any).stays_id, staysId);
}));

test('un pago sin medio de pago en Stays se trae como "(sin medio)" en la moneda de la reserva', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  const sinMedio = { ...pago('p10', 'x', 700) } as Partial<PagoStays>;
  delete sinMedio._idpaymentProvider; // así llegan algunos pagos de meses viejos
  datos.pagos.R1.push(sinMedio as PagoStays, { ...pago('p11', 'x', 50), _idpaymentProvider: null } as unknown as PagoStays);
  datos.pagos.R2.push({ ...pago('p12', 'x', 900), _idpaymentProvider: '' } as PagoStays);
  const r = await sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');
  assert.equal(r.pagos, 9);
  const medios = db.prepare(`
    SELECT mp.stays_id, mp.nombre, mp.moneda, count(*) n FROM pago p JOIN medio_pago mp ON mp.id = p.medio_pago_id
    WHERE p.stays_id IN ('p10', 'p11', 'p12') GROUP BY mp.id ORDER BY mp.stays_id`).all() as any[];
  assert.deepEqual(medios.map((x) => ({ ...x })), [
    { stays_id: 'sin-medio-ARS', nombre: '(sin medio)', moneda: 'ARS', n: 1 },
    { stays_id: 'sin-medio-USD', nombre: '(sin medio)', moneda: 'USD', n: 2 },
  ]);
  assert.ok(r.avisos.some((a) => a.includes('Reserva R1: el pago p10 no tiene medio de pago en Stays')));

  // Sin _id no se puede guardar: se saltea con aviso.
  datos.pagos.R5.push({ ...pago('', 'efe', 300) });
  const r2 = await sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');
  assert.ok(r2.avisos.some((a) => a.includes('Reserva R5: un pago de 300 no tiene identificador')));
}));

test('si un dato de Stays tiene una forma inesperada, el error dice de qué reserva es y no se escribe nada', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  datos.pagos.R2.push({ ...pago('p20', 'mp', 1), status: undefined } as unknown as PagoStays);
  await assert.rejects(sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05'), /^Error: Reserva R2: /);
  assert.equal((db.prepare('SELECT count(*) n FROM reserva').get() as { n: number }).n, 0);
}));

test('avisa pagos en dólares cargados con el importe en pesos de la reserva o con montos absurdos', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  datos.pagos.R2.push(pago('p30', 'payo', 311.45));  // R2 es en ARS por $ 311,45: el mismo número con Payoneer (USD)
  datos.pagos.R1.push(pago('p31', 'payo', 15000));   // USD 15.000 en un pago
  datos.pagos.R1.push(pago('p32', 'payo', 9000));    // USD 9.000: no avisa
  const r = await sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');
  const raros = r.avisos.filter((a) => /no parece en dólares|igual al total de la reserva/.test(a));
  assert.equal(raros.length, 2, JSON.stringify(raros));
  assert.match(raros[0], /^Reserva R1: el pago p31 por "Payoneer" es de USD 15\.000/);
  assert.match(raros[1], /^Reserva R2: el pago p30 de 311,45 por "Payoneer" se toma en USD, pero es igual al total de la reserva en ARS/);
}));

test('pide a Stays las tres consultas del período con el rango correcto', () => conStays(async (url, datos) => {
  await sincronizarMes(baseConAbril(), crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');
  const exports = datos.pedidos.filter((p) => p.startsWith('/booking/reservations-export')).sort();
  assert.deepEqual(exports, [
    '/booking/reservations-export?from=2026-05-01&to=2026-06-01&dateType=arrival',
    '/booking/reservations-export?from=2026-05-01&to=2026-06-01&dateType=included',
    '/booking/reservations-export?from=2026-05-02&to=2026-06-02&dateType=departure',
  ]);
}));

test('si falla la descarga de pagos a mitad de camino no se escribe nada y queda el error registrado', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  const cliente = crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url);
  await sincronizarMes(db, cliente, '2026-05');
  const foto = () => JSON.stringify(db.prepare(`SELECT (SELECT count(*) FROM reserva) r, (SELECT count(*) FROM pago) p, (SELECT group_concat(huespedes) FROM reserva) h`).get());
  const antes = foto();
  datos.reservas[0]['Total de huéspedes'] = 9;
  datos.fallan.add('R2');
  await assert.rejects(sincronizarMes(db, cliente, '2026-05'), /Stays respondió 500/);
  assert.equal(foto(), antes);
  assert.equal((db.prepare(`SELECT resultado FROM sincronizacion ORDER BY id DESC LIMIT 1`).get() as any).resultado, 'error');
}));

test('una reserva que ya es parte de una liquidación no se borra aunque Stays ya no la tenga', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  const cliente = crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url);
  await sincronizarMes(db, cliente, '2026-05');
  db.exec(`
    INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_ocupadas, cant_reservas,
      ingresos_ars, ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars,
      saldo_anterior_usd, movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
    VALUES (1, 1, 1, 0.2, 30, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'x');
    INSERT INTO liquidacion_reserva(liquidacion_id, reserva_id, codigo_interno, noches_totales, noches_periodo, importe_ars,
      importe_periodo_ars, importe_usd, importe_periodo_usd, tarifa, tarifa_periodo, comision_ars, comision_usd)
    SELECT 1, id, 'x', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 FROM reserva WHERE codigo = 'R5';`);
  datos.reservas = datos.reservas.filter((x) => x.Reserva !== 'R5');
  const r = await sincronizarMes(db, cliente, '2026-05');
  assert.equal(r.eliminadas, 0);
  assert.ok(r.avisos.some((a) => a.startsWith('Reserva R5: ya no está en Stays pero es parte de una liquidación')));
}));

test('clave incorrecta o período cerrado: no se escribe nada', () => conStays(async (url) => {
  const db = baseConAbril();
  await sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');
  const reservasAntes = (db.prepare('SELECT count(*) n FROM reserva').get() as any).n;

  await assert.rejects(sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'mal' }, url), '2026-05'), /rechazó el usuario o la clave/);
  assert.equal((db.prepare('SELECT count(*) n FROM reserva').get() as any).n, reservasAntes);
  assert.equal((db.prepare(`SELECT resultado FROM sincronizacion ORDER BY id DESC LIMIT 1`).get() as any).resultado, 'error');

  await assert.rejects(sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-04'), /2026-04 está cerrado/);
  await assert.rejects(sincronizarMes(abrirDb(':memory:'), crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05'), /importá primero el Excel/);
}));

test('alojamientos: avisa los que no coinciden con la app, completa direcciones vacías y trae las fotos', () => conStays(async (url, datos) => {
  const db = baseConAbril();
  db.exec(`INSERT INTO depto(codigo, nombre, propietario_id, direccion) VALUES ('CCC', 'Depto C', 1, NULL), ('DDD', 'Depto D', 1, 'Editada a mano')`);
  datos.alojamientos.push({ _id: 'ld', internalName: 'DDD', status: 'active', address: { street: 'Otra', streetNumber: '1' }, _t_imagesMeta: [{}] });
  datos.alojamientos[1].status = 'hidden';
  const r = await sincronizarMes(db, crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');

  assert.deepEqual(datos.pedidos.filter((p) => p.startsWith('/content/listings')),
    ['/content/listings?skip=0&limit=20', '/content/listings?skip=20&limit=20']);
  const alojamientos = r.avisos.filter((a) => a.startsWith('El alojamiento') || a.startsWith('El depto'));
  assert.deepEqual(alojamientos.sort(), [
    'El alojamiento "ZZZ" está activo en Stays pero no es un depto cargado en la app.',
    'El depto BBB está activo en la app pero en Stays está "hidden".',
    'El depto CCC está activo en la app pero no existe en Stays.',
    'El depto DDD tiene fotos en Stays pero no se pudo leer su dirección web.',
  ]);
  const direcciones = db.prepare(`SELECT codigo, direccion FROM depto ORDER BY codigo`).all().map((x: any) => `${x.codigo}: ${x.direccion}`);
  assert.deepEqual(direcciones, ['AAA: Calle Falsa 123 4B', 'BBB: null', 'CCC: null', 'DDD: Editada a mano']);
  // La principal primero, sin repetir y solo https.
  const fotos = db.prepare(`SELECT codigo, fotos FROM depto ORDER BY codigo`).all().map((x: any) => `${x.codigo}: ${x.fotos}`);
  assert.deepEqual(fotos, ['AAA: ["https://prueba.stays.net/image/f1","https://prueba.stays.net/image/f2"]', 'BBB: null', 'CCC: null', 'DDD: null']);
}));

test('si Stays no deja leer los alojamientos, el mes se trae igual con un aviso', () => conStays(async (url, datos) => {
  datos.fallan.add('listings');
  const r = await sincronizarMes(baseConAbril(), crearClienteStays({ usuario: 'usuario', clave: 'clave' }, url), '2026-05');
  assert.equal(r.reservas, 3);
  assert.ok(r.avisos.some((a) => a.startsWith('No se pudo revisar los alojamientos de Stays')), JSON.stringify(r.avisos));
}));
