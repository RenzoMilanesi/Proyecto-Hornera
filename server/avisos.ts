// Campanita de avisos: lo que está mal o por vencer, y lo importante que hicieron otras PCs.
// Se calcula en el momento: un aviso de problema se va solo al resolverlo (no se guarda nada).
// `clave`: partes `prefijo:id` separadas por coma; la interfaz marca nuevo el aviso con alguna parte que esta PC no vio.
import type { DatabaseSync } from 'node:sqlite';
import { cambiosDeOtrasPcs } from './auditoria.ts';
import { listarEmisores } from './emisores.ts';
import { SQL_FACTURA_VIGENTE, SQL_RECHAZO_PENDIENTE } from './facturacion.ts';
import { vencimientos } from './ficha.ts';

export interface Aviso { clave: string; nivel: 'rojo' | 'naranja' | 'info'; texto: string; seccion: string; fecha?: string }

// ponytail: umbrales fijos; a Variables si alguna vez hace falta cambiarlos.
const DIAS_SERVICIO = 3;
const DIAS_CERTIFICADO = 30;
const DIAS_OTRAS_PCS = 7;

const sumarDias = (dia: string, n: number) => new Date(Date.parse(dia) + n * 86_400_000).toISOString().slice(0, 10);
const dma = (dia: string) => dia.split('-').reverse().join('/');

export function calcularAvisos(db: DatabaseSync, o: { pc: string; local: boolean; desarrollo: boolean; hoy?: string }) {
  const hoy = o.hoy ?? new Date().toLocaleDateString('sv');
  const problemas: Aviso[] = [];

  // Servicios del mes: lo vencido y lo que vence en los próximos días.
  // ponytail: solo el mes en curso; el del mes pasado pagado con fecha de este mes seguiría figurando "vencido".
  const servicios = vencimientos(db, hoy.slice(0, 7), hoy).filter((v) => v.estado !== 'pagado');
  const vencidos = servicios.filter((v) => v.estado === 'vencido');
  const proximos = servicios.filter((v) => v.estado === 'pendiente' && v.vence <= sumarDias(hoy, DIAS_SERVICIO));
  const detalle = (vs: typeof servicios) => vs.slice(0, 3).map((v) => `${v.codigo} ${v.concepto}`).join(', ') + (vs.length > 3 ? '…' : '');
  if (vencidos.length) problemas.push({ clave: vencidos.map((v) => `venc:${v.servicio_id}@${v.vence}`).join(), nivel: 'rojo', seccion: 'vencimientos',
    texto: `${vencidos.length === 1 ? 'Un servicio vencido' : `${vencidos.length} servicios vencidos`} sin pagar: ${detalle(vencidos)}` });
  if (proximos.length) problemas.push({ clave: proximos.map((v) => `prox:${v.servicio_id}@${v.vence}`).join(), nivel: 'naranja', seccion: 'vencimientos',
    texto: `${proximos.length === 1 ? 'Vence un servicio' : `Vencen ${proximos.length} servicios`} en los próximos ${DIAS_SERVICIO} días: ${detalle(proximos)}` });

  // Certificados de ARCA de los emisores activos (los de homologación, solo con la app sin instalar).
  for (const e of listarEmisores(db)) {
    if (!e.activo || !e.certificado || (!o.desarrollo && e.ambiente !== 'produccion')) continue; // como las facturas
    const { vence } = e.certificado;
    if (vence < hoy) problemas.push({ clave: `cert:${e.id}@${vence}`, nivel: 'rojo', seccion: 'emisores', texto: `El certificado de ARCA de ${e.nombre} venció el ${dma(vence)}: no se puede facturar.` });
    else if (vence <= sumarDias(hoy, DIAS_CERTIFICADO)) problemas.push({ clave: `cert:${e.id}@${vence}`, nivel: 'naranja', seccion: 'emisores', texto: `El certificado de ARCA de ${e.nombre} vence el ${dma(vence)}.` });
  }

  // Facturas que no salieron: rechazos pendientes y facturas de un pago anulado sin su nota de crédito.
  const trabadas = db.prepare(`
    SELECT c.movimiento_id AS mov, substr(c.fecha, 1, 7) AS mes FROM comprobante c JOIN movimiento m ON m.id = c.movimiento_id
    WHERE (? OR c.ambiente = 'produccion') AND ((${SQL_RECHAZO_PENDIENTE}) OR ((${SQL_FACTURA_VIGENTE}) AND m.estado = 'anulado'))
    GROUP BY c.movimiento_id ORDER BY c.movimiento_id`).all(o.desarrollo ? 1 : 0) as { mov: number; mes: string }[];
  if (trabadas.length) {
    const meses = [...new Set(trabadas.map((t) => t.mes))].sort().map((m) => m.split('-').reverse().join('/'));
    problemas.push({ clave: trabadas.map((t) => `fact:${t.mov}`).join(), nivel: 'rojo', seccion: 'comprobantes',
      texto: `${trabadas.length === 1 ? 'Un pago' : `${trabadas.length} pagos`} con la factura o la nota de crédito sin salir (${meses.join(', ')}).` });
  }

  // Copia de seguridad: solo en la PC servidor, que es la que las hace.
  if (o.local) {
    const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'backup.error'`).get() as { valor: string } | undefined;
    if (fila) {
      const { fecha, mensaje } = JSON.parse(fila.valor) as { fecha: string; mensaje: string };
      problemas.push({ clave: `copia:${fecha}`, nivel: 'rojo', seccion: 'copias', texto: `Falló la copia de seguridad del ${dma(fecha)}: ${mensaje}` });
    }
  }

  const otrasPcs: Aviso[] = cambiosDeOtrasPcs(db, o.pc, sumarDias(hoy, -DIAS_OTRAS_PCS)).map((c) => ({
    clave: `aud:${c.id}`, nivel: 'info', seccion: 'auditoria', fecha: c.fecha, texto: `${c.pc}: ${c.texto}`,
  }));
  return { problemas, otrasPcs };
}
