// Correr: npm test. Los colores de la interfaz salen del tema (src/tema.ts), no de hex sueltos en las pantallas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Imprimir.tsx es la hoja del PDF: sin antd y con grises para impresora.
const pantallas = readdirSync(import.meta.dirname).filter((f) => f.endsWith('.tsx') && f !== 'Imprimir.tsx');

test('sin colores sueltos en las pantallas', () => {
  const sueltos = pantallas.flatMap((f) => readFileSync(`${import.meta.dirname}/${f}`, 'utf8').split('\n')
    .flatMap((linea, i) => (/#[0-9a-fA-F]{3,6}\b/.test(linea) ? [`${f}:${i + 1}`] : [])));
  assert.deepEqual(sueltos, [], 'Color suelto: usá el tema (src/tema.ts, theme.useToken()) o Typography type');
});
