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

export const subirArchivo = <T>(ruta: string, archivo: Blob) =>
  pedir<T>(ruta, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
