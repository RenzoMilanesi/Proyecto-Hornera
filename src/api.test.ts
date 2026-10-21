// Correr: npm test. Solo los helpers puros de la interfaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerPlata } from './api.ts';

test('leerPlata: miles con punto y decimales con coma; el punto del teclado numérico es decimal', () => {
  assert.deepEqual(['1.612.004,50', '1500', '1.500', '1500,5', '1500.5', '1500.50', '1.500.25', '0,07'].map((s) => Number(leerPlata(s))),
    [1612004.5, 1500, 1500, 1500.5, 1500.5, 1500.5, 1500.25, 0.07]);
});
