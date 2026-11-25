// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { abrirDb } from '../db.ts';
import { importarExcel } from '../importador/excel.ts';
import { armarAbrilEnBase } from './abril-en-base.ts';
import { compararConExcel, fueraDeTolerancia, guardarTolerancia, leerTolerancia } from './comparar.ts';

test('tolerancia: fija en centavos o % del valor del Excel, la que sea mayor', () => {
  assert.equal(fueraDeTolerancia(103_00, 100_00, 0, 3), false);   // 3 % justo: igual
  assert.equal(fueraDeTolerancia(103_01, 100_00, 0, 3), true);
  assert.equal(fueraDeTolerancia(96_99, 100_00, 0, 3), true);     // también para abajo
  assert.equal(fueraDeTolerancia(-103_00, -100_00, 0, 3), false); // saldos negativos
  assert.equal(fueraDeTolerancia(1, 0, 1, 3), false);             // con Excel en 0 queda la fija
  assert.equal(fueraDeTolerancia(2, 0, 1, 3), true);
  assert.equal(fueraDeTolerancia(101, 100, 0, 0), true);          // 0 %: exacto
});

test('tolerancia: 3 % si no se configuró; se guarda validada', () => {
  const db = abrirDb(':memory:');
  assert.equal(leerTolerancia(db), 3);
  guardarTolerancia(db, 5.5);
  assert.equal(leerTolerancia(db), 5.5);
  for (const malo of [-1, 51, NaN, '3', null]) assert.throws(() => guardarTolerancia(db, malo), /de 0 a 50 %/);
  assert.equal(leerTolerancia(db), 5.5);
});

const ARCHIVO = new URL('../../Archivos Originales/2026-04.xlsx', import.meta.url);

test('comparar con el Excel: abril armado en la base coincide salvo RIO y AND', { skip: !existsSync(ARCHIVO) && 'falta Archivos Originales/2026-04.xlsx' }, () => {
  const contenido = readFileSync(ARCHIVO);
  const db = abrirDb(':memory:');
  importarExcel(db, contenido);
  armarAbrilEnBase(db, contenido);
  guardarTolerancia(db, 0); // al centavo

  const r = compararConExcel(db, '2026-04', contenido);
  const distintos = r.deptos.filter((d) => d.estado !== 'igual');
  // RIO y AND: costos editados a mano en el Excel (DECISIONES). Todo lo demás coincide.
  assert.deepEqual(distintos.map((d) => [d.codigo, d.estado]), [['AND', 'distinto'], ['RIO', 'distinto']]);
  assert.ok(distintos.every((d) => d.diferencias.some((x) => x.campo === 'Costos operativos')));
  assert.equal(r.deptos.filter((d) => d.estado === 'igual').length, 22);

  // Un Excel de otro mes no se compara.
  assert.throws(() => compararConExcel(db, '2026-05', contenido), /El Excel es de 2026-04, no de 2026-05/);
});
