// Todo lo que muestra la hoja de liquidación de un depto (el PDF que recibe el propietario),
// con el mismo contenido y orden que la hoja por depto del Excel. Mes abierto: del cálculo en
// vivo. Mes cerrado: del snapshot guardado al cerrar (un mes importado no tiene el detalle de
// reservas: su PDF es el del Excel).
import type { DatabaseSync } from 'node:sqlite';
import { truncPesos, type Importe } from './motor.ts';
import { liquidarPeriodo } from './servicio.ts';
import { facturasDeLiquidacion, type DatosComprobante } from '../facturacion.ts';

export interface LineaHoja {
  llegada: string; codigoInterno: string; huespedes: number; nochesPeriodo: number;
  importeArs: number; importePeriodoArs: number; importeUsd: number; importePeriodoUsd: number;
  tarifa: number; tarifaPeriodo: number; pagoPlataformaUsd: number;
}

export interface Hoja {
  empresa: { administrador: string; cuit: string; direccion: string; telefono: string; email: string };
  mes: string; estado: string; inicio: string; cierre: string; cambio: number;
  servicios: { limpieza: number; lavanderia: number; blanqueria: number };
  depto: { codigo: string; nombre: string; direccion: string | null; comisionPct: number; tipoAdministracion: string };
  propietario: { nombre: string; cuit: string | null; categoria: string | null; cbu: string; mails: string | null; moneda: 'ARS' | 'USD' };
  resumen: { bruto: number; gastosDirectos: number; saldoParcial: number; honorarios: number; saldo: number };
  noches: { total: number; disponibles: number; noDisponibles: number; propietario: number; ocupadas: number; reservas: number };
  detalle: {
    ingresos: Importe; costos: number; comisiones: Importe; honorarios: number; saldoAnterior: Importe;
    movimientos: { fecha: string; concepto: string | null; detalle: string | null; ars: number; usd: number }[];
    conversion: Importe; saldo: Importe; // saldo final, después de los pagos de liquidación
  };
  reservas: LineaHoja[];
  facturas: DatosComprobante[];  // una página más por factura vigente de los honorarios (plan 031)
}

const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);

