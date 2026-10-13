// Motor de liquidación mensual por depto. Función pura: sin DB ni I/O.
// Reproduce la hoja por depto del Google Sheet (abril 2026). Las referencias
// entre corchetes [F18], [J34]... son las celdas del Excel que replica cada paso.
//
// Unidades: importes en CENTAVOS (como en la DB). Los cálculos intermedios son
// float, igual que en el Excel; solo se redondea donde el Excel redondea.

export type Centavos = number;
export type Moneda = 'ARS' | 'USD';

export interface ParametrosPeriodo {
  inicio: string;            // '2026-04-01'
  cierre: string;            // '2026-05-01' (exclusivo)
  cambio: number;            // ARS por USD ya con descuento [Datos balance B6]
  tarifaBase: Centavos;      // [B15]
  adicionalHuesped: Centavos; // [B9] por cada par de huéspedes extra
  nochesTramo1: number;      // [A17]
  cargoTramo1: Centavos;     // [B17]
  nochesTramo2: number;      // [A18]
  cargoTramo2: Centavos;     // [B18]
}

export interface ConfigDepto {
  codigo: string;
  comisionPct: number;                 // 0.20
  tarifaBaseOverride?: Centavos | null;
  adicionalHuespedOverride?: Centavos | null;
  monedaLiquidacion: Moneda;           // ARS: el USD se pasa a ARS. USD: el ARS se pasa a USD
  comisionCobroUsdPct: number;         // R64: 0.04 → cambio / 0,96 al pasar a USD
  nochesNoDisponibles: number;         // [B24]
}

export interface ReservaEntrada {
  llegada: string;
  salida: string;
  huespedes: number;
  canal: string;                       // código de plataforma: A, B, W, P...
  ars: Centavos;                       // Total a facturar ARS [N]
  ajusteArs: Centavos;                 // Corrección pago ARS [O]
  usd: Centavos;                       // [R]
  ajusteUsd: Centavos;                 // [S]
  pagoPlataformaUsd: Centavos;         // Pago x plataforma [Y]
}

export interface Importe { ars: Centavos; usd: Centavos }

export interface EntradaLiquidacion {
  periodo: ParametrosPeriodo;
  depto: ConfigDepto;
  reservas: ReservaEntrada[];          // ya filtradas con la regla de server/periodo.ts
  comisiones: Importe;                 // OTAs/agentes/CM, positivas [NO COMISIONABLES E/F]
  movimientos: Importe[];              // saldo anterior + CORRIENTE, con signo. SIN los pagos de liquidación
}

export interface LineaReserva {
  codigoInterno: string;
  nochesTotales: number;
  nochesPeriodo: number;
  importeArs: Centavos;
  importePeriodoArs: Centavos;
  importeUsd: Centavos;
  importePeriodoUsd: Centavos;
  tarifa: Centavos;
  tarifaPeriodo: Centavos;
  pagoPlataformaUsd: Centavos;
}

export interface ResultadoLiquidacion {
  reservas: LineaReserva[];
  ingresos: Importe;                   // [J31] [K31]
  costosOperativos: Centavos;          // [Z57]
  bruto: Centavos;                     // [F18]
  gastosDirectos: Centavos;            // [F19] (negativo)
  honorarios: Centavos;                // [J34] (negativo)
  saldoParcial: Centavos;              // [F22]
  conversion: Importe;                 // fila "Cambio moneda" [J53] [K53]
  saldo: Importe;                      // [J55] [K55] antes del pago: >0 se le paga, <0 debe
  nochesDisponibles: number;           // [B23]
  nochesOcupadas: number;              // [B26]
  nochesPropietario: number;           // [B25]
  ocupacion: number;                   // [E25]
}

const DIA = 86_400_000;
const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA);
// Tolerancia para que 8014,9999999 (float) no trunque a 8014 donde Excel da 8015.
const EPS = 1e-6;
const truncar = (x: number) => Math.trunc(x + Math.sign(x) * EPS);
// ROUNDDOWN(pesos, 0) y ROUND(pesos, 0) de Excel, operando en centavos.
// `+ 0` convierte −0 en 0 (si no, la pantalla muestra "-$ 0,00").
export const truncPesos = (c: number): Centavos => truncar(c / 100) * 100 + 0;
export const redondearPesos = (c: number): Centavos => Math.sign(c) * Math.round(Math.abs(c) / 100) * 100 + 0;
const redondearUsd = redondearPesos; // K55 también redondea a unidades

