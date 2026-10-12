// Cliente de la API de Stays (https://<cuenta>.stays.net/external/v1), con Basic auth.
// Mismos endpoints que los scripts de balances-hornera.
import * as XLSX from 'xlsx';

export const URL_STAYS = 'https://hrnr.stays.net/external/v1';

export interface Credenciales { usuario: string; clave: string }
export type FilaReserva = Record<string, string | number | boolean | null>;

export interface PagoStays {
  _id: string;
  _idpaymentProvider: string;
  _idreserve?: string;
  type: string;            // credit | debit
  status: string;          // completed | pending | ...
  name?: string;           // "res. fee API airbnb"
  _f_val: number;
  _f_tax?: number | null;
  paymentDate?: string;
}

export interface MedioStays {
  _id: string;
  type: string;            // mercadopago | paypal | bank | user
  status: string;
  internalName?: string;
  currencies?: string[];
}

export interface ClienteStays {
  mediosDePago(): Promise<MedioStays[]>;
  exportarReservas(desde: string, hasta: string, tipoFecha: 'arrival' | 'departure' | 'included'): Promise<FilaReserva[]>;
  pagos(codigoReserva: string): Promise<PagoStays[]>;
}

export function crearClienteStays({ usuario, clave }: Credenciales, base = URL_STAYS): ClienteStays {
  const auth = 'Basic ' + Buffer.from(`${usuario}:${clave}`).toString('base64');
  const pedir = async (ruta: string) => {
    const res = await fetch(`${base}/${ruta}`, { headers: { Authorization: auth }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (res.status === 401 || res.status === 403) throw new Error('Stays rechazó el usuario o la clave.');
    if (!res.ok) throw new Error(`Stays respondió ${res.status} en ${ruta.split('?')[0]}: ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  return {
    // Sin filtrar por activos: un pago viejo puede usar un medio dado de baja.
    mediosDePago: async () => (await pedir('finance/payment-providers')).json(),
    async exportarReservas(desde, hasta, tipoFecha) {
      const res = await pedir(`booking/reservations-export?from=${desde}&to=${hasta}&dateType=${tipoFecha}`);
      const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' });
      return XLSX.utils.sheet_to_json<FilaReserva>(wb.Sheets[wb.SheetNames[0]], { defval: null });
    },
    pagos: async (codigo) => (await pedir(`booking/reservations/${encodeURIComponent(codigo)}/payments`)).json(),
  };
}
