// Importa un export mensual del Google Sheet de liquidaciones (p. ej. 2026-04.xlsx).
//
// - Maestros (propietarios, deptos, plataformas, cuentas, conceptos): alta o
//   actualización. Reimportar otro mes los refresca.
// - El mes del export entra como período CERRADO: sus movimientos de CORRIENTE y
//   la liquidación de cada depto tal como quedó en su hoja (snapshot). De ahí sale
//   el saldo de arrastre del mes siguiente, que ya se trabaja en la app.
// - Histórico de noches ocupadas desde la hoja OCUPACION.
//
// Todo en una transacción: si algo falla no queda nada a medias. Lo que no se
// puede importar no frena: vuelve como aviso.
import * as XLSX from 'xlsx';
import { hostname } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';

export interface ReporteImportacion {
  mes: string;
  propietarios: number;
  deptos: number;
  plataformas: number;
  cuentas: number;
  movimientos: number;
  liquidaciones: number;
  historico: number;
  avisos: string[];
}

type Hoja = XLSX.WorkSheet;
type Tipo = 'gasto' | 'ingreso' | 'pre_liquidacion' | 'liquidacion' | 'pago_directo' | 'saldo_inicial';
interface Importe { ars: number; usd: number }
const CERO: Importe = { ars: 0, usd: 0 };

const DIA = 86_400_000;
const CODIGOS_NO_DEPTO = new Set(['HOR', 'INT', 'CAN', 'PRUE']); // INT = gasto/ingreso de la empresa
const ESTADOS = new Set(['potencial', 'proximo', 'activo', 'pausado', 'finalizado']);
const TIPOLOGIAS = new Set(['monoambiente', '1 dormitorio', '2 dormitorios', '3 dormitorios']);
const CATEGORIAS = new Set(['RM', 'RI', 'CF', 'EX']);

const num = (h: Hoja, ref: string): number => (typeof h[ref]?.v === 'number' ? h[ref].v : 0);
const txt = (h: Hoja, ref: string): string => (h[ref]?.v == null ? '' : String(h[ref].v).trim());
const fecha = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DIA).toISOString().slice(0, 10);
const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA);
const c = (pesos: number) => Math.round(pesos * 100); // pesos → centavos
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const ultimaFila = (h: Hoja) => XLSX.utils.decode_range(h['!ref'] ?? 'A1').e.r + 1;

// "Pérez, Ana - DNI N°11.111.111 / Gómez, Luis - DNI N°22.222.222" (ejemplo ficticio)
function parsearFacturante(s: string) {
  const personas = s.split(' / ').map((p) => {
    const [nombre, ...doc] = p.split(' - ');
    return { nombre: nombre.trim(), doc: doc.join(' - ').trim() };
  });
  return {
    nombre: personas.map((p) => p.nombre).join(' / '),
    documento: personas.map((p) => p.doc).filter((d) => /\d/.test(d)).join(' / ') || null,
  };
}

// Moneda de liquidación según la fila "Cambio moneda" de la hoja del depto:
// J53 = -SUM(J..) pasa el ARS a USD; K53 con "/96" es el recargo del 4 % de R64.
function monedaDeHoja(h: Hoja) {
  const aUsd = (h.J53?.f ?? '').toUpperCase().replaceAll(' ', '').startsWith('-SUM(J');
  return { moneda: aUsd ? 'USD' : 'ARS', recargo: aUsd && (h.K53?.f ?? '').includes('96') ? 0.04 : 0 };
}

