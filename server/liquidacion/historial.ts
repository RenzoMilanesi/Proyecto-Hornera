// Historial de pagos de un depto o de un propietario: una fila por mes y depto con lo liquidado,
// lo pagado y lo pendiente. Los meses cerrados salen de Transferencias (con el dueño de ese mes);
// el abierto, del cálculo en curso. Solo meses que están en la app (no `historico_mensual`).
import type { DatabaseSync } from 'node:sqlite';
import { listarTransferencias, type Transferencia } from './pagos.ts';
import { liquidarPeriodo } from './servicio.ts';

export interface FilaHistorial {
  mes: string;
  liquidacionId: number | null;      // null en el mes en curso (todavía no hay liquidación guardada)
  deptoId: number;
  codigo: string;
  depto: string;
  propietarioId: number;
  propietario: string;
  cbu: string | null;
  esHornera: boolean;
  moneda: 'ARS' | 'USD';
  saldo: number;                     // centavos: >0 se le paga, <0 debe
  pagado: number;
  pendiente: number;
  estado: 'pagado' | 'parcial' | 'pendiente' | 'debe' | 'arrastrado' | 'en_curso';
  arrastradoA: string | null;
  pagos: (Transferencia['pagos'][number] & { anulado: boolean })[];
}

export function historial(db: DatabaseSync, filtro: { deptoId?: number; propietarioId?: number }, anulados: boolean): FilaHistorial[] {
  if (!filtro.deptoId && !filtro.propietarioId) throw new Error('Elegí un depto o un propietario.');
  const pasa = (deptoId: number, propietarioId: number) =>
    (!filtro.deptoId || deptoId === filtro.deptoId) && (!filtro.propietarioId || propietarioId === filtro.propietarioId);
  const filas: FilaHistorial[] = [];

  // Mes en curso: saldo estimado, sin pagos (solo se pagan meses cerrados). Por propietario: el dueño actual.
  const abierto = db.prepare(`SELECT mes FROM periodo WHERE estado = 'abierto' ORDER BY mes DESC LIMIT 1`).get() as { mes: string } | undefined;
  if (abierto) {
    const calculo = liquidarPeriodo(db, abierto.mes);
    const duenios = db.prepare(`
      SELECT d.id, d.propietario_id, pr.cbu, pr.es_hornera FROM depto d JOIN propietario pr ON pr.id = d.propietario_id`).all() as any[];
    const duenio = new Map(duenios.map((d) => [d.id as number, d]));
    for (const d of calculo.deptos) {
      const x = duenio.get(d.deptoId);
      if (!x || !pasa(d.deptoId, x.propietario_id)) continue;
      const saldo = d.moneda === 'USD' ? d.resultado.saldo.usd : d.resultado.saldo.ars;
      filas.push({
        mes: abierto.mes, liquidacionId: null, deptoId: d.deptoId, codigo: d.codigo, depto: d.nombre, propietarioId: x.propietario_id,
        propietario: d.propietario, cbu: x.cbu, esHornera: !!x.es_hornera, moneda: d.moneda, saldo, pagado: 0, pendiente: saldo,
        estado: 'en_curso', arrastradoA: null, pagos: [],
      });
    }
  }

  // ponytail: una consulta de transferencias por mes cerrado; alcanza para años de meses, una sola consulta si crece a cientos.
  const cerrados = db.prepare(`SELECT id, mes FROM periodo WHERE estado = 'cerrado' ORDER BY mes DESC`).all() as { id: number; mes: string }[];
  const anuladosDe = db.prepare(`
    SELECT m.id, m.fecha, m.importe_ars, m.importe_usd, c.nombre AS cuenta FROM movimiento m LEFT JOIN cuenta c ON c.id = m.cuenta_id
    WHERE m.periodo_id = ? AND m.depto_id = ? AND m.tipo = 'liquidacion' AND m.estado = 'anulado' ORDER BY m.fecha, m.id`);
  for (const p of cerrados) {
    for (const t of listarTransferencias(db, p.mes)) {
      if (!pasa(t.deptoId, t.propietarioId)) continue;
      // Un anulado con la factura vigente ya viene de Transferencias (siempre se ve: falta su NC).
      const pagos = t.pagos.map((x) => ({ ...x, anulado: !!x.anulado }));
      if (anulados) {
        for (const m of anuladosDe.all(p.id, t.deptoId) as any[]) {
          if (pagos.some((x) => x.id === m.id)) continue;
          pagos.push({ id: m.id, fecha: m.fecha, importe: -(t.moneda === 'USD' ? m.importe_usd : m.importe_ars), cuenta: m.cuenta, anulado: true });
        }
        pagos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
      }
      const estado = t.saldo < 0 ? 'debe' : t.pendiente === 0 ? 'pagado' : t.arrastradoA ? 'arrastrado' : t.pagado > 0 ? 'parcial' : 'pendiente';
      filas.push({
        mes: p.mes, liquidacionId: t.liquidacionId, deptoId: t.deptoId, codigo: t.codigo, depto: t.depto, propietarioId: t.propietarioId,
        propietario: t.propietario, cbu: t.cbu, esHornera: t.esHornera, moneda: t.moneda, saldo: t.saldo, pagado: t.pagado,
        pendiente: t.pendiente, estado, arrastradoA: t.arrastradoA, pagos,
      });
    }
  }
  return filas;
}
