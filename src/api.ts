import { useRef, useState } from 'react';

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

export const enviar = <T>(ruta: string, metodo: 'POST' | 'PUT' | 'DELETE', datos: unknown) =>
  pedir<T>(ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });

// PDF suelto de un comprobante: lo arma la PC servidor y baja como archivo. Devuelve el error, si hubo.
export async function descargarPdfComprobante(id: number) {
  const r = await fetch(`/api/comprobantes/${id}/pdf`);
  if (!r.ok) return ((await r.json().catch(() => null))?.error ?? `${r.status} ${r.statusText}`) as string;
  const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'factura.pdf';
  const enlace = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: nombre });
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

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
  parser: (s: string | undefined) => (s ? Number(leerPlata(s)) : (undefined as unknown as number)),
};
// "1.612.004,50" → "1612004.50". Un último punto con 1 o 2 dígitos detrás (el del teclado numérico: "1500.5") es decimal.
export const leerPlata = (s: string) =>
  !s.includes(',') && /\.\d{1,2}$/.test(s) ? s.replace(/\.(?=.*\.)/g, '') : s.replace(/\./g, '').replace(',', '.');
export const simbolo = (moneda?: 'ARS' | 'USD') => (moneda === 'USD' ? 'US$' : '$');

// Centavos → "$ 1.234,56" / "US$ 12,30"
export const pesos = (c: number, moneda: 'ARS' | 'USD' = 'ARS') =>
  `${moneda === 'USD' ? 'US$' : '$'} ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Un "Guardar" que no se manda dos veces: el doble clic llega antes de que el botón se vea cargando.
// Uso: const [guardarUnaVez, guardando] = useUnaVez(guardar); <Modal onOk={guardarUnaVez} confirmLoading={guardando}>
export function useUnaVez(fn: () => Promise<void>) {
  const enCurso = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  const correr = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    try { await fn(); } finally { enCurso.current = false; setOcupado(false); }
  };
  return [correr, ocupado] as const;
}
