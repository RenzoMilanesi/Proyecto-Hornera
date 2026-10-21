// Correr: node --test server/liquidacion/motor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liquidar, cambioDelPeriodo, cuentaLiquidacion, redondeoCuenta, type ParametrosPeriodo } from './motor.ts';

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
  // La cuenta explícita cierra con el saldo (OVL liquida en pesos y no tiene saldo anterior).
  assert.deepEqual(cuentaLiquidacion(r.bruto, r.gastosDirectos, r.honorarios, { ars: c(-10400), usd: 0 }, abril.cambio), {
    ingresosOperativos: c(1245787), costos: c(-180670), ingresoBruto: c(1065117), honorarios: c(-213000),
    valorInicial: c(852117), excepcionales: c(-10400), valorFinal: r.saldo.ars,
  });
});

test('los costos excepcionales en dólares pasan a pesos al cambio del período', () => {
  assert.equal(cuentaLiquidacion(0, 0, 0, { ars: c(-1000), usd: c(-10) }, 1400).excepcionales, c(-15000));
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

test('el renglón Redondeo cierra la cuenta con el saldo cuando los redondeos del Excel no coinciden', () => {
  // Bruto [F18] redondeado y gastos directos [F19] truncados; el saldo [J55] sale de los valores exactos.
  const p = { ...abril, cambio: 1400.6, tarifaBase: c(70000), adicionalHuesped: 0, cargoTramo1: 0, cargoTramo2: 0 };
  const r = liquidar({
    periodo: p,
    depto: { codigo: 'XXX', comisionPct: 0.2, monedaLiquidacion: 'ARS', comisionCobroUsdPct: 0, nochesNoDisponibles: 0 },
    reservas: [{ llegada: '2026-04-05', salida: '2026-04-08', huespedes: 2, canal: 'A', ars: 0, ajusteArs: 0, usd: c(100.84), ajusteUsd: 0, pagoPlataformaUsd: 0 }],
    comisiones: { ars: 0, usd: c(5.23) },
    movimientos: [],
  });
  const cuenta = cuentaLiquidacion(r.bruto, r.gastosDirectos, r.honorarios, { ars: 0, usd: 0 }, p.cambio);
  const redondeo = redondeoCuenta(cuenta, { ars: 0, usd: 0 }, r.saldo.ars, p.cambio);
  assert.equal(redondeo, c(-1));
  assert.equal(cuenta.valorFinal + redondeo, r.saldo.ars);
});

// La regresión contra las 24 hojas de abril está en regresion.test.ts (importador + motor).
