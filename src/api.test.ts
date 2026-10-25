// Correr: npm test. Solo los helpers puros de la interfaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, leerPlata, SIN_CONEXION } from './api.ts';

test('leerPlata: miles con punto y decimales con coma; el punto del teclado numérico es decimal', () => {
  assert.deepEqual(['1.612.004,50', '1500', '1.500', '1500,5', '1500.5', '1500.50', '1.500.25', '0,07'].map((s) => Number(leerPlata(s))),
    [1612004.5, 1500, 1500, 1500.5, 1500.5, 1500.5, 1500.25, 0.07]);
});

test('sin conexión: el error dice qué pasó, no "Failed to fetch"', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
  try {
    await assert.rejects(get('deptos'), { message: SIN_CONEXION });
  } finally {
    globalThis.fetch = original;
  }
});
