// Correr: npm test
// Regresión de abril 2026: el importador guarda período, deptos, propietarios y
// movimientos; con eso (más las reservas de la hoja RESERVAS) el motor tiene que dar
// lo mismo que cada hoja de depto del Excel. Es el camino que usa la fase 5.
// El Excel real no está en git (datos de propietarios): sin él, el test se saltea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { abrirDb } from '../db.ts';
import { importarExcel } from '../importador/excel.ts';
import { cambioDelPeriodo, liquidar, type ReservaEntrada } from './motor.ts';

const ARCHIVO = new URL('../../Archivos Originales/2026-04.xlsx', import.meta.url);
// Hojas con costos editados a mano en el Excel (−124.008 tipeado en Z14 y, en AND,
// J32 = Z57 en vez de −Z57): ahí solo se comparan ingresos y noches. Ver DECISIONES.md.
const COSTOS_EDITADOS = new Set(['RIO', 'AND']);

const serialAIso = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);

// Reservas de la hoja RESERVAS (desde la fila 3; la 2 es "NO TOCAR FILA"), en centavos.
function reservasDelExcel(contenido: Buffer): Map<string, ReservaEntrada[]> {
  const h = XLSX.read(contenido, { type: 'buffer' }).Sheets.RESERVAS;
  const num = (ref: string) => (typeof h[ref]?.v === 'number' ? h[ref].v : 0);
  const c = (ref: string) => Math.round(num(ref) * 100);
  const porDepto = new Map<string, ReservaEntrada[]>();
  for (let f = 3; f <= XLSX.utils.decode_range(h['!ref']!).e.r + 1; f++) {
    if (typeof h[`D${f}`]?.v !== 'number') continue;
    const depto = String(h[`B${f}`]?.v ?? '');
    porDepto.set(depto, [...(porDepto.get(depto) ?? []), {
      llegada: serialAIso(num(`D${f}`)), salida: serialAIso(num(`E${f}`)), huespedes: num(`G${f}`),
      canal: String(h[`X${f}`]?.v ?? ''), ars: c(`N${f}`), ajusteArs: c(`O${f}`), usd: c(`R${f}`),
      ajusteUsd: c(`S${f}`), pagoPlataformaUsd: c(`Y${f}`),
    }]);
  }
  return porDepto;
}

test('abril 2026: importador + motor reproducen las 24 hojas del Excel', { skip: !existsSync(ARCHIVO) && 'falta Archivos Originales/2026-04.xlsx' }, () => {
  const contenido = readFileSync(ARCHIVO);
  const db = abrirDb(':memory:');
  importarExcel(db, contenido);
  const reservas = reservasDelExcel(contenido);

  const p = db.prepare(`SELECT * FROM periodo WHERE mes = '2026-04'`).get() as any;
  const periodo = {
    inicio: p.fecha_inicio, cierre: p.fecha_cierre_reservas, cambio: cambioDelPeriodo(p.usd_cotizacion, p.usd_descuento_pct),
    tarifaBase: p.tarifa_base, adicionalHuesped: p.adicional_huesped,
    nochesTramo1: p.noches_tramo_1, cargoTramo1: p.cargo_tramo_1, nochesTramo2: p.noches_tramo_2, cargoTramo2: p.cargo_tramo_2,
  };
  const liquidaciones = db.prepare(`
    SELECT d.id AS depto_id, d.codigo, d.comision_pct, d.tarifa_base_override, d.adicional_huesped_override,
           pr.moneda_liquidacion, pr.comision_cobro_usd_pct, l.*
    FROM liquidacion l JOIN depto d ON d.id = l.depto_id JOIN propietario pr ON pr.id = d.propietario_id
    WHERE l.periodo_id = ?`).all(p.id) as any[];
  const movimientos = db.prepare(`
    SELECT importe_ars AS ars, importe_usd AS usd FROM movimiento
    WHERE periodo_id = ? AND depto_id = ? AND tipo <> 'liquidacion' AND estado = 'vigente'`);
  assert.equal(liquidaciones.length, 24);

  const errores: string[] = [];
  for (const l of liquidaciones) {
    const r = liquidar({
      periodo,
      depto: {
        codigo: l.codigo, comisionPct: l.comision_pct, tarifaBaseOverride: l.tarifa_base_override,
        adicionalHuespedOverride: l.adicional_huesped_override, monedaLiquidacion: l.moneda_liquidacion,
        comisionCobroUsdPct: l.comision_cobro_usd_pct, nochesNoDisponibles: l.noches_no_disponibles,
      },
      reservas: reservas.get(l.codigo) ?? [],
      comisiones: { ars: l.comisiones_ars, usd: l.comisiones_usd },
      movimientos: movimientos.all(p.id, l.depto_id) as { ars: number; usd: number }[],
    });
    // [campo, motor, snapshot del Excel, tolerancia en centavos]
    const comparar: [string, number, number, number][] = [
      ['ingresosArs', r.ingresos.ars, l.ingresos_ars, 1],
      ['ingresosUsd', r.ingresos.usd, l.ingresos_usd, 1],
      ['nochesOcupadas', r.nochesOcupadas, l.noches_ocupadas, 0],
      ['nochesDisponibles', r.nochesDisponibles, l.noches_disponibles, 0],
    ];
    if (!COSTOS_EDITADOS.has(l.codigo)) {
      comparar.push(
        ['costosOperativos', r.costosOperativos, l.costos_operativos, 0],
        ['bruto', r.bruto, l.bruto, 0],
        ['honorarios', r.honorarios, l.honorarios, 0],
        ['conversionArs', r.conversion.ars, l.conversion_ars, 1],
        ['conversionUsd', r.conversion.usd, l.conversion_usd, 1],
        ['saldoArs', r.saldo.ars, l.saldo_final_ars, 0],
        ['saldoUsd', r.saldo.usd, l.saldo_final_usd, 0],
      );
    }
    for (const [campo, motor, excel, tol] of comparar) {
      if (Math.abs(motor - excel) > tol) errores.push(`${l.codigo}.${campo}: motor ${motor} ≠ Excel ${excel}`);
    }
  }
  assert.deepEqual(errores, []);
});
