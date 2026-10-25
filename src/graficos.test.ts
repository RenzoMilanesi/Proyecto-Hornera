// Correr: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { porAnio, techo, trazo } from './graficos.ts';

test('porAnio: una serie por año, meses sin dato en null, años ordenados', () => {
  const filas = [{ mes: '2025-12', v: 3 }, { mes: '2024-01', v: 1 }, { mes: '2025-01', v: null }, { mes: '2025-02', v: 2 }];
  const series = porAnio(filas, (f) => f.v);
  assert.deepEqual(series.map((s) => s.anio), [2024, 2025]);
  assert.equal(series[0].valores[0], 1);
  assert.equal(series[1].valores[0], null); // enero 2025 sin dato
  assert.equal(series[1].valores[1], 2);
  assert.equal(series[1].valores[11], 3);
  assert.equal(series[1].valores.length, 12);
});

test('porAnio: un año sin ningún dato no aparece', () => {
  assert.deepEqual(porAnio([{ mes: '2023-05', v: null }], (f) => f.v), []);
});

test('techo: redondea el máximo hacia arriba a 1, 2 o 5 × 10^n', () => {
  assert.deepEqual([0, 7, 10, 13, 260, 0.83, 4_350_000].map(techo), [1, 10, 10, 20, 500, 1, 5_000_000]);
});

test('trazo: corta la línea en los huecos', () => {
  assert.equal(trazo([{ x: 0, y: 10 }, { x: 5, y: 20 }, null, { x: 15, y: 5 }, { x: 20, y: 0 }]), 'M0,10 L5,20 M15,5 L20,0');
});
