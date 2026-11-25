// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ComparacionDepto } from '../server/liquidacion/comparar.ts';
import { difSaldoEnPesos, soloConDiferencias } from './diferencias.ts';

const c = (codigo: string, estado: ComparacionDepto['estado'], difSaldo?: number): [string, ComparacionDepto] =>
  [codigo, { codigo, estado, diferencias: [], difSaldo }];

test('solo con diferencias: sin hoja primero, después el saldo de mayor a menor y los de saldo igual al final', () => {
  const deptos = [
    { codigo: 'AAA', moneda: 'ARS' as const },  // igual: se oculta
    { codigo: 'BBB', moneda: 'ARS' as const },  // −$ 5.000
    { codigo: 'CCC', moneda: 'USD' as const },  // USD 10 = $ 10.000
    { codigo: 'DDD', moneda: 'ARS' as const },  // saldo igual, otro campo distinto
    { codigo: 'EEE', moneda: 'ARS' as const },  // no está en el Excel
    { codigo: 'FFF', moneda: 'ARS' as const },  // sin comparación (hoja del Excel ilegible, etc.): se oculta
  ];
  const comparacion = new Map([c('AAA', 'igual', 100), c('BBB', 'distinto', -500_000), c('CCC', 'distinto', 1000),
    c('DDD', 'distinto', 0), c('EEE', 'solo_app')]);
  assert.deepEqual(soloConDiferencias(deptos, comparacion, 1000).map((d) => d.codigo), ['EEE', 'CCC', 'BBB', 'DDD']);
});

test('solo con diferencias: un posible pago directo sin revisar entra aunque dé igual al Excel', () => {
  const deptos = [
    { codigo: 'AAA', moneda: 'ARS' as const, pagoDirecto: { revisado: false } }, // igual, sin revisar: entra al final
    { codigo: 'BBB', moneda: 'ARS' as const, pagoDirecto: { revisado: true } },  // igual y revisado: se oculta
    { codigo: 'CCC', moneda: 'ARS' as const, pagoDirecto: null },
  ];
  const comparacion = new Map([c('AAA', 'igual', 0), c('BBB', 'igual', 0), c('CCC', 'distinto', 100)]);
  assert.deepEqual(soloConDiferencias(deptos, comparacion, 1000).map((d) => d.codigo), ['CCC', 'AAA']);
});

test('dif. de saldo en pesos: los USD al cambio; sin comparación, null', () => {
  assert.equal(difSaldoEnPesos({ codigo: 'X', moneda: 'USD' }, c('X', 'distinto', -250)[1], 1200), -300_000);
  assert.equal(difSaldoEnPesos({ codigo: 'X', moneda: 'ARS' }, c('X', 'distinto', -250)[1], 1200), -250);
  assert.equal(difSaldoEnPesos({ codigo: 'X', moneda: 'ARS' }, c('X', 'solo_app')[1], 1200), null);
  assert.equal(difSaldoEnPesos({ codigo: 'X', moneda: 'ARS' }, undefined, 1200), null);
});
