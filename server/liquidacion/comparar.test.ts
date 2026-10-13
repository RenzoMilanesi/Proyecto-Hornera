// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { abrirDb } from '../db.ts';
import { importarExcel } from '../importador/excel.ts';
import { armarAbrilEnBase } from './abril-en-base.ts';
import { compararConExcel } from './comparar.ts';

const ARCHIVO = new URL('../../Archivos Originales/2026-04.xlsx', import.meta.url);

test('comparar con el Excel: abril armado en la base coincide salvo RIO y AND', { skip: !existsSync(ARCHIVO) && 'falta Archivos Originales/2026-04.xlsx' }, () => {
  const contenido = readFileSync(ARCHIVO);
  const db = abrirDb(':memory:');
  importarExcel(db, contenido);
  armarAbrilEnBase(db, contenido);

  const r = compararConExcel(db, '2026-04', contenido);
  const distintos = r.deptos.filter((d) => d.estado !== 'igual');
  // RIO y AND: costos editados a mano en el Excel (DECISIONES). Todo lo demás coincide.
  assert.deepEqual(distintos.map((d) => [d.codigo, d.estado]), [['AND', 'distinto'], ['RIO', 'distinto']]);
  assert.ok(distintos.every((d) => d.diferencias.some((x) => x.campo === 'Costos operativos')));
  assert.equal(r.deptos.filter((d) => d.estado === 'igual').length, 22);

  // Un Excel de otro mes no se compara.
  assert.throws(() => compararConExcel(db, '2026-05', contenido), /El Excel es de 2026-04, no de 2026-05/);
});
