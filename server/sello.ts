// Sello de tiempo de los campos *_en y auditoria.fecha: ISO 8601 con el offset de la PC
// ("2026-10-24T15:30:00-03:00"), así otra app o API lo lee sin adivinar la zona (DECISIONES).
// Para comparar sellos en SQL usar datetime(col): lo pasa a UTC y no depende del offset.
export function sello(d = new Date()): string {
  const off = -d.getTimezoneOffset(); // minutos al este de UTC: Argentina = -180
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  const h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  return `${local}${off < 0 ? '-' : '+'}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
