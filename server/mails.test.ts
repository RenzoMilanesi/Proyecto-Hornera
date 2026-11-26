// Correr: npm test. Gmail y los PDF son falsos: nada sale a la red. Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { abrirDb } from './db.ts';
import { crearApp } from './app.ts';
import type { CuentaMail, Mensaje } from './mails.ts';

// Mayo cerrado. Uno: AAA (pagado y facturado en producción) y BBB. Dos: CCC (factura solo de prueba). Tres: DDD sin mail.
// HHH es de Hornera.
function base() {
  const db = abrirDb(':memory:');
  db.exec(`
    INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_cotizacion, costo_hora_limpieza,
      servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
      cargo_tramo_1, cargo_tramo_2, cm_fee_usd, estado) VALUES
      ('2026-05', '2026-05-01', '2026-06-01', '2026-05-28', '2026-06-10', 1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'cerrado');
    INSERT INTO propietario(nombre, mails, es_hornera) VALUES ('Pérez, Ana', 'ana@ejemplo.com; ana2@ejemplo.com', 0),
      ('Gómez, Luis', 'luis@ejemplo.com', 0), ('Sin Mail', NULL, 0), ('Nosotros', 'nos@ejemplo.com', 1);
    INSERT INTO depto(codigo, nombre, propietario_id) VALUES ('AAA', 'Depto A', 1), ('BBB', 'Depto B', 1), ('CCC', 'Depto C', 2),
      ('DDD', 'Depto D', 3), ('HHH', 'Depto H', 4);
    INSERT INTO cuenta(nombre, moneda) VALUES ('Banco Prueba', 'ARS');
    INSERT INTO emisor(nombre, razon_social, cuit, condicion_iva, punto_venta, ambiente) VALUES ('Emisor', 'EMISOR', '20111111112', 'monotributista', 3, 'produccion');`);
  for (let d = 1; d <= 5; d++) {
    db.exec(`INSERT INTO liquidacion(periodo_id, depto_id, propietario_id, cambio, comision_pct, noches_disponibles, noches_ocupadas, cant_reservas,
      ingresos_ars, ingresos_usd, costos_operativos, comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars, saldo_anterior_usd,
      movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en)
      VALUES (1, ${d}, ${[1, 1, 2, 3, 4][d - 1]}, 1000, 0.2, 31, 10, 1, 0, 0, 0, 0, 0, 0, -100000, 0, 0, 0, 0, 0, 0, 1000000, 0, 'x')`);
  }
  // Pagos de AAA (1) y CCC (3), con su factura.
  const factura = (depto: number, prop: number, mov: number, ambiente: string, numero: number) => db.exec(`
    INSERT INTO comprobante(periodo_id, depto_id, propietario_id, movimiento_id, emisor_id, cbte_tipo, punto_venta, numero, cae, cae_vencimiento,
      fecha, serv_desde, serv_hasta, importe, receptor_json, estado, ambiente, creado_en)
      VALUES (1, ${depto}, ${prop}, ${mov}, 1, 11, 3, ${numero}, '1', '2026-06-30', '2026-06-10', '2026-05-01', '2026-05-31', 100000, '{}', 'aprobado', '${ambiente}', 'x')`);
  db.exec(`INSERT INTO movimiento(periodo_id, fecha, tipo, importe_ars, cuenta_id, depto_id, creado_en) VALUES
    (1, '2026-06-10', 'liquidacion', -1000000, 1, 1, 'x'), (1, '2026-06-10', 'liquidacion', -1000000, 1, 3, 'x')`);
  factura(1, 1, 1, 'produccion', 12);
  factura(3, 2, 2, 'homologacion', 5);
  return db;
}

