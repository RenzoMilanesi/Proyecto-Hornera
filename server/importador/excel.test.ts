// Correr: npm test
// Contra el export real de abril 2026 (no está en git: datos de propietarios). Sin el archivo, se saltea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { abrirDb } from '../db.ts';
import { importarExcel } from './excel.ts';

const ARCHIVO = new URL('../../Archivos Originales/2026-04.xlsx', import.meta.url);
const sinArchivo = !existsSync(ARCHIVO) && 'falta Archivos Originales/2026-04.xlsx';

test('importa abril 2026: maestros, período cerrado, movimientos y liquidaciones', { skip: sinArchivo }, () => {
  const db = abrirDb(':memory:');
  const r = importarExcel(db, readFileSync(ARCHIVO));

  assert.equal(r.mes, '2026-04');
  assert.equal(r.liquidaciones, 24);
  assert.ok(r.historico > 0);
  // Ningún depto con diferencias entre CORRIENTE y su hoja.
  assert.deepEqual(r.avisos.filter((a) => a.includes('no coinciden')), []);

  const periodo = db.prepare(`SELECT estado, tarifa_base, cm_fee_usd FROM periodo WHERE mes = '2026-04'`).get() as any;
  assert.deepEqual({ ...periodo }, { estado: 'cerrado', tarifa_base: 6978520, cm_fee_usd: 2000 });

  // OVL: saldo antes de pagar = la transferencia de abril, y el pago queda vinculado.
  const ovl = db.prepare(`
    SELECT l.saldo_final_ars, l.saldo_final_usd, m.importe_ars AS pago
    FROM liquidacion l JOIN depto d ON d.id = l.depto_id JOIN movimiento m ON m.id = l.movimiento_pago_id
    WHERE d.codigo = 'OVL'`).get() as any;
  assert.deepEqual({ ...ovl }, { saldo_final_ars: 84171700, saldo_final_usd: 0, pago: -84171700 });

  // Cada snapshot cierra igual que la hoja: J31..J34 + movimientos + cambio de moneda = saldo
  // (± 1 peso/dólar por el ROUND de J55/K55).
  const liqs = db.prepare(`SELECT d.codigo, l.* FROM liquidacion l JOIN depto d ON d.id = l.depto_id`).all() as any[];
  for (const l of liqs) {
    const ars = l.ingresos_ars - l.costos_operativos - l.comisiones_ars + l.honorarios
      + l.saldo_anterior_ars + l.movimientos_ars + l.conversion_ars;
    const usd = l.ingresos_usd - l.comisiones_usd + l.saldo_anterior_usd + l.movimientos_usd + l.conversion_usd;
    assert.ok(Math.abs(ars - l.saldo_final_ars) <= 100, `${l.codigo} ARS: ${ars} ≠ ${l.saldo_final_ars}`);
    assert.ok(Math.abs(usd - l.saldo_final_usd) <= 100, `${l.codigo} USD: ${usd} ≠ ${l.saldo_final_usd}`);
  }

  // Liquidan en USD los 5 deptos que el motor reconoció en abril.
  const enUsd = db.prepare(`
    SELECT group_concat(d.codigo) c FROM (SELECT d.codigo FROM depto d JOIN propietario p ON p.id = d.propietario_id
    WHERE p.moneda_liquidacion = 'USD' AND d.estado = 'activo' ORDER BY d.codigo) d`).get() as any;
  assert.equal(enUsd.c, 'COT,ITU,MAI,R64,S38');

  assert.throws(() => importarExcel(db, readFileSync(ARCHIVO)), /2026-04 ya está importado/);
});

test('un mes anterior al último importado no pisa los maestros; uno posterior sí', { skip: sinArchivo }, () => {
  const db = abrirDb(':memory:');
  importarExcel(db, readFileSync(ARCHIVO));
  // El mismo libro, corrido a otro mes y con OVL (Propiedades!C2) en otro estado.
  const comoMes = (inicio: string, cierre: string) => {
    const wb = XLSX.read(readFileSync(ARCHIVO), { type: 'buffer', cellFormula: true });
    const serial = (iso: string) => Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000);
    wb.Sheets['Datos balance'].B1 = { t: 'n', v: serial(inicio) };
    wb.Sheets['Datos balance'].B2 = { t: 'n', v: serial(cierre) };
    wb.Sheets.Propiedades.C2 = { t: 's', v: 'Pausado' };
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const estadoOvl = () => (db.prepare(`SELECT estado FROM depto WHERE codigo = 'OVL'`).get() as any).estado;

  const marzo = importarExcel(db, comoMes('2026-03-01', '2026-04-01'));
  assert.equal(estadoOvl(), 'activo');
  assert.ok(marzo.avisos.some((a) => a.includes('anterior al último mes importado (2026-04)')));

  importarExcel(db, comoMes('2026-06-01', '2026-07-01'));
  assert.equal(estadoOvl(), 'pausado');
});

test('un archivo que no es el Excel de liquidaciones no importa nada', () => {
  const db = abrirDb(':memory:');
  assert.throws(() => importarExcel(db, Buffer.from('a,b\n1,2')), /falta la hoja "Datos balance"/);
  assert.equal((db.prepare('SELECT count(*) n FROM periodo').get() as any).n, 0);
});
