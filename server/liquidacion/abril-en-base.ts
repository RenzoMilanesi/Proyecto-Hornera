// Solo para tests: arma abril 2026 en la base como si viniera de Stays (reservas de la hoja
// RESERVAS con su cobro como pago, comisiones de NO COMISIONABLES como ajuste de la primera
// reserva del depto que llega en abril y noches no disponibles como bloqueos). Requiere el Excel ya importado.
import type { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';

export function armarAbrilEnBase(db: DatabaseSync, contenido: Buffer) {
  const wb = XLSX.read(contenido, { type: 'buffer' });
  const res = wb.Sheets.RESERVAS;
  const num = (h: XLSX.WorkSheet, ref: string) => (typeof h[ref]?.v === 'number' ? h[ref].v : 0);
  const c = (h: XLSX.WorkSheet, ref: string) => Math.round(num(h, ref) * 100);
  const iso = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);

  db.exec(`INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda) VALUES ('ars', 'ARS', 'bank', 'ARS'), ('usd', 'USD', 'bank', 'USD')`);
  const deptoId = new Map((db.prepare('SELECT codigo, id FROM depto').all() as any[]).map((d) => [d.codigo, d.id]));
  const plataformaId = new Map((db.prepare('SELECT codigo, min(id) id FROM plataforma GROUP BY codigo').all() as any[]).map((p) => [p.codigo, p.id]));
  const altaReserva = db.prepare(`
    INSERT INTO reserva(codigo, depto_id, plataforma_id, llegada, salida, huespedes, moneda, ajuste_ars, ajuste_usd, raw_json, sincronizada_en)
    VALUES (?, ?, ?, ?, ?, ?, 'ARS', ?, ?, '{}', 'x') RETURNING id`);
  const altaPago = db.prepare(`INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, importe, raw_json) VALUES (?, ?, ?, 'credit', 'completed', ?, '{}')`);
  const primeraReserva = new Map<string, number>();
  for (let f = 3; f <= XLSX.utils.decode_range(res['!ref']!).e.r + 1; f++) {
    const depto = String(res[`B${f}`]?.v ?? '');
    if (typeof res[`D${f}`]?.v !== 'number' || !deptoId.has(depto)) continue;
    const { id } = altaReserva.get(`F${f}`, deptoId.get(depto), plataformaId.get(String(res[`X${f}`]?.v ?? '')) ?? null,
      iso(num(res, `D${f}`)), iso(num(res, `E${f}`)), num(res, `G${f}`), c(res, `O${f}`), c(res, `S${f}`)) as { id: number };
    if (c(res, `N${f}`)) altaPago.run(`a${f}`, id, 1, c(res, `N${f}`));
    if (c(res, `R${f}`)) altaPago.run(`u${f}`, id, 2, c(res, `R${f}`));
    // La comisión va en la primera reserva que llega en abril (la que viene de marzo no la paga en abril).
    if (!primeraReserva.has(depto) && iso(num(res, `D${f}`)) >= '2026-04-01') primeraReserva.set(depto, id);
  }
  // Comisiones cargadas a mano en el Excel (Booking reducida + Alq. Argentina + otros agentes).
  const nc = wb.Sheets['NO COMISIONABLES'];
  for (let f = 2; f <= XLSX.utils.decode_range(nc['!ref']!).e.r + 1; f++) {
    const total = c(nc, `B${f}`) + c(nc, `C${f}`) + c(nc, `D${f}`);
    const reserva = primeraReserva.get(String(nc[`A${f}`]?.v ?? ''));
    if (total && reserva) db.prepare('UPDATE reserva SET ajuste_comision_ars = ? WHERE id = ?').run(total, reserva);
  }
  // Noches no disponibles del Excel como bloqueos al final del período.
  for (const l of db.prepare(`SELECT depto_id, noches_no_disponibles n FROM liquidacion WHERE noches_no_disponibles > 0`).all() as any[]) {
    db.prepare(`INSERT INTO bloqueo(depto_id, desde, hasta) VALUES (?, date('2026-05-01', ?), '2026-05-01')`).run(l.depto_id, `-${l.n} days`);
  }

}