async function conApi(fn: (llamar: (metodo: string, ruta: string, cuerpo?: unknown) => Promise<{ status: number; body: any }>) => Promise<void>,
  opciones: { cuenta?: CuentaMail | null; enviar?: (c: CuentaMail, m: Mensaje) => Promise<void> } = {}) {
  const db = base();
  let guardada = opciones.cuenta === undefined ? { usuario: 'oficina@ejemplo.com', clave: 'abcdabcdabcdabcd' } : opciones.cuenta;
  const enviados: Mensaje[] = [];
  const mail = {
    cuenta: { leer: () => guardada, guardar: (c: CuentaMail) => { guardada = c; } },
    enviar: opciones.enviar ?? (async (_c: CuentaMail, m: Mensaje) => { enviados.push(m); }),
  };
  const pdf = { generar: async (ruta: string) => Buffer.from(ruta), carpeta: () => '', abrir: () => {} };
  const server = crearApp(db, '0.0.0', { mail, pdf }).listen(0);
  const llamar = async (metodo: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/${ruta}`,
      { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { status: r.status, body: await r.json() };
  };
  try {
    await fn(llamar);
  } finally {
    server.close();
  }
  return { db, enviados, cuenta: () => guardada };
}

test('a enviar: un renglón por propietario con sus PDF; afuera sin mail; Hornera no aparece', async () => {
  await conApi(async (llamar) => {
    const { incluidos, excluidos } = (await llamar('GET', 'mails/a-enviar?mes=2026-05')).body;
    assert.deepEqual(incluidos.map((i: any) => [i.propietario, i.mails, i.deptos, i.facturas.length, i.aviso, i.enviado]), [
      ['Gómez, Luis', 'luis@ejemplo.com', ['CCC'], 0, 'Sin factura todavía', null],
      ['Pérez, Ana', 'ana@ejemplo.com; ana2@ejemplo.com', ['AAA', 'BBB'], 1, null, null],
    ]);
    assert.deepEqual(excluidos.map((e: any) => e.propietario), ['Sin Mail']);
    assert.match(excluidos[0].motivo, /sin mail/i);
    assert.equal((await llamar('GET', 'mails/a-enviar?mes=2026-5')).status, 400);
  });
});

test('enviar: a todos sus mails, con el texto y los PDF; queda registrado y la próxima vez figura enviado', async () => {
  const { db, enviados } = await conApi(async (llamar) => {
    const r = await llamar('POST', 'mails/enviar', { mes: '2026-05', propietario_id: 1 });
    assert.equal(r.status, 200);
    const ana = (await llamar('GET', 'mails/a-enviar?mes=2026-05')).body.incluidos.find((i: any) => i.propietarioId === 1);
    assert.equal(ana.enviado, r.body.fecha);
  });
  assert.equal(enviados.length, 1);
  const m = enviados[0];
  assert.deepEqual(m.to, ['ana@ejemplo.com', 'ana2@ejemplo.com']);
  assert.equal(m.subject, 'Liquidación mayo 2026 - Hornera');
  assert.match(m.text, /^Hola Ana:/);
  assert.match(m.text, /las liquidaciones y la factura de mayo 2026/);
  assert.deepEqual(m.attachments.map((a) => a.filename), ['AAA mayo 2026.pdf', 'BBB mayo 2026.pdf', 'Factura C 0003-00000012.pdf']);
  assert.equal(String(m.attachments[0].content), '/?imprimir=1&mes=2026-05&depto=AAA');
  assert.equal(String(m.attachments[2].content), '/?imprimir=1&comprobante=1');
  assert.deepEqual({ ...db.prepare('SELECT propietario_id, mes, destinatarios, adjuntos, error FROM envio_mail').get() },
    { propietario_id: 1, mes: '2026-05', destinatarios: 'ana@ejemplo.com; ana2@ejemplo.com',
      adjuntos: 'AAA mayo 2026.pdf; BBB mayo 2026.pdf; Factura C 0003-00000012.pdf', error: null });
});

test('enviar: el texto editado reemplaza nombre, mes y adjuntos', async () => {
  const { enviados } = await conApi(async (llamar) => {
    assert.equal((await llamar('PUT', 'mails/cuenta', { usuario: 'oficina@ejemplo.com', asunto: 'Mes {mes}', cuerpo: 'Querido/a {nombre}, va {adjuntos}.' })).status, 200);
    assert.equal((await llamar('POST', 'mails/enviar', { mes: '2026-05', propietario_id: 2 })).status, 200);
  });
  assert.deepEqual([enviados[0].subject, enviados[0].text], ['Mes mayo 2026', 'Querido/a Luis, va la liquidación.']);
});

test('enviar: si Gmail falla queda el error; la cuenta rechazada o sin conexión dan 502 para cortar el lote', async () => {
  const fallas: Record<string, Error> = {
    auth: Object.assign(new Error('Invalid login: 535 5.7.8'), { code: 'EAUTH' }),
    red: Object.assign(new Error('getaddrinfo ENOTFOUND smtp.gmail.com'), { code: 'EDNS' }),
    otro: Object.assign(new Error('550 5.1.1 The email account does not exist'), { code: 'EENVELOPE' }),
  };
  let falla = fallas.auth;
  const { db } = await conApi(async (llamar) => {
    const r1 = await llamar('POST', 'mails/enviar', { mes: '2026-05', propietario_id: 1 });
    assert.deepEqual([r1.status, /Gmail rechazó la cuenta/.test(r1.body.error)], [502, true]);
    falla = fallas.red;
    const r2 = await llamar('POST', 'mails/enviar', { mes: '2026-05', propietario_id: 1 });
    assert.deepEqual([r2.status, /Sin conexión con Gmail/.test(r2.body.error)], [502, true]);
    falla = fallas.otro;
    const r3 = await llamar('POST', 'mails/enviar', { mes: '2026-05', propietario_id: 1 });
    assert.deepEqual([r3.status, /does not exist/.test(r3.body.error)], [400, true]);
    assert.equal((await llamar('GET', 'mails/a-enviar?mes=2026-05')).body.incluidos.find((i: any) => i.propietarioId === 1).enviado, null);
  }, { enviar: async () => { throw falla; } });
  assert.equal((db.prepare('SELECT count(*) n FROM envio_mail WHERE error IS NOT NULL').get() as { n: number }).n, 3);
});

test('enviar: inválidos y sin cuenta no mandan nada', async () => {
  const { enviados } = await conApi(async (llamar) => {
    for (const [cuerpo, error] of [
      [{ mes: '2026-5', propietario_id: 1 }, /mes/],
      [{ mes: '2026-05', propietario_id: 3 }, /sin mail/i],
      [{ mes: '2026-05', propietario_id: 4 }, /no tiene liquidación/],
      [{ mes: '2026-05', propietario_id: 99 }, /no tiene liquidación/],
    ] as const) {
      const r = await llamar('POST', 'mails/enviar', cuerpo);
      assert.equal(r.status, 400);
      assert.match(r.body.error, error);
    }
  });
  assert.equal(enviados.length, 0);
  await conApi(async (llamar) => {
    assert.match((await llamar('POST', 'mails/enviar', { mes: '2026-05', propietario_id: 1 })).body.error, /Falta cargar la cuenta de Gmail/);
  }, { cuenta: null });
});

test('cuenta: valida mail y contraseña de aplicación, no la devuelve nunca y "probar" se manda a sí misma', async () => {
  const { cuenta, enviados } = await conApi(async (llamar) => {
    assert.deepEqual((await llamar('GET', 'mails/cuenta')).body.usuario, null);
    assert.match((await llamar('PUT', 'mails/cuenta', { usuario: 'oficina@ejemplo.com' })).body.error, /contraseña de aplicación/);
    assert.match((await llamar('PUT', 'mails/cuenta', { usuario: 'oficina', clave: 'abcd abcd abcd abcd' })).body.error, /no es un mail/);
    assert.match((await llamar('PUT', 'mails/cuenta', { usuario: 'oficina@ejemplo.com', clave: 'abcd abcd' })).body.error, /16 letras/);
    assert.equal((await llamar('PUT', 'mails/cuenta', { usuario: ' Oficina@Ejemplo.com ', clave: 'abcd efgh ijkl mnop' })).status, 200);
    // Cambiar solo el texto conserva la contraseña.
    assert.equal((await llamar('PUT', 'mails/cuenta', { usuario: 'oficina@ejemplo.com', asunto: 'Hola' })).status, 200);
    const g = (await llamar('GET', 'mails/cuenta')).body;
    assert.deepEqual([g.usuario, g.asunto, JSON.stringify(g).includes('mnop')], ['oficina@ejemplo.com', 'Hola', false]);
    assert.equal((await llamar('POST', 'mails/probar')).status, 200);
  }, { cuenta: null });
  assert.deepEqual(cuenta(), { usuario: 'oficina@ejemplo.com', clave: 'abcdefghijklmnop' });
  assert.deepEqual(enviados[0].to, ['oficina@ejemplo.com']);
});