export function importarExcel(db: DatabaseSync, contenido: Buffer, ahora = new Date()): ReporteImportacion {
  const wb = XLSX.read(contenido, { type: 'buffer', cellFormula: true });
  const hoja = (nombre: string): Hoja => {
    const h = wb.Sheets[nombre];
    if (!h) throw new Error(`No parece un export del Excel de liquidaciones: falta la hoja "${nombre}".`);
    return h;
  };
  const dbal = hoja('Datos balance');
  const props = hoja('Propiedades');
  const plats = hoja('Plataformas');
  const listas = hoja('Listas');
  const corriente = hoja('CORRIENTE');

  const inicio = fecha(num(dbal, 'B1'));
  const cierre = fecha(num(dbal, 'B2'));
  const mes = inicio.slice(0, 7);
  if (!/^20\d\d-\d\d-01$/.test(inicio) || cierre <= inicio || !/^20\d\d-/.test(cierre)) {
    throw new Error(`"Datos balance" no tiene fechas válidas en B1 (liquidación mes) y B2 (cierre reservas): ${txt(dbal, 'B1') || 'vacía'} / ${txt(dbal, 'B2') || 'vacía'}.`);
  }
  // Un período abierto sin movimientos es el que creó "traer mes" de Stays: el Excel se importa encima.
  const existente = db.prepare(`
    SELECT id, estado, EXISTS (SELECT 1 FROM movimiento m WHERE m.periodo_id = p.id) AS con_movimientos
    FROM periodo p WHERE mes = ?`).get(mes) as { id: number; estado: string; con_movimientos: number } | undefined;
  if (existente?.estado === 'cerrado') throw new Error(`El período ${mes} ya está importado (cerrado).`);
  if (existente?.con_movimientos) {
    throw new Error(`El período ${mes} está abierto en la app y ya tiene movimientos cargados: no se puede importar el Excel encima.`);
  }
  // Solo el export más nuevo actualiza maestros e histórico: los meses anteriores
  // llegan después de abril 2026 y no deben pisar datos más recientes. Cuentan solo
  // los meses cerrados: los que crea "traer mes" están abiertos.
  const ultimo = (db.prepare(`SELECT max(mes) AS m FROM periodo WHERE estado = 'cerrado'`).get() as { m: string | null }).m;
  const actualizar = ultimo === null || mes > ultimo ? 1 : 0;

  const avisos: string[] = [];
  const creadoEn = ahora.toISOString().slice(0, 19).replace('T', ' ');
  const reporte: ReporteImportacion = {
    mes, propietarios: 0, deptos: 0, plataformas: 0, cuentas: 0, movimientos: 0, liquidaciones: 0, historico: 0, avisos,
  };
  if (!actualizar) {
    avisos.push(`${mes} es anterior al último mes importado (${ultimo}): solo se agregaron propietarios, deptos y plataformas nuevos; los existentes no se modificaron.`);
  }

  db.exec('BEGIN');
  try {
    // ---- Plataformas
    const altaPlataforma = db.prepare(`
      INSERT INTO plataforma(nombre_stays, nombre, codigo, gestiona_pago, comision_pct) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(nombre_stays) DO UPDATE SET codigo = excluded.codigo,
        gestiona_pago = excluded.gestiona_pago, comision_pct = excluded.comision_pct WHERE ?`);
    for (let f = 2; f <= ultimaFila(plats); f++) {
      const nombre = txt(plats, `A${f}`);
      if (!nombre || nombre.includes('NO EDITAR')) continue;
      altaPlataforma.run(nombre, nombre, txt(plats, `B${f}`), txt(plats, `C${f}`) === 'Si' ? 1 : 0, num(plats, `D${f}`), actualizar);
      reporte.plataformas++;
    }

    // ---- Cuentas (Listas B). "Ajuste" es una marca de la planilla, no una cuenta.
    const altaCuenta = db.prepare(`INSERT INTO cuenta(nombre, moneda) VALUES (?, ?) ON CONFLICT(nombre) DO NOTHING`);
    for (let f = 1; f <= ultimaFila(listas); f++) {
      const nombre = txt(listas, `B${f}`);
      if (!nombre || nombre === 'Ajuste') continue;
      altaCuenta.run(nombre, /USD|payoneer|paypal/i.test(nombre) ? 'USD' : 'ARS');
      reporte.cuentas++;
    }

    // ---- Conceptos (Listas C, más los que aparezcan en CORRIENTE)
    const buscarConcepto = db.prepare('SELECT id FROM concepto WHERE lower(nombre) = lower(?)');
    const altaConcepto = db.prepare('INSERT INTO concepto(nombre) VALUES (?)');
    const conceptoId = (nombre: string): number | null => {
      if (!nombre) return null;
      const fila = buscarConcepto.get(nombre) as { id: number } | undefined;
      return fila ? fila.id : Number(altaConcepto.run(nombre).lastInsertRowid);
    };
    for (let f = 1; f <= ultimaFila(listas); f++) conceptoId(txt(listas, `C${f}`));

    // ---- Propietarios y deptos (Propiedades)
    const hojasDepto = new Map<string, Hoja>();
    for (const nombre of wb.SheetNames) {
      const h = wb.Sheets[nombre];
      if (txt(h, 'C11') === nombre && nombre.length <= 4) hojasDepto.set(nombre, h);
    }
    const buscarPropietario = db.prepare('SELECT id FROM propietario WHERE nombre = ?');
    const altaPropietario = db.prepare(`
      INSERT INTO propietario(nombre, documento, cuit, categoria_fiscal, cbu, es_hornera, mails, moneda_liquidacion, comision_cobro_usd_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const cambiarPropietario = db.prepare(`
      UPDATE propietario SET documento = ?, cuit = ?, categoria_fiscal = ?, cbu = ?, es_hornera = ?, mails = ? WHERE id = ?`);
    // La moneda de liquidación sale solo de las hojas de depto (fila "Cambio moneda"): un depto
    // sin hoja (finalizado, pausado) no sabe en qué moneda liquida su propietario.
    const cambiarMoneda = db.prepare('UPDATE propietario SET moneda_liquidacion = ?, comision_cobro_usd_pct = ? WHERE id = ?');
    const altaDepto = db.prepare(`
      INSERT INTO depto(codigo, nombre, direccion, tipologia, estado, propietario_id, comision_pct, tipo_administracion,
        horas_limpieza_prom, id_alquiler_argentina, id_booking, id_alohar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(codigo) DO UPDATE SET nombre = excluded.nombre, direccion = excluded.direccion,
        tipologia = excluded.tipologia, estado = excluded.estado, propietario_id = excluded.propietario_id,
        comision_pct = excluded.comision_pct, tipo_administracion = excluded.tipo_administracion,
        horas_limpieza_prom = excluded.horas_limpieza_prom, id_alquiler_argentina = excluded.id_alquiler_argentina,
        id_booking = excluded.id_booking, id_alohar = excluded.id_alohar WHERE ?`);

    const propietariosVistos = new Map<string, { id: number; nuevo: boolean; moneda?: string; depto?: string }>();
    const deptoIds = new Map<string, number>();
    for (let f = 2; f <= ultimaFila(props); f++) {
      const codigo = txt(props, `A${f}`);
      if (!codigo || codigo.includes('NO EDITAR') || CODIGOS_NO_DEPTO.has(codigo)) continue;
      const facturante = txt(props, `E${f}`);
      if (!facturante) {
        avisos.push(`Depto ${codigo}: no tiene facturante en Propiedades, no se importa.`);
        continue;
      }
      const { nombre, documento } = parsearFacturante(facturante);
      const cbuTexto = txt(props, `Q${f}`);
      const esHornera = cbuTexto === 'Nosotros' ? 1 : 0;
      const categoria = txt(props, `O${f}`);
      const datos = [
        documento, txt(props, `N${f}`) || null,
        CATEGORIAS.has(categoria) ? categoria : categoria === 'No inf.' ? 'NI' : null,
        esHornera || !cbuTexto ? null : cbuTexto, esHornera, txt(props, `P${f}`) || null,
      ] as const;

      let prop = propietariosVistos.get(nombre);
      if (!prop) {
        const existente = buscarPropietario.get(nombre) as { id: number } | undefined;
        if (existente && actualizar) cambiarPropietario.run(...datos, existente.id);
        prop = existente
          ? { id: existente.id, nuevo: false }
          : { id: Number(altaPropietario.run(nombre, ...datos, 'ARS', 0).lastInsertRowid), nuevo: true };
        propietariosVistos.set(nombre, prop);
      }
      const hojaDepto = hojasDepto.get(codigo);
      if (hojaDepto) {
        const { moneda, recargo } = monedaDeHoja(hojaDepto);
        if (!prop.moneda) {
          prop.moneda = moneda;
          prop.depto = codigo;
          if (actualizar || prop.nuevo) cambiarMoneda.run(moneda, recargo, prop.id);
        } else if (prop.moneda !== moneda) {
          avisos.push(`Depto ${codigo}: liquida en ${moneda} pero ${prop.depto}, del mismo propietario, en ${prop.moneda}. Queda ${prop.moneda}.`);
        }
      }

      const estado = sinAcentos(txt(props, `C${f}`).toLowerCase());
      if (!ESTADOS.has(estado)) avisos.push(`Depto ${codigo}: estado "${txt(props, `C${f}`)}" desconocido, queda "activo".`);
      const tipologia = txt(props, `W${f}`);
      const comision = props[`F${f}`]?.v;
      altaDepto.run(
        codigo, txt(props, `B${f}`) || codigo, txt(props, `D${f}`) || null, TIPOLOGIAS.has(tipologia) ? tipologia : null,
        ESTADOS.has(estado) ? estado : 'activo', prop.id, typeof comision === 'number' ? comision : 0.2,
        txt(props, `G${f}`).toLowerCase() || 'integral', props[`J${f}`]?.v && typeof props[`J${f}`].v === 'number' ? props[`J${f}`].v : null,
        txt(props, `R${f}`) || null, txt(props, `S${f}`) || null, txt(props, `T${f}`) || null, actualizar,
      );
      deptoIds.set(codigo, (db.prepare('SELECT id FROM depto WHERE codigo = ?').get(codigo) as { id: number }).id);
      reporte.deptos++;
    }
    reporte.propietarios = propietariosVistos.size;
    for (const codigo of hojasDepto.keys()) {
      if (!deptoIds.has(codigo)) avisos.push(`La hoja ${codigo} no tiene depto en Propiedades: su liquidación no se importa.`);
    }

    // ---- Período (Datos balance)
    const { id: periodoId } = db.prepare(`
      INSERT INTO periodo(mes, fecha_inicio, fecha_cierre_reservas, fecha_corte_gastos, fecha_pago,
        usd_cotizacion, usd_cotizacion_fuente, usd_descuento_pct, costo_hora_limpieza, servicio_limpieza,
        servicio_lavanderia, prestamo_blanqueria, gestion_operativa, mantenimiento, tarifa_base, adicional_huesped,
        noches_tramo_1, cargo_tramo_1, noches_tramo_2, cargo_tramo_2, cm_fee_usd)
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mes) DO UPDATE SET fecha_inicio = excluded.fecha_inicio,
        fecha_cierre_reservas = excluded.fecha_cierre_reservas, fecha_corte_gastos = excluded.fecha_corte_gastos,
        fecha_pago = excluded.fecha_pago, usd_cotizacion = excluded.usd_cotizacion,
        usd_cotizacion_fuente = excluded.usd_cotizacion_fuente, usd_descuento_pct = excluded.usd_descuento_pct,
        costo_hora_limpieza = excluded.costo_hora_limpieza, servicio_limpieza = excluded.servicio_limpieza,
        servicio_lavanderia = excluded.servicio_lavanderia, prestamo_blanqueria = excluded.prestamo_blanqueria,
        gestion_operativa = excluded.gestion_operativa, mantenimiento = excluded.mantenimiento,
        tarifa_base = excluded.tarifa_base, adicional_huesped = excluded.adicional_huesped,
        noches_tramo_1 = excluded.noches_tramo_1, cargo_tramo_1 = excluded.cargo_tramo_1,
        noches_tramo_2 = excluded.noches_tramo_2, cargo_tramo_2 = excluded.cargo_tramo_2, cm_fee_usd = excluded.cm_fee_usd
      RETURNING id`).get(
      mes, inicio, cierre, fecha(num(dbal, 'B3')), fecha(num(dbal, 'B4')),
      num(dbal, 'B5'), num(dbal, 'A6'), c(num(dbal, 'B13')), c(num(dbal, 'B8')),
      c(num(dbal, 'B9')), c(num(dbal, 'B10')), c(num(dbal, 'B11')), c(num(dbal, 'B12')), c(num(dbal, 'B15')), c(num(dbal, 'B16')),
      num(dbal, 'A17'), c(num(dbal, 'B17')), num(dbal, 'A18'), c(num(dbal, 'B18')), c(num(dbal, 'B7')),
    ) as { id: number };
    if (existente) avisos.push(`El período ${mes} estaba abierto (creado al traer de Stays): se completó con los parámetros del Excel y quedó cerrado.`);

    // ---- Movimientos (CORRIENTE). Sin cuenta: el Excel no registra de qué cuenta sale cada uno.
    const altaMovimiento = db.prepare(`
      INSERT INTO movimiento(periodo_id, fecha, depto_id, tipo, concepto_id, detalle, importe_ars, importe_usd, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Totales por depto y tipo, para el snapshot de la liquidación.
    const porDepto = new Map<string, { totales: Map<Tipo, Importe>; pagoId?: number }>();
    for (let f = 2; f <= ultimaFila(corriente); f++) {
      const codigo = txt(corriente, `A${f}`);
      if (!codigo || codigo === 'DEPTO') continue;
      const concepto = txt(corriente, `C${f}`);
      const ars = c(num(corriente, `K${f}`));
      const usd = c(num(corriente, `L${f}`));
      if (ars === 0 && usd === 0) {
        // Columna "FONDO / ACUMULADO": montos informativos que no entran en la liquidación.
        if (num(corriente, `J${f}`)) avisos.push(`CORRIENTE fila ${f}: ${codigo} "${concepto}" tiene ${num(corriente, `J${f}`)} como fondo acumulado; no se importa.`);
        continue;
      }
      const deptoId = codigo === 'INT' ? null : deptoIds.get(codigo);
      if (deptoId === undefined) {
        avisos.push(`CORRIENTE fila ${f}: depto ${codigo} desconocido, no se importa.`);
        continue;
      }
      const detalle = ['D', 'E', 'F', 'J'].map((col) => corriente[`${col}${f}`]?.v)
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '' && v.trim() !== concepto)
        .map((v) => v.trim()).join(' · ') || null;
      const tipo: Tipo = /^saldo mes anterior$/i.test(concepto) ? 'saldo_inicial'
        : /^liquidaci[oó]n periodo$/i.test(concepto) ? 'liquidacion'
        : /pago directo/i.test(detalle ?? '') ? 'pago_directo'
        : /^pre-?liquidaci[oó]n$/i.test(sinAcentos(concepto)) ? 'pre_liquidacion'
        : (ars || usd) > 0 ? 'ingreso' : 'gasto';
      const serial = corriente[`B${f}`]?.v;
      const fechaMov = tipo === 'saldo_inicial' || typeof serial !== 'number' ? inicio : fecha(serial);
      const id = Number(altaMovimiento.run(periodoId, fechaMov, deptoId, tipo, conceptoId(concepto), detalle, ars, usd, creadoEn).lastInsertRowid);
      reporte.movimientos++;
      if (deptoId === null) continue;
      const d = porDepto.get(codigo) ?? { totales: new Map<Tipo, Importe>() };
      const previo = d.totales.get(tipo) ?? CERO;
      d.totales.set(tipo, { ars: previo.ars + ars, usd: previo.usd + usd });
      // ponytail: si hay varios pagos (transferencia + diferencia) se vincula el primero.
      if (tipo === 'liquidacion') d.pagoId ??= id;
      porDepto.set(codigo, d);
    }

    // ---- Liquidación de cada depto con hoja, tal como quedó en el Excel
    const cambio = num(dbal, 'B6');
    const altaLiquidacion = db.prepare(`
      INSERT INTO liquidacion(periodo_id, depto_id, cambio, comision_pct, noches_disponibles, noches_no_disponibles,
        noches_ocupadas, noches_propietario, cant_reservas, ingresos_ars, ingresos_usd, costos_operativos,
        comisiones_ars, comisiones_usd, bruto, honorarios, saldo_anterior_ars, saldo_anterior_usd,
        movimientos_ars, movimientos_usd, conversion_ars, conversion_usd, saldo_final_ars, saldo_final_usd,
        movimiento_pago_id, calculada_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [codigo, h] of hojasDepto) {
      const deptoId = deptoIds.get(codigo);
      if (deptoId === undefined) continue;
      const d = porDepto.get(codigo);
      const tot = (tipo: Tipo) => d?.totales.get(tipo) ?? CERO;
      const pagos = tot('liquidacion');
      const saldoAnterior = tot('saldo_inicial');
      const otros = (['gasto', 'ingreso', 'pre_liquidacion', 'pago_directo'] as const)
        .reduce((s, tipo) => ({ ars: s.ars + tot(tipo).ars, usd: s.usd + tot(tipo).usd }), CERO);

      // Lo importado de CORRIENTE tiene que ser lo mismo que muestra la hoja (filas 36 a 52).
      let hojaArs = 0, hojaUsd = 0;
      for (let f = 36; f <= 52; f++) { hojaArs += c(num(h, `J${f}`)); hojaUsd += c(num(h, `K${f}`)); }
      const importado = { ars: saldoAnterior.ars + otros.ars + pagos.ars, usd: saldoAnterior.usd + otros.usd + pagos.usd };
      if (Math.abs(importado.ars - hojaArs) > 1 || Math.abs(importado.usd - hojaUsd) > 1) {
        avisos.push(`Depto ${codigo}: los movimientos de CORRIENTE (ARS ${importado.ars / 100}, USD ${importado.usd / 100}) no coinciden con su hoja (ARS ${hojaArs / 100}, USD ${hojaUsd / 100}).`);
      }

      altaLiquidacion.run(
        periodoId, deptoId, cambio, num(h, 'I15'), num(h, 'B23'), num(h, 'B24') + dias(inicio, cierre) - num(h, 'B22'),
        num(h, 'B26'), num(h, 'B25'), num(h, 'E24'), c(num(h, 'J31')), c(num(h, 'K31')), -c(num(h, 'J32')),
        -c(num(h, 'J33')), -c(num(h, 'K33')), c(num(h, 'F18')), c(num(h, 'J34')), saldoAnterior.ars, saldoAnterior.usd,
        otros.ars, otros.usd, c(num(h, 'J53')), c(num(h, 'K53')),
        // J55/K55 ya restan el pago; el snapshot guarda el saldo de antes de pagar.
        c(num(h, 'J55')) - pagos.ars, c(num(h, 'K55')) - pagos.usd,
        d?.pagoId ?? null, creadoEn,
      );
      reporte.liquidaciones++;
    }

    // ---- Histórico de noches ocupadas (OCUPACION: una columna por mes "mm/aa")
    const ocupacion = wb.Sheets.OCUPACION;
    if (ocupacion) {
      const altaHistorico = db.prepare(`
        INSERT INTO historico_mensual(depto_id, mes, noches_ocupadas) VALUES (?, ?, ?)
        ON CONFLICT(depto_id, mes) DO UPDATE SET noches_ocupadas = excluded.noches_ocupadas WHERE ?`);
      const ultimaCol = XLSX.utils.decode_range(ocupacion['!ref'] ?? 'A1').e.c;
      for (let col = 7; col <= ultimaCol; col++) {
        const letra = XLSX.utils.encode_col(col);
        const m = /^(\d\d)\/(\d\d)$/.exec(txt(ocupacion, `${letra}1`));
        if (!m || `20${m[2]}-${m[1]}` >= mes) continue; // el mes importado sale de su liquidación
        for (let f = 2; f <= ultimaFila(ocupacion); f++) {
          const noches = ocupacion[`${letra}${f}`]?.v;
          const deptoId = deptoIds.get(txt(ocupacion, `A${f}`));
          if (typeof noches !== 'number' || deptoId === undefined) continue;
          altaHistorico.run(deptoId, `20${m[2]}-${m[1]}`, noches, actualizar);
          reporte.historico++;
        }
      }
    }

    db.prepare(`UPDATE periodo SET estado = 'cerrado', cerrado_en = ? WHERE id = ?`).run(creadoEn, periodoId);
    db.prepare(`INSERT INTO auditoria(fecha, pc, tabla, registro_id, accion, despues_json) VALUES (?, ?, 'periodo', ?, 'alta', ?)`)
      .run(creadoEn, hostname(), periodoId, JSON.stringify({ importacion: 'excel', ...reporte }));
    db.exec('COMMIT');
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
  return reporte;
}
