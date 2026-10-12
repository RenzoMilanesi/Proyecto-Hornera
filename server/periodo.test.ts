// Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { enPeriodo, SQL_EN_PERIODO } from './periodo.ts';

test('la regla de reserva del período da lo mismo en JS y en SQL', () => {
  const inicio = '2026-05-01', cierre = '2026-06-01';
  const casos: [string, string, boolean][] = [
    ['2026-04-20', '2026-05-01', false], // sale el día de inicio: 0 noches en mayo
    ['2026-04-28', '2026-05-03', true],  // cruza el inicio
    ['2026-05-10', '2026-05-15', true],  // adentro
    ['2026-05-28', '2026-06-04', true],  // cruza el cierre
    ['2026-06-01', '2026-06-05', false], // llega el día de cierre
    ['2026-05-31', '2026-05-31', true],  // cancelación de 0 noches que llegaba en mayo
    ['2026-06-01', '2026-06-01', false], // cancelación de 0 noches de junio
    ['2026-04-01', '2026-07-01', true],  // cubre todo el mes
  ];
  const consulta = new DatabaseSync(':memory:')
    .prepare(`SELECT ${SQL_EN_PERIODO} AS dentro FROM (SELECT :llegada AS llegada, :salida AS salida) r`);
  for (const [llegada, salida, esperado] of casos) {
    assert.equal(enPeriodo(llegada, salida, inicio, cierre), esperado, `JS ${llegada}→${salida}`);
    const { dentro } = consulta.get({ llegada, salida, inicio, cierre }) as { dentro: number };
    assert.equal(dentro === 1, esperado, `SQL ${llegada}→${salida}`);
  }
});
