// Correr: node --test server/liquidacion/motor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { liquidar, cambioDelPeriodo, type EntradaLiquidacion, type ParametrosPeriodo } from './motor.ts';

const c = (pesos: number) => Math.round(pesos * 100); // pesos → centavos

const abril: ParametrosPeriodo = {
  inicio: '2026-04-01', cierre: '2026-05-01', cambio: cambioDelPeriodo(1490, 0.06),
  tarifaBase: c(69785.2), adicionalHuesped: c(10364.2),
  nochesTramo1: 10, cargoTramo1: c(10364.2), nochesTramo2: 28, cargoTramo2: c(10364.2),
};

test('OVL abril 2026 da lo mismo que la hoja del Excel', () => {
  const r = liquidar({
    periodo: abril,
    depto: { codigo: 'OVL', comisionPct: 0.2, monedaLiquidacion: 'ARS', comisionCobroUsdPct: 0, nochesNoDisponibles: 0 },
    reservas: [
      { llegada: '2026-03-29', salida: '2026-04-08', huespedes: 1, canal: 'W', ars: c(345160), ajusteArs: 0, usd: 0, ajusteUsd: 0, pagoPlataformaUsd: 0 },
      { llegada: '2026-04-09', salida: '2026-05-02', huespedes: 1, canal: 'D', ars: 0, ajusteArs: 0, usd: c(749.55), ajusteUsd: 0, pagoPlataformaUsd: 0 },
    ],
    comisiones: { ars: 0, usd: c(25) },
    movimientos: [{ ars: c(-10400), usd: 0 }],
  });
  assert.deepEqual(r.reservas.map((l) => [l.codigoInterno, l.nochesPeriodo, l.tarifa, l.tarifaPeriodo]), [
    ['260329OVL1X10NW  DIV', 7, c(80149), c(56104)],
    ['260409OVL1X23ND  DIV', 22, c(93622), c(89551)],
  ]);
  assert.equal(r.costosOperativos, c(145655));
  assert.equal(r.bruto, c(1245787));
  assert.equal(r.gastosDirectos, c(-180670));
  assert.equal(r.honorarios, c(-213000));
  assert.equal(r.saldoParcial, c(852117));
  assert.deepEqual(r.saldo, { ars: c(841717), usd: 0 }); // el Excel muestra 0 porque ya resta la transferencia
  assert.equal(r.nochesOcupadas, 29);
  assert.equal(r.ocupacion, 29 / 30);
});

test('una reserva fuera del período no suma noches ni ingresos', () => {
  const r = liquidar({
    periodo: abril,
    depto: { codigo: 'OVL', comisionPct: 0.2, monedaLiquidacion: 'ARS', comisionCobroUsdPct: 0, nochesNoDisponibles: 0 },
    reservas: [{ llegada: '2026-03-20', salida: '2026-03-25', huespedes: 2, canal: 'A', ars: c(100000), ajusteArs: 0, usd: 0, ajusteUsd: 0, pagoPlataformaUsd: 0 }],
    comisiones: { ars: 0, usd: 0 },
    movimientos: [],
  });
  assert.equal(r.nochesOcupadas, 0);
  assert.equal(r.ingresos.ars, 0);
  assert.equal(r.costosOperativos, 0);
});

// Regresión contra todas las hojas por depto. El fixture sale de
// scripts/extraer_fixture_excel.py y no está en git (montos reales).
const FIXTURE = new URL('../../tests/fixtures/2026-04.json', import.meta.url);

test('abril 2026: los 24 deptos coinciden con el Excel', { skip: !existsSync(FIXTURE) && 'falta tests/fixtures/2026-04.json' }, () => {
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const p = fx.periodo;
  const periodo: ParametrosPeriodo = {
    inicio: p.inicio, cierre: p.cierre, cambio: cambioDelPeriodo(p.cotizacionUsd, p.descuentoUsdPct),
    tarifaBase: c(p.tarifaBase), adicionalHuesped: c(p.adicionalHuesped),
    nochesTramo1: p.nochesTramo1, cargoTramo1: c(p.cargoTramo1), nochesTramo2: p.nochesTramo2, cargoTramo2: c(p.cargoTramo2),
  };
  const errores: string[] = [];
  for (const [codigo, d] of Object.entries<any>(fx.deptos)) {
    const entrada: EntradaLiquidacion = {
      periodo,
      depto: { codigo, ...d.config, nochesNoDisponibles: d.config.noDisponibles },
      reservas: d.reservas.map((r: any) => ({
        ...r, ars: c(r.ars), ajusteArs: c(r.ajusteArs), usd: c(r.usd), ajusteUsd: c(r.ajusteUsd), pagoPlataformaUsd: c(r.pagoPlataformaUsd),
      })),
      comisiones: { ars: c(d.comisiones.ars), usd: c(d.comisiones.usd) },
      movimientos: d.movimientos.map((m: any) => ({ ars: c(m.ars), usd: c(m.usd) })),
    };
    const r = liquidar(entrada);
    const x = d.esperado;
    const pagado = d.pagos.reduce((s: any, m: any) => ({ ars: s.ars + m.ars, usd: s.usd + m.usd }), { ars: 0, usd: 0 });
    const comparar: [string, number, number, number][] = [
      // [campo, obtenido, esperado, tolerancia en centavos]
      ['ingresosArs', r.ingresos.ars, c(x.ingresosArs), 1],
      ['ingresosUsd', r.ingresos.usd, c(x.ingresosUsd), 1],
      ['costosOperativos', r.costosOperativos, c(x.costosOperativos), 0],
      ['bruto', r.bruto, c(x.bruto), 0],
      ['gastosDirectos', r.gastosDirectos, c(x.gastosDirectos), 0],
      ['honorarios', r.honorarios, c(x.honorarios), 0],
      ['saldoParcial', r.saldoParcial, c(x.saldoParcial), 0],
      ['conversionArs', r.conversion.ars, c(x.conversionArs), 1],
      ['conversionUsd', r.conversion.usd, c(x.conversionUsd), 1],
      ['saldoArs', r.saldo.ars, c(x.saldoArs - pagado.ars), 0],
      ['saldoUsd', r.saldo.usd, c(x.saldoUsd - pagado.usd), 0],
      ['nochesOcupadas', r.nochesOcupadas, x.nochesOcupadas, 0],
      ['nochesDisponibles', r.nochesDisponibles, x.nochesDisponibles, 0],
    ];
    // RIO y AND: hojas con los costos editados a mano (−124.008 tipeado en Z14 y,
    // en AND, J32 = Z57 en vez de −Z57). Parece un resto de copiar la hoja; el
    // motor no lo replica. Ahí solo se comparan ingresos y noches (la tarifa por
    // reserva del motor coincide con la columna W de RESERVAS, verificado a mano).
    if (d.costosEditados) {
      comparar.splice(0, comparar.length, ...comparar.filter(([campo]) => campo.startsWith('ingresos') || campo.startsWith('noches')));
    }
    for (const [campo, obtenido, esperado, tol] of comparar) {
      const enPesos = !campo.startsWith('noches');
      if (Math.abs(obtenido - esperado) > tol) {
        errores.push(`${codigo}.${campo}: ${enPesos ? obtenido / 100 : obtenido} ≠ ${enPesos ? esperado / 100 : esperado}`);
      }
    }
  }
  assert.deepEqual(errores, []);
});
