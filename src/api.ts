// Cliente de la API. Rutas relativas: sirve igual en la PC servidor y en una terminal.
export async function get<T>(ruta: string): Promise<T> {
  const res = await fetch(`/api/${ruta}`);
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw new Error(cuerpo?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}