export function liquidar(e: EntradaLiquidacion): ResultadoLiquidacion {
  const { periodo: p, depto: d } = e;
  const tarifaBase = d.tarifaBaseOverride ?? p.tarifaBase;
  const adicional = d.adicionalHuespedOverride ?? p.adicionalHuesped;

  const reservas = e.reservas.map((r): LineaReserva => {
    const total = dias(r.llegada, r.salida);                                   // [H]
    // [K] = H − I − J del Excel, calculado como superposición para que una
    // reserva entera fuera del período dé 0 y no noches negativas.
    const desde = r.llegada > p.inicio ? r.llegada : p.inicio;
    const hasta = r.salida < p.cierre ? r.salida : p.cierre;
    const enPeriodo = Math.max(0, dias(desde, hasta));
    const proporcion = total === 0 ? 1 : enPeriodo / total;
    const importeArs = r.ars + r.ajusteArs;                                    // [P]
    const importeUsd = r.usd + r.ajusteUsd;                                    // [T]
    const tramo = (noches: number, cargo: number) => (total / noches < 1 ? 0 : (total / noches) * cargo);
    // [V] ROUNDDOWN(base + pares extra × adicional + tramos por largo de estadía)
    // ponytail: reserva de 0 noches (cancelación "-C") no lleva tarifa; en el Excel da #DIV/0.
    const tarifa = total === 0 ? 0 : truncPesos(
      tarifaBase + Math.max(0, Math.ceil(r.huespedes / 2 - 1)) * adicional +
      tramo(p.nochesTramo1, p.cargoTramo1) + tramo(p.nochesTramo2, p.cargoTramo2));
    return {
      codigoInterno: codigoInterno(r, d.codigo, total, enPeriodo < total),
      nochesTotales: total,
      nochesPeriodo: enPeriodo,
      importeArs,
      importePeriodoArs: importeArs * proporcion,                              // [Q]
      importeUsd,
      importePeriodoUsd: importeUsd * proporcion,                              // [U]
      tarifa,
      tarifaPeriodo: total === 0 ? 0 : truncPesos(tarifa * proporcion),       // [W]
      pagoPlataformaUsd: r.pagoPlataformaUsd,                                  // [Y], informativo para el PDF
    };
  });

  const suma = (f: (l: LineaReserva) => number) => reservas.reduce((s, l) => s + f(l), 0);
  const ingresos = { ars: suma((l) => l.importePeriodoArs), usd: suma((l) => l.importePeriodoUsd) };
  const costosOperativos = suma((l) => l.tarifaPeriodo);

  const bruto = redondearPesos(ingresos.ars + ingresos.usd * p.cambio);                                // [F18]
  const gastosDirectos = truncPesos(-costosOperativos - e.comisiones.ars - e.comisiones.usd * p.cambio); // [F19]
  // [J34] honorarios redondeados a centenas de pesos hacia cero.
  const base = ingresos.ars - costosOperativos - e.comisiones.ars + (ingresos.usd - e.comisiones.usd) * p.cambio;
  const honorarios = -truncar(base * d.comisionPct / 10_000) * 10_000 + 0;

  // Detalle ingresos/egresos [J31:K52] sin pagos, y conversión a la moneda de liquidación [53].
  const lineasArs = ingresos.ars - costosOperativos - e.comisiones.ars + honorarios + e.movimientos.reduce((s, m) => s + m.ars, 0);
  const lineasUsd = ingresos.usd - e.comisiones.usd + e.movimientos.reduce((s, m) => s + m.usd, 0);
  let conversion: Importe;
  let saldo: Importe;
  if (d.monedaLiquidacion === 'ARS') {
    conversion = { ars: lineasUsd * p.cambio, usd: -lineasUsd };
    saldo = { ars: redondearPesos(lineasArs + conversion.ars), usd: 0 };
  } else {
    const cambioUsd = p.cambio / (1 - d.comisionCobroUsdPct);
    conversion = { ars: -lineasArs, usd: lineasArs / cambioUsd };
    saldo = { ars: 0, usd: redondearUsd(lineasUsd + conversion.usd) };
  }

  const total = dias(p.inicio, p.cierre);
  const nochesDisponibles = total - d.nochesNoDisponibles;
  const nochesOcupadas = suma((l) => l.nochesPeriodo);
  const nochesPropietario = reservas.reduce((s, l, i) => s + (e.reservas[i].canal === 'P' ? l.nochesPeriodo : 0), 0);

  return {
    reservas, ingresos, costosOperativos, bruto, gastosDirectos, honorarios,
    saldoParcial: bruto + gastosDirectos + honorarios,
    conversion, saldo,
    nochesDisponibles, nochesOcupadas, nochesPropietario,
    ocupacion: nochesDisponibles === 0 ? 0 : nochesOcupadas / nochesDisponibles,
  };
}

// [A] de RESERVAS: 260329OVL1X10NW  DIV  (llegada yymmdd, depto, huéspedes, noches, canal).
function codigoInterno(r: ReservaEntrada, depto: string, noches: number, dividida: boolean): string {
  const yymmdd = r.llegada.slice(2).replaceAll('-', '');
  const base = `${yymmdd}${depto}${r.huespedes}X${String(noches).padStart(2, '0')}N${r.canal}`;
  return `${base}${noches === 0 ? '-C' : ''} ${dividida ? ' DIV' : ''}`;
}

export const cambioDelPeriodo = (cotizacionUsd: number, descuentoPct: number) => cotizacionUsd * (1 - descuentoPct);
