// "Traer mes": reservas, pagos y medios de pago de Stays para un período abierto.
//
// Reemplaza los scripts 0 a 2 de balances-hornera. Primero baja todo (si la red
// falla no se escribe nada) y después escribe en una transacción:
// - medios de pago: alta o actualización del nombre; la moneda, si descuenta
//   comisión y la cuenta asociada se respetan si ya existían (se editan en la app).
// - reservas: alta o actualización; los ajustes manuales (ajuste_*, observacion,
//   excluida) no se tocan. Las del período que Stays ya no devuelve se borran.
// - pagos de cada reserva: los mismos que tiene Stays.
// Si el período no existe se crea con los parámetros del último cargado.
import type { DatabaseSync } from 'node:sqlite';
import type { ClienteStays, FilaReserva, MedioStays, PagoStays } from './cliente.ts';
import { enPeriodo, SQL_EN_PERIODO } from '../periodo.ts';

export interface ReporteSync {
  mes: string;
  periodoCreado: boolean;
  reservas: number;
  pagos: number;
  medios: number;
  eliminadas: number;
  avisos: string[];
}

interface Periodo { id: number; mes: string; estado: string; fecha_inicio: string; fecha_cierre_reservas: string; fecha_corte_gastos: string; fecha_pago: string }

const DIA = 86_400_000;
const MESES: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };

const sumarDias = (iso: string, n: number) => new Date(Date.parse(iso) + n * DIA).toISOString().slice(0, 10);
export function sumarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + n, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
}
const mesesEntre = (desde: string, hasta: string) =>
  (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + Number(hasta.slice(5, 7)) - Number(desde.slice(5, 7));

// Stays exporta las fechas como texto en español ("01 oct. 2026").
export function fechaStays(v: unknown): string | null {
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * DIA).toISOString().slice(0, 10);
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = /^(\d{1,2}) ([a-z]+)\.? (\d{4})$/i.exec(v.trim());
  const mes = m && MESES[m[2].slice(0, 3).toLowerCase()];
  return mes ? `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

const centavos = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// MP y PayPal informan la comisión aparte (_f_tax): el neto es importe − comisión.
const medioDescuentaComision = (m: MedioStays, nombre: string) =>
  m.type === 'mercadopago' || m.type === 'paypal' || /mercado ?pago|link|paypal/i.test(nombre) ? 1 : 0;
const monedaMedio = (m: MedioStays, nombre: string) =>
  (m.currencies?.includes('USD') && !m.currencies.includes('ARS')) || /paypal|payoneer/i.test(nombre) ? 'USD' : 'ARS';

async function enParalelo<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

export async function sincronizarMes(db: DatabaseSync, cliente: ClienteStays, mes: string, ahora = new Date()): Promise<ReporteSync> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error(`Mes inválido: "${mes}" (se espera AAAA-MM).`);
  const existente = db.prepare('SELECT * FROM periodo WHERE mes = ?').get(mes) as Periodo | undefined;
  if (existente?.estado === 'cerrado') throw new Error(`El período ${mes} está cerrado: reabrilo para volver a traerlo.`);
  const base = existente ?? (db.prepare('SELECT * FROM periodo ORDER BY mes DESC LIMIT 1').get() as Periodo | undefined);
  if (!base) throw new Error('No hay ningún período cargado: importá primero el Excel de un mes.');
  const inicio = existente?.fecha_inicio ?? `${mes}-01`;
  const cierre = existente?.fecha_cierre_reservas ?? sumarMeses(inicio, 1);
  const marca = ahora.toISOString().slice(0, 19).replace('T', ' ');
  const avisos: string[] = [];

  try {
    // ---- 1. Bajar todo de Stays
    const medios = await cliente.mediosDePago();
    // Igual que el script 1: por llegada, por salida (corrida un día: una salida
    // el día 1 no tiene noches en el mes) e incluidas; después se filtra.
    const lotes = await Promise.all([
      cliente.exportarReservas(inicio, cierre, 'arrival'),
      cliente.exportarReservas(sumarDias(inicio, 1), sumarDias(cierre, 1), 'departure'),
      cliente.exportarReservas(inicio, cierre, 'included'),
    ]);
    const porCodigo = new Map<string, FilaReserva>();
    for (const fila of lotes.flat()) {
      const codigo = texto(fila.Reserva);
      if (codigo) porCodigo.set(codigo, fila);
    }
    // Entra si tiene noches en el período o si llega en el período (cancelación de 0 noches).
    const delPeriodo = [...porCodigo.entries()].filter(([codigo, fila]) => {
      const llegada = fechaStays(fila.Llegada);
      const salida = fechaStays(fila['Fecha de salida']);
      if (!llegada || !salida) {
        avisos.push(`Reserva ${codigo}: fechas ilegibles ("${fila.Llegada}" / "${fila['Fecha de salida']}"), no se trae.`);
        return false;
      }
      return enPeriodo(llegada, salida, inicio, cierre);
    });
    const pagosPorReserva = await enParalelo(delPeriodo, 4, ([codigo]) => cliente.pagos(codigo));

    // ---- 2. Escribir
    const reporte: ReporteSync = { mes, periodoCreado: !existente, reservas: 0, pagos: 0, medios: medios.length, eliminadas: 0, avisos };
    db.exec('BEGIN');
    try {
      let periodoId = existente?.id;
      if (!periodoId) {
        const n = mesesEntre(base.mes, mes);
        periodoId = Number(db.prepare(`
          INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago, usd_descuento_pct,
            costo_hora_limpieza, servicio_limpieza, servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento,
            tarifa_base, adicional_huesped, noches_tramo_1, cargo_tramo_1, noches_tramo_2, cargo_tramo_2, cm_fee_usd)
          SELECT ?, ?, ?, ?, ?, usd_descuento_pct, costo_hora_limpieza, servicio_limpieza, servicio_lavanderia,
            prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped, noches_tramo_1,
            cargo_tramo_1, noches_tramo_2, cargo_tramo_2, cm_fee_usd
          FROM periodo WHERE id = ?`).run(
          mes, inicio, cierre, sumarMeses(base.fecha_corte_gastos, n), sumarMeses(base.fecha_pago, n), (base as Periodo).id,
        ).lastInsertRowid);
        avisos.push(`Se creó el período ${mes} con los parámetros de ${base.mes} y sin cotización del dólar: revisalos antes de liquidar.`);
      }

      // Medios de pago
      const altaMedio = db.prepare(`
        INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda, descuenta_comision, activo) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(stays_id) DO UPDATE SET nombre = excluded.nombre, tipo_stays = excluded.tipo_stays, activo = excluded.activo,
          -- Un medio cargado antes como "(medio desconocido)" toma ahora su moneda y comisión reales.
          moneda = CASE medio_pago.tipo_stays WHEN 'desconocido' THEN excluded.moneda ELSE medio_pago.moneda END,
          descuenta_comision = CASE medio_pago.tipo_stays WHEN 'desconocido' THEN excluded.descuenta_comision ELSE medio_pago.descuenta_comision END`);
      for (const m of medios) {
        const nombre = m.internalName?.trim() || (m.type === 'user' ? 'Efectivo' : m.type);
        altaMedio.run(m._id, nombre, m.type, monedaMedio(m, nombre), medioDescuentaComision(m, nombre), m.status === 'active' ? 1 : 0);
      }
      const medioId = db.prepare('SELECT id FROM medio_pago WHERE stays_id = ?');
      const altaMedioDesconocido = db.prepare(`
        INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda) VALUES (?, '(medio desconocido)', 'desconocido', ?) RETURNING id`);
      const altaMedioSinMedio = db.prepare(`
        INSERT INTO medio_pago(stays_id, nombre, tipo_stays, moneda) VALUES (?, '(sin medio)', 'sin-medio', ?) RETURNING id`);

      const deptos = new Map((db.prepare('SELECT codigo, id FROM depto').all() as { codigo: string; id: number }[]).map((d) => [d.codigo, d.id]));
      const plataformas = new Map((db.prepare('SELECT nombre_stays, id FROM plataforma').all() as { nombre_stays: string; id: number }[]).map((p) => [p.nombre_stays, p.id]));

      const altaReserva = db.prepare(`
        INSERT INTO reserva(codigo, stays_id, depto_id, plataforma_id, codigo_ota, llegada, salida, huespedes, estado_stays,
          moneda, total_factura, forward_fee_all, precio_compra, tasa_propietario_airbnb, cargo_limpieza,
          tasa_propietario_limpieza, huesped_nombre, huesped_doc_tipo, huesped_doc_numero, raw_json, sincronizada_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(codigo) DO UPDATE SET stays_id = COALESCE(excluded.stays_id, reserva.stays_id), depto_id = excluded.depto_id,
          plataforma_id = excluded.plataforma_id, codigo_ota = excluded.codigo_ota, llegada = excluded.llegada,
          salida = excluded.salida, huespedes = excluded.huespedes, estado_stays = excluded.estado_stays,
          moneda = excluded.moneda, total_factura = excluded.total_factura, forward_fee_all = excluded.forward_fee_all,
          precio_compra = excluded.precio_compra, tasa_propietario_airbnb = excluded.tasa_propietario_airbnb,
          cargo_limpieza = excluded.cargo_limpieza, tasa_propietario_limpieza = excluded.tasa_propietario_limpieza,
          huesped_nombre = excluded.huesped_nombre, huesped_doc_tipo = excluded.huesped_doc_tipo,
          huesped_doc_numero = excluded.huesped_doc_numero, raw_json = excluded.raw_json,
          sincronizada_en = excluded.sincronizada_en
        RETURNING id`);
      const borrarPagosViejos = db.prepare(`DELETE FROM pago WHERE reserva_id = ? AND stays_id NOT IN (SELECT value FROM json_each(?))`);
      const altaPago = db.prepare(`
        INSERT INTO pago(stays_id, reserva_id, medio_pago_id, tipo, estado, descripcion, importe, comision, fecha_pago, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(stays_id) DO UPDATE SET reserva_id = excluded.reserva_id, medio_pago_id = excluded.medio_pago_id,
          tipo = excluded.tipo, estado = excluded.estado, descripcion = excluded.descripcion, importe = excluded.importe,
          comision = excluded.comision, fecha_pago = excluded.fecha_pago, raw_json = excluded.raw_json`);

      const traidas: string[] = [];
      const canalesDesconocidos = new Set<string>();
      const traerReserva = ([codigo, fila]: [string, FilaReserva], i: number) => {
        const depto = texto(fila['Nombre interno del alojamiento']);
        const deptoId = depto ? deptos.get(depto) : undefined;
        if (deptoId === undefined) {
          avisos.push(`Reserva ${codigo}: el alojamiento "${depto ?? ''}" no es un depto cargado, no se trae.`);
          return;
        }
        const canal = texto(fila.Canal) ?? 'Carga Agente'; // sin canal = carga manual del agente (script 3)
        const plataformaId = plataformas.get(canal) ?? null;
        if (plataformaId === null) canalesDesconocidos.add(canal);
        const doc = texto(fila['Tipo de documento']);
        const pagos = pagosPorReserva[i];
        const monedaStays = texto(fila.Moneda);
        if (monedaStays !== 'ARS' && monedaStays !== 'USD') {
          avisos.push(`Reserva ${codigo}: moneda "${monedaStays ?? ''}" desconocida, se toma USD.`);
        }
        const moneda = monedaStays === 'ARS' ? 'ARS' : 'USD';
        const { id: reservaId } = altaReserva.get(
          codigo, pagos.find((p) => p._idreserve)?._idreserve ?? null, deptoId, plataformaId,
          texto(fila['Código externo de reserva OTA']), fechaStays(fila.Llegada), fechaStays(fila['Fecha de salida']),
          Number(fila['Total de huéspedes']) || 1, texto(fila['Estatus de reserva']), moneda,
          centavos(fila['Total de factura de hospedaje']), centavos(fila['Total Forward Fee All']),
          centavos(fila['Precio de compra']), centavos(fila['Tasa del propietario: API airbnb']),
          centavos(fila['Cargos: Tasa de Limpieza'] ?? fila['Cargos adicionales: cargo por limpieza']),
          centavos(fila['Tasa del propietario: Tasa de Limpieza']), texto(fila['Nombre del huésped']),
          doc === null ? null : doc === 'ID' ? 'DNI' : doc === 'Pasaporte' ? 'Pasaporte' : 'Otro',
          texto(fila['Numero de documento']), JSON.stringify(fila), marca,
        ) as { id: number };
        traidas.push(codigo);
        reporte.reservas++;

        borrarPagosViejos.run(reservaId, JSON.stringify(pagos.map((p) => p._id)));
        for (const p of pagos as PagoStays[]) {
          if (!texto(p._id)) {
            avisos.push(`Reserva ${codigo}: un pago de ${p._f_val ?? '?'} no tiene identificador en Stays, no se trae.`);
            continue;
          }
          if (p.type !== 'credit' && p.type !== 'debit') {
            avisos.push(`Reserva ${codigo}: pago ${p._id} de tipo "${p.type}" desconocido, no se trae.`);
            continue;
          }
          // Algunos pagos (vistos en meses viejos) llegan sin medio: van a un medio "(sin medio)" por moneda,
          // que se asocia a una cuenta como cualquier otro.
          const proveedor = texto(p._idpaymentProvider);
          let medio = medioId.get(proveedor ?? `sin-medio-${moneda}`) as { id: number } | undefined;
          if (!proveedor) {
            medio ??= altaMedioSinMedio.get(`sin-medio-${moneda}`, moneda) as { id: number };
            avisos.push(`Reserva ${codigo}: el pago ${p._id} no tiene medio de pago en Stays; se cargó como "(sin medio)" en ${moneda}.`);
          } else if (!medio) {
            medio = altaMedioDesconocido.get(proveedor, moneda) as { id: number };
            avisos.push(`Reserva ${codigo}: el pago ${p._id} usa un medio de pago que Stays no informa (${proveedor}); se cargó como "(medio desconocido)" en ${moneda}.`);
          }
          const comision = centavos(p._f_tax);
          altaPago.run(p._id, reservaId, medio.id, p.type, p.status, texto(p.name), centavos(p._f_val) ?? 0,
            comision === 0 ? null : comision, texto(p.paymentDate), JSON.stringify(p));
          reporte.pagos++;
        }
      };
      // Si un dato de Stays viene con una forma inesperada, el error dice de qué reserva es.
      delPeriodo.forEach((x, i) => {
        try {
          traerReserva(x, i);
        } catch (e) {
          throw new Error(`Reserva ${x[0]}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      for (const canal of canalesDesconocidos) avisos.push(`Canal "${canal}" no está en Plataformas: esas reservas quedan sin plataforma.`);

      // Reservas del período que Stays ya no devuelve (canceladas o borradas allá).
      // Se compara contra todo lo que devolvió Stays, no contra lo guardado: una
      // reserva descartada con aviso (alojamiento desconocido) no se borra.
      // Las que ya forman parte de una liquidación cerrada no se tocan, y las que
      // tienen datos cargados a mano tampoco: puede ser que solo cambiaron de fecha.
      const viejas = db.prepare(`
        SELECT id, codigo,
               ajuste_ars <> 0 OR ajuste_usd <> 0 OR ajuste_comision_ars <> 0 OR ajuste_comision_usd <> 0
                 OR observacion IS NOT NULL OR excluida = 1 AS tenia_ajuste,
               EXISTS (SELECT 1 FROM liquidacion_reserva lr WHERE lr.reserva_id = r.id) AS liquidada
        FROM reserva r
        WHERE r.codigo NOT IN (SELECT value FROM json_each(:devueltas)) AND ${SQL_EN_PERIODO}`)
        .all({ devueltas: JSON.stringify([...porCodigo.keys()]), inicio, cierre }) as { id: number; codigo: string; tenia_ajuste: number; liquidada: number }[];
      if (porCodigo.size === 0 && viejas.length) {
        // Un export vacío con reservas en la base huele a error de Stays: mejor no borrar nada.
        avisos.push(`Stays no devolvió ninguna reserva para ${mes} y en la app hay ${viejas.length}: no se borró ninguna. Revisá Stays y volvé a traer el mes.`);
        viejas.length = 0;
      }
      for (const r of viejas) {
        if (r.liquidada) {
          avisos.push(`Reserva ${r.codigo}: ya no está en Stays pero es parte de una liquidación cerrada; se conserva.`);
          continue;
        }
        if (r.tenia_ajuste) {
          avisos.push(`Reserva ${r.codigo}: ya no aparece en ${mes} en Stays pero tiene ajustes cargados a mano; se conserva. Si cambió de fecha se actualiza al traer el mes nuevo; si se canceló, revisala.`);
          continue;
        }
        db.prepare('DELETE FROM reserva WHERE id = ?').run(r.id);
        reporte.eliminadas++;
        avisos.push(`Reserva ${r.codigo}: ya no está en Stays, se borró.`);
      }

      // Pagos de MP/PayPal sin la comisión cargada en Stays (el "ADD MP TAX" del script 2).
      const sinComision = db.prepare(`
        SELECT DISTINCT r.codigo FROM v_pago_liquidable v JOIN reserva r ON r.id = v.reserva_id
        WHERE v.falta_comision AND r.codigo IN (SELECT value FROM json_each(?)) ORDER BY r.codigo`)
        .all(JSON.stringify(traidas)) as { codigo: string }[];
      if (sinComision.length) {
        avisos.push(`Pagos de Mercado Pago/PayPal sin comisión cargada en Stays (${sinComision.map((r) => r.codigo).join(', ')}): cargala allá y volvé a traer el mes.`);
      }
      const sinCuenta = db.prepare(`
        SELECT DISTINCT mp.nombre FROM pago p JOIN medio_pago mp ON mp.id = p.medio_pago_id JOIN reserva r ON r.id = p.reserva_id
        WHERE mp.cuenta_id IS NULL AND r.codigo IN (SELECT value FROM json_each(?)) ORDER BY mp.nombre`)
        .all(JSON.stringify(traidas)) as { nombre: string }[];
      if (sinCuenta.length) avisos.push(`Medios de pago sin cuenta asociada: ${sinCuenta.map((m) => m.nombre).join(', ')}.`);

      db.prepare(`
        INSERT INTO sincronizacion(periodo_id, iniciada_en, terminada_en, resultado, reservas, pagos, avisos_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        periodoId, marca, new Date().toISOString().slice(0, 19).replace('T', ' '),
        avisos.length ? 'con_avisos' : 'ok', reporte.reservas, reporte.pagos, JSON.stringify(avisos),
      );
      db.exec('COMMIT');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
    return reporte;
  } catch (e) {
    // Queda registro del intento fallido si el período ya existía.
    if (existente) {
      db.prepare(`INSERT INTO sincronizacion(periodo_id, iniciada_en, terminada_en, resultado, avisos_json) VALUES (?, ?, ?, 'error', ?)`)
        .run(existente.id, marca, new Date().toISOString().slice(0, 19).replace('T', ' '), JSON.stringify([e instanceof Error ? e.message : String(e)]));
    }
    throw e;
  }
}
