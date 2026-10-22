// Hoja de liquidación de un depto para imprimir a PDF: mismo contenido y orden que la hoja
// por depto del Excel. Se abre en /?imprimir=1&mes=AAAA-MM&depto=COD (Electron la imprime en
// una ventana oculta) y marca document.body.dataset.listo cuando terminó de cargar.
import { useEffect, useState } from 'react';
import type { Hoja } from '../server/liquidacion/hoja.ts';
import type { DatosComprobante } from '../server/facturacion.ts';

const fmt = (c: number, decimales = 0) => (c / 100).toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const ars = (c: number) => (c ? `$ ${fmt(c)}` : '$ -');
const usd = (c: number) => (c ? `US$ ${fmt(c, 2)}` : 'US$ -');
const pct = (x: number) => `${(x * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fecha = (iso: string) => iso.split('-').reverse().join('/');
const mesTexto = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

const estilos = `
  @page { size: A4; margin: 10mm; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; }
  h1 { font-size: 19px; margin: 12px 0 8px; letter-spacing: .5px; }
  h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 1.5px solid #333; padding-bottom: 3px; }
  .encabezado { border-bottom: 2px solid #333; padding-bottom: 8px; display: flex; justify-content: space-between; gap: 12px; }
  .encabezado b { font-size: 15px; }
  .grilla { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 8px; }
  .caja { border: 1px solid #bbb; padding: 8px 10px; border-radius: 3px; }
  .fila { display: flex; justify-content: space-between; gap: 8px; padding: 1.5px 0; }
  .fila > span:last-child { white-space: nowrap; }
  .etiqueta { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 5px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: bold; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: bold; border-top: 1.5px solid #333; border-bottom: none; }
  .nota { margin-top: 12px; font-size: 11.5px; color: #444; }
  .salto { break-before: page; }
  tr { break-inside: avoid; }
  h2 { break-after: avoid; }
  .reservas table { font-size: 11.5px; }
  .reservas th { white-space: normal; vertical-align: bottom; } /* encabezados en dos líneas: entran las 11 columnas */
  .resumen td { border: none; padding: 2px 4px; }
  .cbte { border: 1.5px solid #333; }
  .cbte table { font-size: 13px; }
  .cbte-cab { display: grid; grid-template-columns: 1fr 64px 1fr; border-bottom: 1.5px solid #333; }
  .cbte-cab > div { padding: 8px 10px; }
  .cbte-letra { border-left: 1.5px solid #333; border-right: 1.5px solid #333; text-align: center; padding: 4px 0 !important; }
  .cbte-letra b { display: block; font-size: 34px; line-height: 1.1; }
  .cbte-seccion { padding: 6px 10px; border-bottom: 1px solid #999; }
  .cbte-total { display: flex; justify-content: flex-end; gap: 24px; padding: 8px 10px; font-size: 13px; font-weight: bold; border-top: 1.5px solid #333; }
  .cbte-pie { display: flex; gap: 14px; align-items: center; margin-top: 10px; }
  .cbte-pie .qr { width: 32mm; height: 32mm; }
  .prueba { border: 2px dashed #b00; color: #b00; text-align: center; font-weight: bold; padding: 4px; margin-bottom: 8px; }
`;

const CONDICION: Record<string, string> = {
  monotributista: 'Responsable Monotributo', responsable_inscripto: 'IVA Responsable Inscripto',
  exento: 'IVA Sujeto Exento', consumidor_final: 'Consumidor Final',
};

// Una factura o NC con su CAE y QR (RG 1415 / RG 4892). Página suelta o al final de la hoja del depto.
function Comprobante({ c }: { c: DatosComprobante }) {
  const pesos2 = (x: number) => `$ ${fmt(x, 2)}`;
  return (
    <div>
      {c.ambiente === 'homologacion' && <div className="prueba">COMPROBANTE DE PRUEBA (HOMOLOGACIÓN): SIN VALIDEZ FISCAL</div>}
      <div className="cbte">
        <div className="cbte-cab">
          <div>
            <b style={{ fontSize: 14 }}>{c.emisor.razon_social}</b>
            {c.emisor.domicilio && <div><span className="etiqueta">Domicilio comercial:</span> {c.emisor.domicilio}</div>}
            <div><span className="etiqueta">Condición frente al IVA:</span> {CONDICION[c.emisor.condicion_iva]}</div>
          </div>
          <div className="cbte-letra"><b>{c.letra}</b>COD. {c.codigo}</div>
          <div>
            <b style={{ fontSize: 14 }}>{c.tipo.replace(/ [ABC]$/, '')}</b>
            <div><span className="etiqueta">Punto de venta y n.º:</span> <b>{c.numero}</b></div>
            <div><span className="etiqueta">Fecha de emisión:</span> {fecha(c.fecha)}</div>
            <div><span className="etiqueta">CUIT:</span> {c.emisor.cuit}</div>
            {c.emisor.ingresos_brutos && <div><span className="etiqueta">Ingresos Brutos:</span> {c.emisor.ingresos_brutos}</div>}
            {c.emisor.inicio_actividades && <div><span className="etiqueta">Inicio de actividades:</span> {fecha(c.emisor.inicio_actividades)}</div>}
          </div>
        </div>
        <div className="cbte-seccion fila">
          <span><span className="etiqueta">Período facturado desde:</span> {fecha(c.servDesde)} <span className="etiqueta">hasta:</span> {fecha(c.servHasta)}</span>
          <span><span className="etiqueta">Fecha de vto. para el pago:</span> {fecha(c.fecha)}</span>
        </div>
        <div className="cbte-seccion">
          <div><span className="etiqueta">{c.receptor.doc_tipo === 80 ? 'CUIT' : 'DNI'}:</span> {c.receptor.doc_nro} · <span className="etiqueta">Apellido y nombre / Razón social:</span> <b>{c.receptor.razon_social}</b></div>
          <div><span className="etiqueta">Condición frente al IVA:</span> {CONDICION[c.receptor.condicion_iva]} · <span className="etiqueta">Domicilio:</span> {c.receptor.domicilio}</div>
          {c.asociado && <div><span className="etiqueta">Comprobante asociado:</span> {c.asociado.tipo} {c.asociado.numero} del {fecha(c.asociado.fecha)}</div>}
        </div>
        <table>
          <thead><tr><th>Descripción</th><th className="n">Importe</th></tr></thead>
          <tbody><tr><td>{c.detalle}</td><td className="n">{pesos2(c.importe - (c.letra === 'A' ? c.iva : 0))}</td></tr></tbody>
        </table>
        {c.letra === 'A' && <div className="cbte-seccion fila"><span className="etiqueta">IVA 21 %</span><span>{pesos2(c.iva)}</span></div>}
        <div className="cbte-total"><span>Importe total</span><span>{pesos2(c.importe)}</span></div>
      </div>
      <div className="cbte-pie">
        <img className="qr" alt="QR de ARCA" src={`data:image/svg+xml;base64,${btoa(c.qr)}`} />
        <div>
          <div><span className="etiqueta">CAE n.º:</span> <b>{c.cae}</b></div>
          <div><span className="etiqueta">Fecha de vto. de CAE:</span> {fecha(c.caeVencimiento)}</div>
          <div className="nota">Comprobante autorizado por ARCA. Moneda: pesos argentinos.</div>
        </div>
      </div>
    </div>
  );
}

// /?imprimir=1&comprobante=ID: el PDF suelto de una factura o NC.
function ImprimirComprobante({ id }: { id: string }) {
  const [c, setC] = useState<DatosComprobante>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch(`/api/comprobantes/${id}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(setC, (e) => { setError(String(e.message ?? e)); document.body.dataset.listo = String(e.message ?? e); });
  }, [id]);
  useEffect(() => { if (c) requestAnimationFrame(() => { document.body.dataset.listo = '1'; }); }, [c]);
  if (error) return <p>{error}</p>;
  return c ? <div className="hoja"><style>{estilos}</style><Comprobante c={c} /></div> : null;
}

export function Imprimir() {
  const parametros = new URLSearchParams(location.search);
  const comprobante = parametros.get('comprobante');
  return comprobante ? <ImprimirComprobante id={comprobante} /> : <ImprimirHoja parametros={parametros} />;
}

function ImprimirHoja({ parametros }: { parametros: URLSearchParams }) {
  const [hoja, setHoja] = useState<Hoja>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch(`/api/hoja?mes=${parametros.get('mes')}&depto=${parametros.get('depto')}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then(setHoja, (e) => { setError(String(e.message ?? e)); document.body.dataset.listo = String(e.message ?? e); });
  }, []);
  useEffect(() => { if (hoja) requestAnimationFrame(() => { document.body.dataset.listo = '1'; }); }, [hoja]);

  if (error) return <p>{error}</p>;
  if (!hoja) return null;
  const h = hoja;
  const mm = h.mes.slice(5) + '/' + h.mes.slice(2, 4);
  const r = h.resumen;
  const ocupables = h.noches.ocupadas - h.noches.propietario;
  const total = (campo: 'nochesPeriodo' | 'importePeriodoArs' | 'importePeriodoUsd' | 'tarifaPeriodo' | 'pagoPlataformaUsd') =>
    h.reservas.reduce((s, x) => s + x[campo], 0);

  return (
    <div className="hoja">
      <style>{estilos}</style>
      <div className="encabezado">
        <div>
          <div><span className="etiqueta">Administrador:</span> <b>{h.empresa.administrador}</b></div>
          <div><span className="etiqueta">Dirección:</span> {h.empresa.direccion}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div><span className="etiqueta">CUIT:</span> {h.empresa.cuit}</div>
          <div><span className="etiqueta">Te.:</span> {h.empresa.telefono} · <span className="etiqueta">E-mail:</span> {h.empresa.email}</div>
        </div>
      </div>

      <h1>DETALLE LIQUIDACIÓN MENSUAL · {mesTexto(h.mes)}</h1>
      <div className="grilla">
        <div className="caja">
          <div className="fila"><span><span className="etiqueta">Inmueble:</span> <b>{h.depto.codigo}</b> · {h.depto.nombre}</span></div>
          {h.depto.direccion && <div>{h.depto.direccion}</div>}
          <div style={{ marginTop: 6 }}><span className="etiqueta">Cliente/facturante:</span> <b>{h.propietario.nombre}</b></div>
          <div><span className="etiqueta">CUIT/CUIL:</span> {h.propietario.cuit ?? '-'} {h.propietario.categoria ?? ''}</div>
          <div><span className="etiqueta">CBU/CVU informado:</span> {h.propietario.cbu}</div>
          {h.propietario.mails && <div><span className="etiqueta">Mails:</span> {h.propietario.mails}</div>}
        </div>
        <div className="caja">
          <div className="fila"><span className="etiqueta">Cambio</span><span>US$ 1,00 = AR$ {h.cambio.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div className="fila"><span className="etiqueta">Comisión administración {h.depto.tipoAdministracion}</span><span>{pct(h.depto.comisionPct)} ingreso neto</span></div>
          <div className="fila"><span className="etiqueta">Servicio de limpieza (por hora, mínimo 2hs)</span><span>{ars(h.servicios.limpieza)}</span></div>
          <div className="fila"><span className="etiqueta">Servicio de lavandería (valet)</span><span>{ars(h.servicios.lavanderia)}</span></div>
          <div className="fila"><span className="etiqueta">Préstamo de blanquería (por plaza)</span><span>{ars(h.servicios.blanqueria)}</span></div>
        </div>
      </div>

      <div className="grilla">
        <div>
          <h2>Período</h2>
          <div className="fila"><span className="etiqueta">Período</span><span>del {fecha(h.inicio)} al {fecha(h.cierre)}</span></div>
          <div className="fila"><span className="etiqueta">Total</span><span>{h.noches.total} noches</span></div>
          <div className="fila"><span className="etiqueta">Disponible</span><span>{h.noches.disponibles} noches</span></div>
          <div className="fila"><span className="etiqueta">No disponible</span><span>{h.noches.noDisponibles} noches</span></div>
          <div className="fila"><span className="etiqueta">Ocupado cliente</span><span>{h.noches.propietario} noches</span></div>
          <div className="fila"><span className="etiqueta">Ocupado</span><span>{h.noches.ocupadas} noches</span></div>
          <div className="fila"><span className="etiqueta">Reservas</span><span>{h.noches.reservas}</span></div>
          <div className="fila"><span className="etiqueta">Ocupación</span><span>{h.noches.disponibles ? pct(h.noches.ocupadas / h.noches.disponibles) : '-'}</span></div>
          <div className="fila"><span className="etiqueta">Tarifa diaria prom.</span><span>{ocupables > 0 ? ars(r.ingresoBruto / ocupables) : '-'}</span></div>
        </div>
        <div>
          <h2>Resumen</h2>
          <table className="resumen"><tbody>
            <tr><td>Ingresos operativos</td><td className="n">{ars(r.ingresosOperativos)}</td><td /></tr>
            <tr><td>Costos</td><td className="n">{ars(r.costos)}</td><td className="n">{r.ingresosOperativos ? pct(r.costos / r.ingresosOperativos) : ''}</td></tr>
            <tr className="total"><td>Ingreso bruto</td><td className="n">{ars(r.ingresoBruto)}</td><td /></tr>
            <tr><td>Honorarios</td><td className="n">{ars(r.honorarios)}</td><td className="n">{r.ingresoBruto ? pct(r.honorarios / r.ingresoBruto) : ''}</td></tr>
            <tr className="total"><td>Valor liquidación inicial</td><td className="n">{ars(r.valorInicial)}</td><td /></tr>
            <tr><td>Gastos Varios</td><td className="n">{ars(r.excepcionales)}</td><td /></tr>
            <tr className="total"><td>Valor liquidación final</td><td className="n">{ars(r.valorFinal)}</td><td /></tr>
          </tbody></table>
        </div>
      </div>

      <h2>DETALLE INGRESOS/EGRESOS</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Detalle</th><th className="n">AR$</th><th className="n">US$</th></tr></thead>
        <tbody>
          <tr><td>{mm}</td><td>Ingresos por reservas {mesTexto(h.mes)}</td><td /><td className="n">{ars(h.detalle.ingresos.ars)}</td><td className="n">{usd(h.detalle.ingresos.usd)}</td></tr>
          <tr><td>{mm}</td><td>Costos operativos por reservas (limp., lav., otros)</td><td /><td className="n">{ars(-h.detalle.costos)}</td><td className="n">{usd(0)}</td></tr>
          <tr><td>{mm}</td><td>Comisiones OTAs/agentes/CM</td><td /><td className="n">{ars(-h.detalle.comisiones.ars)}</td><td className="n">{usd(-h.detalle.comisiones.usd)}</td></tr>
          <tr><td>{mm}</td><td>Honorarios</td><td /><td className="n">{ars(h.detalle.honorarios)}</td><td className="n">{usd(0)}</td></tr>
          <tr><td>{fecha(h.inicio)}</td><td>Saldo mes anterior</td><td /><td className="n">{ars(h.detalle.saldoAnterior.ars)}</td><td className="n">{usd(h.detalle.saldoAnterior.usd)}</td></tr>
          {h.detalle.movimientos.map((m, i) => (
            <tr key={i}><td>{fecha(m.fecha)}</td><td>{m.concepto ?? ''}</td><td>{m.detalle ?? ''}</td><td className="n">{ars(m.ars)}</td><td className="n">{usd(m.usd)}</td></tr>
          ))}
          <tr><td /><td>Cambio moneda</td><td /><td className="n">{ars(h.detalle.conversion.ars)}</td><td className="n">{usd(h.detalle.conversion.usd)}</td></tr>
          {h.detalle.saldadoFuera && (
            <tr><td>{fecha(h.detalle.saldadoFuera.fecha)}</td><td>Saldado por fuera</td><td>{h.detalle.saldadoFuera.nota ?? ''}</td><td /><td /></tr>
          )}
          <tr className="total"><td colSpan={3}>Saldo {mesTexto(h.mes).split(' ')[0]}</td><td className="n">{ars(h.detalle.saldo.ars)}</td><td className="n">{usd(h.detalle.saldo.usd)}</td></tr>
        </tbody>
      </table>
      <p className="nota">Salvo pedido expreso o caso particular, se transferirá el saldo a la cuenta informada o se computará como crédito/débito para el próximo período.</p>

      {h.reservas.length > 0 && (
        <div className="reservas">
          <h2>Detalle reservas · {h.depto.codigo} · {mesTexto(h.mes)}</h2>
          <table>
            <thead><tr>
              <th>Llegada</th><th>Cod. int. reserva</th><th className="n">Huésp.</th><th className="n">Noches período</th>
              <th className="n">Recibido AR$</th><th className="n">Período AR$</th><th className="n">Recibido US$</th><th className="n">Período US$</th>
              <th className="n">Tarifa reserva</th><th className="n">Tarifa período</th><th className="n">Pago x plataforma</th>
            </tr></thead>
            <tbody>
              {h.reservas.map((x, i) => (
                <tr key={i}>
                  <td>{fecha(x.llegada)}</td><td>{x.codigoInterno}</td><td className="n">{x.huespedes}</td><td className="n">{x.nochesPeriodo}</td>
                  <td className="n">{ars(x.importeArs)}</td><td className="n">{ars(x.importePeriodoArs)}</td>
                  <td className="n">{usd(x.importeUsd)}</td><td className="n">{usd(x.importePeriodoUsd)}</td>
                  <td className="n">{ars(x.tarifa)}</td><td className="n">{ars(x.tarifaPeriodo)}</td><td className="n">{usd(x.pagoPlataformaUsd)}</td>
                </tr>
              ))}
              <tr className="total">
                <td colSpan={3}>Totales</td><td className="n">{total('nochesPeriodo')}</td><td /><td className="n">{ars(total('importePeriodoArs'))}</td>
                <td /><td className="n">{usd(total('importePeriodoUsd'))}</td><td /><td className="n">{ars(total('tarifaPeriodo'))}</td>
                <td className="n">{usd(total('pagoPlataformaUsd'))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {h.facturas.map((c) => <div key={c.id} className="salto"><Comprobante c={c} /></div>)}
    </div>
  );
}