export function hojaDepto(db: DatabaseSync, mes: string, codigo: string): Hoja {
  const p = db.prepare('SELECT * FROM periodo WHERE mes = ?').get(mes) as any;
  if (!p) throw new Error(`No existe el período ${mes}.`);
  const d = db.prepare(`
    SELECT d.id, d.codigo, d.nombre, d.direccion, d.comision_pct, d.tipo_administracion, pr.nombre AS propietario, pr.cuit,
           pr.categoria_fiscal, pr.cbu, pr.es_hornera, pr.mails, pr.moneda_liquidacion
    FROM depto d JOIN propietario pr ON pr.id = d.propietario_id WHERE d.codigo = ?`).get(codigo) as any;
  if (!d) throw new Error(`No existe el depto ${codigo}.`);
  const conf = new Map((db.prepare(`SELECT clave, valor FROM configuracion WHERE clave LIKE 'empresa.%'`).all() as any[]).map((c) => [c.clave, c.valor]));
  const empresa = {
    administrador: conf.get('empresa.administrador') ?? '', cuit: conf.get('empresa.cuit') ?? '', direccion: conf.get('empresa.direccion') ?? '',
    telefono: conf.get('empresa.telefono') ?? '', email: conf.get('empresa.email') ?? '',
  };
  const movimientos = db.prepare(`
    SELECT m.fecha, c.nombre AS concepto, m.detalle, m.importe_ars AS ars, m.importe_usd AS usd
    FROM movimiento m LEFT JOIN concepto c ON c.id = m.concepto_id
    WHERE m.periodo_id = ? AND m.depto_id = ? AND m.estado = 'vigente' AND m.tipo <> 'saldo_inicial'
    ORDER BY m.fecha, m.id`).all(p.id, d.id) as Hoja['detalle']['movimientos'];

  let cambio: number, comisionPct: number, ingresos: Importe, costos: number, comisiones: Importe, bruto: number;
  let honorarios: number, saldoAnterior: Importe, conversion: Importe, saldoAntesDePagar: Importe, gastosDirectos: number;
  let noches: Omit<Hoja['noches'], 'total'>, reservas: LineaHoja[];
  if (p.estado === 'abierto') {
    const calculo = liquidarPeriodo(db, mes);
    if (calculo.cambio === null) throw new Error(calculo.avisos[0]);
    const l = calculo.deptos.find((x) => x.codigo === codigo);
    if (!l) throw new Error(`${codigo} no tiene liquidación en ${mes}.`);
    const r = l.resultado;
    cambio = calculo.cambio; comisionPct = l.comisionPct; ingresos = r.ingresos; costos = r.costosOperativos;
    comisiones = l.comisiones; bruto = r.bruto; honorarios = r.honorarios; saldoAnterior = l.saldoAnterior;
    conversion = r.conversion; saldoAntesDePagar = r.saldo; gastosDirectos = r.gastosDirectos;
    noches = { disponibles: r.nochesDisponibles, noDisponibles: l.nochesNoDisponibles, propietario: r.nochesPropietario, ocupadas: r.nochesOcupadas, reservas: r.reservas.length };
    reservas = r.reservas.map((x, i) => ({
      llegada: l.reservas[i].llegada, codigoInterno: x.codigoInterno, huespedes: l.reservas[i].huespedes, nochesPeriodo: x.nochesPeriodo,
      importeArs: x.importeArs, importePeriodoArs: x.importePeriodoArs, importeUsd: x.importeUsd, importePeriodoUsd: x.importePeriodoUsd,
      tarifa: x.tarifa, tarifaPeriodo: x.tarifaPeriodo, pagoPlataformaUsd: x.pagoPlataformaUsd,
    }));
  } else {
    const s = db.prepare('SELECT * FROM liquidacion WHERE periodo_id = ? AND depto_id = ?').get(p.id, d.id) as any;
    if (!s) throw new Error(`${codigo} no tiene liquidación en ${mes}.`);
    cambio = s.cambio; comisionPct = s.comision_pct; ingresos = { ars: s.ingresos_ars, usd: s.ingresos_usd }; costos = s.costos_operativos;
    comisiones = { ars: s.comisiones_ars, usd: s.comisiones_usd }; bruto = s.bruto; honorarios = s.honorarios;
    saldoAnterior = { ars: s.saldo_anterior_ars, usd: s.saldo_anterior_usd }; conversion = { ars: s.conversion_ars, usd: s.conversion_usd };
    saldoAntesDePagar = { ars: s.saldo_final_ars, usd: s.saldo_final_usd };
    gastosDirectos = truncPesos(-costos - comisiones.ars - comisiones.usd * cambio); // [F19], no se guarda
    noches = { disponibles: s.noches_disponibles, noDisponibles: s.noches_no_disponibles, propietario: s.noches_propietario, ocupadas: s.noches_ocupadas, reservas: s.cant_reservas };
    reservas = (db.prepare(`
      SELECT r.llegada, lr.codigo_interno AS codigoInterno, r.huespedes, lr.noches_periodo AS nochesPeriodo, lr.importe_ars AS importeArs,
             lr.importe_periodo_ars AS importePeriodoArs, lr.importe_usd AS importeUsd, lr.importe_periodo_usd AS importePeriodoUsd,
             lr.tarifa, lr.tarifa_periodo AS tarifaPeriodo, lr.pago_plataforma_usd AS pagoPlataformaUsd
      FROM liquidacion_reserva lr JOIN reserva r ON r.id = lr.reserva_id
      WHERE lr.liquidacion_id = ? ORDER BY r.llegada, r.codigo`).all(s.id) as unknown) as LineaHoja[];
  }
  // El saldo final de la hoja ([J55]/[K55]) ya resta los pagos de liquidación del detalle.
  const pagosLiq = db.prepare(`
    SELECT COALESCE(SUM(importe_ars), 0) AS ars, COALESCE(SUM(importe_usd), 0) AS usd FROM movimiento
    WHERE periodo_id = ? AND depto_id = ? AND estado = 'vigente' AND tipo = 'liquidacion'`).get(p.id, d.id) as unknown as Importe;

  return {
    empresa, mes, estado: p.estado, inicio: p.fecha_inicio, cierre: p.fecha_cierre_reservas, cambio,
    servicios: { limpieza: p.servicio_limpieza, lavanderia: p.servicio_lavanderia, blanqueria: p.prestamo_blanqueria },
    depto: { codigo: d.codigo, nombre: d.nombre, direccion: d.direccion, comisionPct, tipoAdministracion: d.tipo_administracion },
    propietario: {
      nombre: d.propietario, cuit: d.cuit, categoria: d.categoria_fiscal, cbu: d.es_hornera ? 'Nosotros' : (d.cbu ?? 'No informado'),
      mails: d.mails, moneda: d.moneda_liquidacion,
    },
    facturas: facturasDeLiquidacion(db, p.id, d.id),
    resumen: { bruto, gastosDirectos, saldoParcial: bruto + gastosDirectos, honorarios, saldo: bruto + gastosDirectos + honorarios },
    noches: { total: dias(p.fecha_inicio, p.fecha_cierre_reservas), ...noches },
    detalle: {
      ingresos, costos, comisiones, honorarios, saldoAnterior, movimientos, conversion,
      saldo: { ars: saldoAntesDePagar.ars + pagosLiq.ars, usd: saldoAntesDePagar.usd + pagosLiq.usd },
    },
    reservas,
  };
}
