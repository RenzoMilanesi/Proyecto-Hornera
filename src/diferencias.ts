// "Solo con diferencias" de Liquidación, después de comparar con el Excel. Sin React para poder testearlo.
import type { ComparacionDepto } from '../server/liquidacion/comparar.ts';

interface Depto { codigo: string; moneda: 'ARS' | 'USD'; pagoDirecto?: { revisado: boolean } | null }

/** Diferencia de saldo app − Excel en pesos (los USD al cambio del mes); null si no hay con qué comparar. */
export const difSaldoEnPesos = (d: Depto, c: ComparacionDepto | undefined, cambio: number) =>
  c?.difSaldo == null ? null : d.moneda === 'USD' ? c.difSaldo * cambio : c.difSaldo;

/**
 * Oculta los iguales al Excel. Primero los que no están en el Excel, después la diferencia de saldo de
 * mayor a menor (a favor o en contra) y al final los de saldo igual con otro campo distinto (quedan con 0).
 * Un posible pago directo sin revisar entra aunque dé igual: el Excel puede tenerlo y la app no.
 */
export function soloConDiferencias<D extends Depto>(deptos: D[], comparacion: Map<string, ComparacionDepto>, cambio: number): D[] {
  const peso = (d: D) => {
    const c = comparacion.get(d.codigo);
    return c?.estado === 'solo_app' ? Infinity : Math.abs(difSaldoEnPesos(d, c, cambio) ?? 0);
  };
  return deptos.filter((d) => ['distinto', 'solo_app'].includes(comparacion.get(d.codigo)?.estado ?? '') || (d.pagoDirecto && !d.pagoDirecto.revisado))
    .sort((a, b) => peso(b) - peso(a) || a.codigo.localeCompare(b.codigo));
}
