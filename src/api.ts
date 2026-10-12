// Cliente de la API. Rutas relativas: sirve igual en la PC servidor y en una terminal.
async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${ruta}`, init);
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw new Error(cuerpo?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const get = <T>(ruta: string) => pedir<T>(ruta);

export const enviar = <T>(ruta: string, metodo: 'POST' | 'PUT', datos: unknown) =>
  pedir<T>(ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });

export const subirArchivo = <T>(ruta: string, archivo: Blob) =>
  pedir<T>(ruta, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });

// Centavos → "$ 1.234,56" / "US$ 12,30"
export const pesos = (c: number, moneda: 'ARS' | 'USD' = 'ARS') =>
  `${moneda === 'USD' ? 'US$' : '$'} ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
