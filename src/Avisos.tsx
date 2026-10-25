// Campanita (server/avisos.ts): lo que está mal o por vencer y lo importante de otras PCs.
// El número cuenta los avisos con alguna parte (clave 'a,b') que esta PC no vio; abrir la lista lo da por visto. Un problema se va de la lista al resolverlo.
import { useEffect, useState } from 'react';
import { Badge, Button, Popover, Typography } from 'antd';
import { get } from './api.ts';

interface Aviso { clave: string; nivel: 'rojo' | 'naranja' | 'info'; texto: string; seccion: string; fecha?: string }
interface Avisos { problemas: Aviso[]; otrasPcs: Aviso[] }

const COLOR = { rojo: '#cf1322', naranja: '#d46b08', info: '#8c8c8c' };
const CADA_MS = 60_000;

// Lo visto, en esta PC (cada PC tiene su navegador). Sin almacenamiento, todo cuenta como nuevo.
const leerVistos = (): string[] => { try { return JSON.parse(localStorage.getItem('avisos.vistos') ?? '[]'); } catch { return []; } };
const guardarVistos = (v: string[]) => { try { localStorage.setItem('avisos.vistos', JSON.stringify(v)); } catch { /* no importa */ } };

// Fila de la lista: el mismo resalte con el mouse que con Tab.
const resaltar = (e: { currentTarget: HTMLElement }) => { e.currentTarget.style.background = '#f5f0eb'; };
const apagar = (e: { currentTarget: HTMLElement }) => { e.currentTarget.style.background = ''; e.currentTarget.style.outline = ''; };

const Campana = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export function Campanita({ irA }: { irA: (seccion: string) => void }) {
  const [avisos, setAvisos] = useState<Avisos>({ problemas: [], otrasPcs: [] });
  const [vistos, setVistos] = useState(leerVistos);
  const [abierta, setAbierta] = useState(false);
  useEffect(() => {
    const traer = () => get<Avisos>('avisos').then(setAvisos, () => {}); // sin red: queda lo último, sin cartel
    traer();
    const reloj = setInterval(traer, CADA_MS);
    window.addEventListener('focus', traer);
    return () => { clearInterval(reloj); window.removeEventListener('focus', traer); };
  }, []);

  const todos = [...avisos.problemas, ...avisos.otrasPcs];
  const partes = (a: Aviso) => a.clave.split(',');
  const visto = (a: Aviso) => partes(a).every((p) => vistos.includes(p)); // pagar uno de dos vencidos no hace nuevo al otro
  const nuevos = todos.filter((a) => !visto(a)).length;
  const grave = avisos.problemas.some((a) => a.nivel === 'rojo');
  const abrir = (si: boolean) => {
    setAbierta(si);
    if (!si) return;
    const v = todos.flatMap(partes); // solo las de ahora: lo resuelto no se acumula
    setVistos(v);
    guardarVistos(v);
  };
  const fila = (a: Aviso) => (
    <button key={a.clave} type="button" onClick={() => { abrir(false); irA(a.seccion); }}
      style={{ all: 'unset', boxSizing: 'border-box', display: 'flex', gap: 8, width: '100%', padding: '6px 4px', cursor: 'pointer', borderRadius: 4 }}
      onMouseEnter={resaltar} onMouseLeave={apagar} onBlur={apagar}
      onFocus={(e) => { resaltar(e); if (e.currentTarget.matches(':focus-visible')) e.currentTarget.style.outline = '2px solid #B5835A'; }}>
      <span style={{ flex: 'none', width: 8, height: 8, marginTop: 7, borderRadius: '50%', background: COLOR[a.nivel] }} />
      <span style={{ fontWeight: visto(a) ? 400 : 600 }}>
        {a.fecha && <Typography.Text type="secondary">{a.fecha.slice(8, 10)}/{a.fecha.slice(5, 7)} {a.fecha.slice(11, 16)} · </Typography.Text>}
        {a.texto}
      </span>
    </button>
  );
  const contenido = (
    <div style={{ width: 380, maxHeight: 460, overflow: 'auto' }}>
      {avisos.problemas.length ? avisos.problemas.map(fila) : <Typography.Text type="secondary">Nada pendiente.</Typography.Text>}
      {avisos.otrasPcs.length > 0 && <>
        <Typography.Text type="secondary" strong style={{ display: 'block', margin: '12px 0 4px', fontSize: 12, letterSpacing: 0.5 }}>OTRAS PCS · ÚLTIMOS 7 DÍAS</Typography.Text>
        {avisos.otrasPcs.map(fila)}
      </>}
    </div>
  );
  // getPopupContainer: la lista va justo después de la campanita, así Tab llega a los avisos.
  return (
    <Popover getPopupContainer={(n) => n.parentElement ?? document.body} open={abierta} onOpenChange={abrir} trigger="click" placement="bottomRight" title="Avisos" content={contenido}>
      <Badge count={nuevos} size="small" offset={[-4, 4]}>
        <Button type="text" shape="circle" aria-label={`Avisos${nuevos ? `: ${nuevos} nuevos` : ''}`} icon={<Campana color={grave ? COLOR.rojo : '#4A3F37'} />} />
      </Badge>
    </Popover>
  );
}
