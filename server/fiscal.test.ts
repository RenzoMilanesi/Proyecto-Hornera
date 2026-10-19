// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { condicionIvaDePadron, desglosarIva, dniDeCuit, esNotaCredito, fechaArca, fechaComprobante, isoDeArca, LETRA_CBTE, NOMBRE_CBTE, notaCreditoDe, qrArca, tipoComprobante, validarCuit } from './fiscal.ts';

test('tipoComprobante: monotributista y exento emiten C; inscripto A o B según el receptor', () => {
  assert.equal(tipoComprobante('monotributista', 'responsable_inscripto'), 11);
  assert.equal(tipoComprobante('exento', 'consumidor_final'), 11);
  assert.equal(tipoComprobante('monotributista', null, true), 13);
  assert.equal(tipoComprobante('responsable_inscripto', 'responsable_inscripto'), 1);
  assert.equal(tipoComprobante('responsable_inscripto', 'monotributista'), 6);
  assert.equal(tipoComprobante('responsable_inscripto', undefined, true), 8);
});

test('tipoComprobante: una condición desconocida explota en vez de facturar mal', () => {
  assert.throws(() => tipoComprobante('inventada', null));
  assert.throws(() => tipoComprobante('consumidor_final', null));
  assert.throws(() => tipoComprobante('monotributista', 'inventada'));
});

test('notaCreditoDe: misma letra que la factura; si no es factura, explota', () => {
  assert.deepEqual([1, 6, 11].map(notaCreditoDe), [3, 8, 13]);
  assert.throws(() => notaCreditoDe(13));
});

test('desglosarIva: C sin array Iva; inscripto separa neto e IVA sin descuadrar el total', () => {
  assert.deepEqual(desglosarIva(121000, 'monotributista'), { ImpNeto: 121000, ImpIVA: 0, ImpTotal: 121000, Iva: null });
  assert.deepEqual(desglosarIva(121000, 'responsable_inscripto'),
    { ImpNeto: 100000, ImpIVA: 21000, ImpTotal: 121000, Iva: [{ Id: 5, BaseImp: 100000, Importe: 21000 }] });
  for (const total of [1, 99, 12345, 9999999]) {
    const d = desglosarIva(total, 'responsable_inscripto');
    assert.equal(d.ImpNeto + d.ImpIVA, total);
  }
  assert.throws(() => desglosarIva(100, 'responsable_inscripto', 19));
});

test('validarCuit: dígito verificador, largo, guiones y nulos', () => {
  assert.equal(validarCuit('20111111112'), true);
  assert.equal(validarCuit('20-11111111-2'), true);
  assert.equal(validarCuit('20111111113'), false);
  assert.equal(validarCuit('2011111111'), false);
  assert.equal(validarCuit(null), false);
});

test('condicionIvaDePadron: solo cuentan los impuestos activos', () => {
  assert.equal(condicionIvaDePadron([{ id: 30, estado: 'AC' }, { id: 20, estado: 'AC' }]), 'responsable_inscripto');
  assert.equal(condicionIvaDePadron([{ id: 20, estado: 'AC' }]), 'monotributista');
  assert.equal(condicionIvaDePadron([{ id: 30, estado: 'EX' }]), null);
});

test('fechaComprobante: ventana de 10 días, nunca futura ni anterior al último autorizado', () => {
  const hoy = '2026-10-19';
  assert.equal(fechaComprobante({ fechaPago: '2026-10-15', hoy }), '2026-10-15');
  assert.equal(fechaComprobante({ fechaPago: '2026-10-09', hoy }), '2026-10-09');  // borde
  assert.equal(fechaComprobante({ fechaPago: '2026-10-08', hoy }), hoy);
  assert.equal(fechaComprobante({ fechaPago: '2026-10-25', hoy }), hoy);
  assert.equal(fechaComprobante({ fechaPago: '2026-10-15', fechaUltimo: '2026-10-17', hoy }), '2026-10-17');
  assert.equal(fechaComprobante({ fechaPago: '2026-10-18', fechaUltimo: '2026-10-17', hoy }), '2026-10-18');
  assert.equal(fechaComprobante({ fechaPago: '2026-02-25', hoy: '2026-03-06' }), '2026-02-25');  // cruza el mes
  assert.equal(fechaArca('2026-10-19'), '20261019');
  assert.equal(isoDeArca('20261019'), '2026-10-19');
});

test('qrArca: JSON en base64 con los campos de la RG 4892 e importe en pesos', () => {
  const url = qrArca({ fecha: '2026-10-19', cuitEmisor: '20111111112', puntoVenta: 3, cbteTipo: 11, numero: 7,
    impTotalCentavos: 121050, docTipo: 80, docNro: '27-22222222-8', cae: '86360861716446' });
  assert.match(url, /^https:\/\/www\.afip\.gob\.ar\/fe\/qr\/\?p=/);
  assert.deepEqual(JSON.parse(Buffer.from(new URL(url).searchParams.get('p')!, 'base64').toString('utf8')), {
    ver: 1, fecha: '2026-10-19', cuit: 20111111112, ptoVta: 3, tipoCmp: 11, nroCmp: 7, importe: 1210.5,
    moneda: 'PES', ctz: 1, tipoDocRec: 80, nroDocRec: 27222222228, tipoCodAut: 'E', codAut: 86360861716446,
  });
});

test('nombres y letras: cada tipo emitible tiene los suyos; la NC comparte la letra de su factura', () => {
  for (const t of [1, 3, 6, 8, 11, 13]) assert.ok(NOMBRE_CBTE[t] && LETRA_CBTE[t]);
  for (const t of [1, 6, 11]) assert.equal(LETRA_CBTE[notaCreditoDe(t)], LETRA_CBTE[t]);
  assert.deepEqual([3, 8, 13, 11].map(esNotaCredito), [true, true, true, false]);
});

test('dniDeCuit: solo persona física; nunca un DNI corto', () => {
  assert.equal(dniDeCuit('20-11111111-2'), '11111111');
  assert.equal(dniDeCuit('20012345672'), '1234567');
  assert.equal(dniDeCuit('30500000003'), null);
  assert.equal(dniDeCuit('20000123452'), null);
  assert.equal(dniDeCuit(null), null);
});
