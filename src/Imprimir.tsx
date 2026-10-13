// Hoja de liquidación de un depto para imprimir a PDF: mismo contenido y orden que la hoja
// por depto del Excel. Se abre en /?imprimir=1&mes=AAAA-MM&depto=COD (Electron la imprime en
// una ventana oculta) y marca document.body.dataset.listo cuando terminó de cargar.
import { useEffect, useState } from 'react';
import type { Hoja } from '../server/liquidacion/hoja.ts';

const fmt = (c: number, decimales = 0) => (c / 100).toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const ars = (c: number) => (c ? `$ ${fmt(c)}` : '$ -');
const usd = (c: number) => (c ? `US$ ${fmt(c, 2)}` : 'US$ -');
const pct = (x: number) => `${(x * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fecha = (iso: string) => iso.split('-').reverse().join('/');
const mesTexto = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

const estilos = `
  @page { size: A4; margin: 12mm; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #111; }
  .hoja { width: 186mm; margin: 0 auto; }
  h1 { font-size: 15px; margin: 10px 0 6px; letter-spacing: .5px; }
  h2 { font-size: 12px; margin: 14px 0 4px; border-bottom: 1.5px solid #333; padding-bottom: 2px; }
  .encabezado { border-bottom: 2px solid #333; padding-bottom: 6px; display: flex; justify-content: space-between; gap: 12px; }
  .encabezado b { font-size: 12px; }
  .grilla { display: grid; grid-template-columns: 1.25fr 1fr; gap: 14px; margin-top: 6px; }
  .caja { border: 1px solid #bbb; padding: 6px 8px; border-radius: 3px; }
  .fila { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .etiqueta { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 3px 4px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: bold; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: bold; border-top: 1.5px solid #333; border-bottom: none; }
  .nota { margin-top: 10px; font-size: 9.5px; color: #444; }
  .salto { break-before: page; }
  .salto table { font-size: 9px; }
  .salto th { white-space: normal; vertical-align: bottom; } /* encabezados en dos líneas: entran las 11 columnas */
  .resumen td { border: none; padding: 2px 4px; }
`;

export function Imprimir() {
  const parametros = new URLSearchParams(location.search);
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
          <div className="fila"><span className="etiqueta">Tarifa diaria prom.</span><span>{ocupables > 0 ? ars((r.bruto + r.gastosDirectos) / ocupables) : '-'}</span></div>
        </div>
        <div>
          <h2>Resumen</h2>
          <table className="resumen"><tbody>
            <tr><td>Bruto</td><td className="n">{ars(r.bruto)}</td><td /></tr>
            <tr><td>Gastos directos</td><td className="n">{ars(r.gastosDirectos)}</td><td className="n">{r.bruto ? pct(r.gastosDirectos / r.bruto) : ''}</td></tr>
            <tr><td>Saldo parcial</td><td className="n">{ars(r.saldoParcial)}</td><td /></tr>
            <tr><td>Honorarios</td><td className="n">{ars(r.honorarios)}</td><td className="n">{r.bruto ? pct(r.honorarios / r.bruto) : ''}</td></tr>
            <tr className="total"><td>Saldo</td><td className="n">{ars(r.saldo)}</td><td className="n">{r.bruto ? pct(r.saldo / r.bruto) : ''}</td></tr>
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
          <tr className="total"><td colSpan={3}>Saldo {mesTexto(h.mes).split(' ')[0]}</td><td className="n">{ars(h.detalle.saldo.ars)}</td><td className="n">{usd(h.detalle.saldo.usd)}</td></tr>
        </tbody>
      </table>
      <p className="nota">Salvo pedido expreso o caso particular, se transferirá el saldo a la cuenta informada o se computará como crédito/débito para el próximo período.</p>

      {h.reservas.length > 0 && (
        <div className="salto">
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
    </div>
  );
}
