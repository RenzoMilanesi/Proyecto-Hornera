// Cliente de la API. Rutas relativas: sirve igual en la PC servidor y en una terminal.
async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${ruta}`, init);
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw Object.assign(new Error(cuerpo?.error ?? `${res.status} ${res.statusText}`), { cuerpo }); // el cuerpo, por si trae más que el error
  }
  return res.json();
}

export const get = <T>(ruta: string) => pedir<T>(ruta);

export const enviar = <T>(ruta: string, metodo: 'POST' | 'PUT', datos: unknown) =>
  pedir<T>(ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });

export const subirArchivo = <T>(ruta: string, archivo: Blob) =>
  pedir<T>(ruta, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });

// Para los InputNumber de plata: muestra "1.612.004,50" y lee lo mismo. Mientras se escribe no reformatea
// (el cursor no salta). Uso: <InputNumber {...entradaPlata} prefix="$" />
export const entradaPlata = {
  formatter: (v: number | string | undefined, info: { userTyping: boolean; input: string }) => {
    if (info.userTyping) return info.input;
    if (v === undefined || v === '') return '';
    const [entero, decimales] = String(v).split('.');
    return entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (decimales ? `,${decimales}` : '');
  },
  parser: (s: string | undefined) => (s ? Number(s.replace(/\./g, '').replace(',', '.')) : (undefined as unknown as number)),
};
export const simbolo = (moneda?: 'ARS' | 'USD') => (moneda === 'USD' ? 'US$' : '$');

// Centavos → "$ 1.234,56" / "US$ 12,30"
export const pesos = (c: number, moneda: 'ARS' | 'USD' = 'ARS') =>
  `${moneda === 'USD' ? 'US$' : '$'} ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
