// Correr: npm test. Hace cumplir las reglas de diseño escritas al principio de src/tema.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { LETRA } from './tema.ts';

// Imprimir.tsx es la hoja del PDF: sin antd y con grises para impresora.
const pantallas = readdirSync(import.meta.dirname).filter((f) => f.endsWith('.tsx') && f !== 'Imprimir.tsx');
// Cada renglón de cada pantalla donde `encontrar` da algo: "Archivo.tsx:12 lo encontrado".
const buscar = (encontrar: (linea: string) => string[]) => pantallas.flatMap((f) =>
  readFileSync(`${import.meta.dirname}/${f}`, 'utf8').split('\n').flatMap((linea, i) => encontrar(linea).map((x) => `${f}:${i + 1} ${x}`)));

test('regla 1: sin colores escritos en las pantallas', () => {
  assert.deepEqual(buscar((l) => l.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) ?? []), [],
    'Color suelto: usá Typography type, theme.useToken() o `colores` de src/tema.ts');
});

test('regla 3: tamaños de letra de la escala', () => {
  const fuera = buscar((l) => [...l.matchAll(/fontSize: ([\d.]+)/g)].map((m) => m[1]).filter((n) => !LETRA.includes(Number(n))));
  assert.deepEqual(fuera, [], `Tamaño fuera de la escala: usá uno de LETRA en src/tema.ts (${LETRA.join(', ')})`);
});
