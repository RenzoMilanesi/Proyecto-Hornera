// Cierre y reapertura del mes. Al cerrar, la liquidación de cada depto se guarda como
// snapshot (`liquidacion` + `liquidacion_reserva`) y el período queda congelado: los
// triggers de `movimiento` ya no dejan cargar ni cambiar nada salvo los pagos de liquidación.
// Reabrir borra el snapshot para recalcular (DECISIONES: "mes congelado, reabrible").
import type { DatabaseSync } from 'node:sqlite';
import { auditar } from '../auditoria.ts';
import { liquidarPeriodo } from './servicio.ts';

const ahora = () => new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19);
const centavos = (x: number) => Math.round(x) + 0; // los prorrateos del motor no son enteros

function enTransaccion<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

export function cerrarPeriodo(db: DatabaseSync, mes: string): { liquidaciones: number } {
  const p = db.prepare('SELECT id, estado FROM periodo WHERE mes = ?').get(mes) as { id: number; estado: string } | undefined;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  if (p.estado !== 'abierto') throw new Error(`El período ${mes} ya está cerrado.`);
  const anterior = db.prepare('SELECT mes, estado FROM periodo WHERE mes < ? ORDER BY mes DESC LIMIT 1').get(mes) as { mes: string; estado: string } | undefined;
  if (anterior && anterior.estado !== 'cerrado') {
    throw new Error(`Primero hay que cerrar ${anterior.mes}: el saldo de ${mes} parte del suyo.`);
  }
  const calculo = liquidarPeriodo(db, mes);
  if (calculo.cambio === null) throw new Error(calculo.avisos[0]);

  return enTransaccion(db, () => {
    const altaLiquidacion = db.prepare(`
      INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_no_disponibles,
        noches_ocupadas, noches_propietario, cant_reservas, ingresos_ars, ingresos_usd, costos_operativos,
        comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars, saldo_anterior_usd,
        movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd, calculada_en, propietario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT propietario_id FROM depto WHERE id = ?2)) RETURNING id`); // ?2 = depto_id: el dueño al cerrar
    const altaReserva = db.prepare(`
      INSERT INTO liquidacion_reserva(liquidacion_id, reserva_id, codigo_interno, noches_totales, noches_periodo, importe_ars,
        importe_periodo_ars, importe_usd, importe_periodo_usd, tarifa, tarifa_periodo, comision_ars, comision_usd, pago_plataforma_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const cuando = ahora();
    for (const d of calculo.deptos) {
      const r = d.resultado;
      const { id } = altaLiquidacion.get(
        p.id, d.deptoId, calculo.cambio, d.comisionPct, r.nochesDisponibles, d.nochesNoDisponibles,
        r.nochesOcupadas, r.nochesPropietario, r.reservas.length, centavos(r.ingresos.ars), centavos(r.ingresos.usd),
        r.costosOperativos, d.comisiones.ars, d.comisiones.usd, r.bruto, r.honorarios, d.saldoAnterior.ars, d.saldoAnterior.usd,
        d.movimientos.ars, d.movimientos.usd, centavos(r.conversion.ars), centavos(r.conversion.usd), r.saldo.ars, r.saldo.usd, cuando,
      ) as { id: number };
      r.reservas.forEach((l, i) => {
        const reserva = d.reservas[i];
        altaReserva.run(id, reserva.id, l.codigoInterno, l.nochesTotales, l.nochesPeriodo, l.importeArs, centavos(l.importePeriodoArs),
          l.importeUsd, centavos(l.importePeriodoUsd), l.tarifa, l.tarifaPeriodo, reserva.comision.ars, reserva.comision.usd, l.pagoPlataformaUsd);
      });
    }
    db.prepare(`UPDATE periodo SET estado = 'cerrado', cerrado_en = ? WHERE id = ?`).run(cuando, p.id);
    auditar(db, 'periodo', p.id, 'cierre', { estado: 'abierto' }, { estado: 'cerrado', liquidaciones: calculo.deptos.length });
    return { liquidaciones: calculo.deptos.length };
  });
}

export function reabrirPeriodo(db: DatabaseSync, mes: string) {
  const p = db.prepare('SELECT id, estado FROM periodo WHERE mes = ?').get(mes) as { id: number; estado: string } | undefined;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  if (p.estado !== 'cerrado') throw new Error(`El período ${mes} no está cerrado.`);
  // Un mes importado del Excel no tiene en la base con qué recalcularse: reabrirlo perdería su liquidación.
  const importado = db.prepare(`
    SELECT 1 FROM auditoria WHERE tabla = 'periodo' AND registro_id = ? AND json_extract(despues_json, '$.importacion') = 'excel'`).get(p.id);
  if (importado) throw new Error(`${mes} se importó del Excel: no se reabre (su liquidación es la del Excel).`);
  const siguiente = db.prepare('SELECT mes, estado FROM periodo WHERE mes > ? ORDER BY mes LIMIT 1').get(mes) as { mes: string; estado: string } | undefined;
  if (siguiente?.estado === 'cerrado') throw new Error(`Primero hay que reabrir ${siguiente.mes}: su saldo parte del de ${mes}.`);
  const pagados = db.prepare(`
    SELECT DISTINCT d.codigo FROM movimiento m JOIN depto d ON d.id = m.depto_id
    WHERE m.periodo_id = ? AND m.tipo = 'liquidacion' AND m.estado = 'vigente' ORDER BY d.codigo`).all(p.id) as { codigo: string }[];
  if (pagados.length) {
    throw new Error(`Hay liquidaciones de ${mes} pagadas (${pagados.map((x) => x.codigo).join(', ')}): anulá esos pagos antes de reabrir.`);
  }
  enTransaccion(db, () => {
    db.prepare('DELETE FROM liquidacion WHERE periodo_id = ?').run(p.id); // liquidacion_reserva se borra en cascada
    db.prepare(`UPDATE periodo SET estado = 'abierto', cerrado_en = NULL WHERE id = ?`).run(p.id);
    auditar(db, 'periodo', p.id, 'reapertura', { estado: 'cerrado' }, { estado: 'abierto' });
  });
}
