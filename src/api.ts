import { useRef, useState } from 'react';

// Cliente de la API. Rutas relativas: sirve igual en la PC servidor y en una terminal.
// La tarjeta del asistente cuyo formulario está abierto ("Editar", plan 068): lo que se guarde va "con IA".
// ponytail: un objeto suelto, como mesVisto; hay un solo formulario abierto por vez.
export const propuestaEnEdicion = { id: null as number | null };

// Sin conexión con el servidor (terminal con el servidor apagado o la red cortada): fetch tira TypeError.
// Se avisa a App (banner "Sin conexión") y el error dice qué pasó.
export const SIN_CONEXION = 'Se cortó la conexión con el servidor: no se guardó ni se trajo nada. Revisá que la PC servidor esté prendida, con Hornera abierta.';
export async function red(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    globalThis.dispatchEvent?.(new Event('hornera:sin-conexion'));
    throw new Error(SIN_CONEXION);
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  if (propuestaEnEdicion.id != null && init?.method && init.method !== 'GET' && !ruta.startsWith('adjuntos')) {
    init = { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Hornera-Ia': String(propuestaEnEdicion.id) } };
  }
  const res = await red(`/api/${ruta}`, init);
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    if (res.status === 401 && cuerpo?.emparejar) globalThis.location?.reload(); // revocada: App vuelve a pedir el código
    throw Object.assign(new Error(cuerpo?.error ?? `${res.status} ${res.statusText}`), { cuerpo }); // el cuerpo, por si trae más que el error
  }
  return res.json();
}

export const get = <T>(ruta: string) => pedir<T>(ruta);

export const enviar = <T>(ruta: string, metodo: 'POST' | 'PUT' | 'DELETE', datos: unknown) =>
  pedir<T>(ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });

// PDF suelto de un comprobante: lo arma la PC servidor y baja como archivo. Devuelve el error, si hubo.
export async function descargarPdfComprobante(id: number) {
  const r = await red(`/api/comprobantes/${id}/pdf`);
  if (!r.ok) return ((await r.json().catch(() => null))?.error ?? `${r.status} ${r.statusText}`) as string;
  const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'factura.pdf';
  const enlace = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: nombre });
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

export const subirArchivo = <T>(ruta: string, archivo: Blob) =>
  pedir<T>(ruta, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });

// Comprobante de un movimiento (plan 068): la foto se achica antes de subir (lado mayor 1600 px, JPEG); el PDF va tal cual.
export async function subirComprobante(archivo: File) {
  let datos: Blob = archivo;
  if (archivo.type.startsWith('image/')) {
    const img = await createImageBitmap(archivo);
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const lienzo = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * escala), height: Math.round(img.height * escala) });
    lienzo.getContext('2d')!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    datos = await new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo leer la foto.'))), 'image/jpeg', 0.8));
  }
  return (await subirArchivo<{ id: number }>(`adjuntos?nombre=${encodeURIComponent(archivo.name)}`, datos)).id;
}
export const verComprobante = (id: number) => window.open(`/api/adjuntos/${id}`, '_blank');

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
