import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Drawer, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { ArrowUpOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Marked } from 'marked';
import { enviar, get, propuestaEnEdicion, subirComprobante } from './api.ts';
import { FormMovimiento, type Cuenta } from './Movimientos.tsx';
import { FormGastoAjeno } from './GastosAjenos.tsx';
import { FormNotas, FormRenglon, type Lista } from './Ficha.tsx';

interface Config { modelo: string; esfuerzo: string }

const MODELOS = [
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5 (el más barato)' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5 (el mejor para análisis, el más caro)' },
];
const ESFUERZOS = [
  { value: 'low', label: 'Bajo (más rápido)' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto (piensa más)' },
];

// Configuración del asistente (plan 061): key, modelo y esfuerzo. Solo en la PC servidor.
export function ConfigAsistente() {
  const [final, setFinal] = useState<string | null>();
  const [editando, setEditando] = useState(false);
  const [config, setConfig] = useState<Config>();
  const [gasto, setGasto] = useState<{ preguntas: number; costo: number }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<{ final: string | null }>('ia/clave').then((r) => setFinal(r.final), (e) => setError(String(e)));
    get<Config>('ia/configuracion').then(setConfig, (e) => setError(String(e)));
    get<{ preguntas: number; costo: number }>('ia/gasto').then(setGasto, (e) => setError(String(e)));
  }, []);

  const guardar = async (cambio: Partial<Config>) => {
    try {
      setConfig(await enviar<Config>('ia/configuracion', 'PUT', cambio));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small" title="API key de Anthropic">
        {final && !editando ? (
          <Space>
            <Typography.Text>Cargada (termina en <b>{final}</b>).</Typography.Text>
            <Button size="small" onClick={() => setEditando(true)}>Cambiar</Button>
          </Space>
        ) : (
          <Form layout="inline" onFinish={async (v: { clave: string }) => {
            try {
              setFinal((await enviar<{ final: string }>('ia/clave', 'PUT', v)).final);
              setEditando(false);
              setError(undefined);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}>
            <Form.Item name="clave" rules={[{ required: true, message: 'Falta la key' }]}>
              <Input.Password placeholder="sk-ant-…" autoComplete="new-password" style={{ width: 360 }} />
            </Form.Item>
            <Form.Item><Button type="primary" htmlType="submit">Guardar</Button></Form.Item>
            {final && <Form.Item><Button onClick={() => setEditando(false)}>Cancelar</Button></Form.Item>}
          </Form>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Se saca en <Typography.Link href="https://console.anthropic.com" target="_blank">console.anthropic.com</Typography.Link> con
          la cuenta del negocio (la suscripción de Claude Pro no sirve para esto). Ahí mismo se pone el tope de gasto mensual.
          La key queda cifrada en esta PC y no viaja en las copias de seguridad.
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="Modelo">
        <Space wrap>
          <Select style={{ width: 360 }} options={MODELOS} value={config?.modelo} loading={!config} onChange={(modelo) => guardar({ modelo })} />
          <Select style={{ width: 200 }} options={ESFUERZOS} value={config?.esfuerzo} loading={!config} onChange={(esfuerzo) => guardar({ esfuerzo })} />
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Sonnet con esfuerzo bajo alcanza para la mayoría de las preguntas. Si una respuesta no convence, "Pensar más" (al pie de
          la respuesta) la repite con esfuerzo alto sin cambiar esto.
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="Gasto de este mes">
        {gasto && (gasto.preguntas === 0 ? 'Todavía no se hizo ninguna pregunta este mes.'
          : <><b>{dolares(gasto.costo)}</b> en {gasto.preguntas === 1 ? '1 pregunta' : `${gasto.preguntas} preguntas`} (en promedio, {dolares(gasto.costo / gasto.preguntas)} cada una).</>)}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Lo calcula la app con los precios de cada modelo, desde todas las PCs. Lo que se cobra de verdad está en la consola de Anthropic.
        </Typography.Paragraph>
      </Card>

      {error && <Alert type="error" showIcon title={error} />}
    </Space>
  );
}

// ---- Panel del asistente (plan 061 paso 6): un Drawer abrible desde cualquier pantalla.

interface Usada { id: string; nombre: string; entrada: Record<string, unknown>; filas: number | null; error?: string }
// Una tarjeta: lo que el asistente propone hacer (plan 068). Se guarda con Confirmar o con el formulario de Editar.
interface Propuesta {
  id: number; tipo: 'movimiento' | 'gasto_personal' | 'ficha' | 'mes'; accion: string; titulo: string; campos: [string, string, string?][];
  args: Record<string, any>; estado: string; resultado: string | null;
}
interface Turno { pregunta: string; texto: string; modelo?: string; esfuerzo?: string; costo?: number | null; herramientas?: Usada[]; propuestas?: Propuesta[] }
interface Conversacion { id: number; titulo: string; actualizada_en: string }

// El mes que muestra la pantalla actual: lo escribe cada pantalla con selector de mes y App lo borra al cambiar de sección.
// ponytail: un objeto suelto y no un contexto de React; el panel solo lo lee al preguntar.
export const mesVisto = { valor: '' };

// claude-sonnet-5-5 → Sonnet 5.5
const nombreModelo = (m: string) => m.replace(/^claude-/, '').replace(/^(\w+?)-(.*)$/, (_, n: string, v: string) => `${n[0].toUpperCase()}${n.slice(1)} ${v.replace(/-/g, '.')}`);
// sello local con offset ('2026-10-24T22:05:00-03:00') → hoy / ayer / 22/10
const cuando = (f: string) => {
  const dia = (d: Date) => d.toLocaleDateString('sv-SE');
  const hoy = new Date();
  if (f.startsWith(dia(hoy))) return 'hoy';
  if (f.startsWith(dia(new Date(hoy.getTime() - 86400000)))) return 'ayer';
  return `${f.slice(8, 10)}/${f.slice(5, 7)}`;
};
const dolares = (c: number) => `US$ ${c.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: c < 0.01 ? 3 : 2 })}`;

// Markdown completo (GFM: títulos, tablas, listas anidadas, código), como en la app de Claude. Sin HTML crudo, imágenes
// ni links: la respuesta puede repetir datos de la base, y una imagen remota los sacaría afuera al cargarse o un link
// javascript: correría dentro de la app.
const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = new Marked({ gfm: true, breaks: true }, {
  renderer: {
    html: ({ text }) => escapar(text),
    image: ({ text }) => escapar(text),
    link({ tokens }) { return this.parser.parseInline(tokens); },
  },
});
function Markdown({ texto }: { texto: string }) {
  return <div className="md-ia" dangerouslySetInnerHTML={{ __html: md.parse(texto, { async: false }) }} />;
}

// Al pie de cada respuesta: modelo, consultas y costo, y qué consultó (para verificar los números).
// pensarMas: solo en la última respuesta, si no salió ya con esfuerzo alto.
function Pie({ t, pensarMas }: { t: Turno; pensarMas?: () => void }) {
  if (!t.modelo) return null;
  const usadas = t.herramientas ?? [];
  return (
    <div style={{ fontSize: 12, color: '#8A7E74', marginTop: 8 }}>
      {nombreModelo(t.modelo)}{t.esfuerzo === 'high' && ' (pensando más)'} · {usadas.length === 1 ? '1 consulta' : `${usadas.length} consultas`}{t.costo != null && ` · ${dolares(t.costo)}`}
      {pensarMas && <> · <Typography.Link style={{ fontSize: 12 }} onClick={pensarMas}>Pensar más</Typography.Link></>}
      {usadas.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer' }}>Cómo lo calculé</summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {usadas.map((u) => {
              const { sql, ...resto } = u.entrada as { sql?: string };
              const datos = Object.entries(resto).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ');
              return (
                <li key={u.id}>
                  <b>{u.nombre}</b>{datos && ` (${datos})`} → {u.error ? <span style={{ color: '#A8071A' }}>{u.error}</span> : u.filas != null ? `${u.filas} filas` : 'ok'}
                  {sql && <pre style={{ whiteSpace: 'pre-wrap', background: '#F5EFE9', padding: 6, margin: '2px 0 0' }}>{sql}</pre>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

const textoError = (e: unknown) => (e instanceof Error ? e.message : String(e));

const ESTADOS: Record<string, [string, string]> = {
  confirmada: ['green', 'Guardada'], editada: ['blue', 'Guardada desde el formulario'], descartada: ['default', 'Descartada'], fallida: ['red', 'No se guardó'],
};
// Editar abre el formulario de la pantalla: solo para cargar o corregir (anular o borrar no tienen formulario; el mes, tampoco).
const editable = (p: Propuesta) => p.tipo !== 'mes' && ['alta', 'edicion', 'notas'].includes(p.accion);

function Tarjeta({ p, ocupada, confirmar, descartar, editar }: {
  p: Propuesta; ocupada: boolean; confirmar: () => void; descartar: () => void; editar: () => void;
}) {
  const estado = ESTADOS[p.estado];
  return (
    <Card size="small" title={p.titulo} style={{ marginTop: 12, borderColor: p.estado === 'pendiente' ? '#A8461F' : undefined }}
      extra={estado && <Tag color={estado[0]}>{estado[1]}</Tag>}>
      <dl className="ficha" style={{ marginBottom: p.estado === 'pendiente' || p.resultado ? 12 : 0 }}>
        {p.campos.map(([k, v, antes]) => (
          <span key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{antes != null ? <><Typography.Text delete type="secondary">{antes}</Typography.Text> → <b>{v}</b></> : v}</dd>
          </span>
        ))}
      </dl>
      {p.estado === 'fallida' && p.resultado && <Alert type="error" showIcon title={p.resultado} />}
      {p.estado === 'pendiente' && (
        <Space>
          <Button type="primary" loading={ocupada} onClick={confirmar}>Confirmar</Button>
          {editable(p) && <Button disabled={ocupada} onClick={editar}>Editar</Button>}
          <Button type="text" disabled={ocupada} onClick={descartar}>Descartar</Button>
        </Space>
      )}
    </Card>
  );
}

// El formulario de la pantalla con lo propuesto, para corregirlo antes de guardar. Lo guardado queda "con IA".
function EditorPropuesta({ p, alCerrar }: { p: Propuesta | null; alCerrar: (guardado: boolean) => void }) {
  const [listas, setListas] = useState<{ deptos: { id: number; codigo: string; nombre: string }[]; cuentas: Cuenta[]; conceptos: string[] }>();
  useEffect(() => {
    if (!p) return;
    Promise.all([get<{ id: number; codigo: string; nombre: string }[]>('deptos'), get<Cuenta[]>('cuentas'), get<{ nombre: string }[]>('conceptos')])
      .then(([deptos, cuentas, conceptos]) => setListas({ deptos, cuentas, conceptos: conceptos.map((c) => c.nombre) }), () => alCerrar(false));
  }, [p]);
  if (!p || !listas) return null;
  const a = p.args;
  if (p.tipo === 'movimiento') {
    return <FormMovimiento abierto mes={a.mes} editando={p.accion === 'edicion' ? (a as any) : undefined} inicial={p.accion === 'alta' ? a : undefined}
      deptos={listas.deptos.map((d) => d.codigo)} cuentas={listas.cuentas} conceptos={listas.conceptos} alCerrar={alCerrar} />;
  }
  if (p.tipo === 'gasto_personal') {
    return <FormGastoAjeno abierto mes={String(a.fecha).slice(0, 7)} editando={p.accion === 'edicion' ? (a as any) : undefined}
      inicial={p.accion === 'alta' ? a : undefined} alCerrar={alCerrar} />;
  }
  const depto = listas.deptos.find((d) => d.id === a.depto_id);
  if (!depto) return null;
  if (p.accion === 'notas') return <FormNotas depto={depto} abierto notas={a.notas} alCerrar={alCerrar} />;
  return <FormRenglon depto={depto} abierto={{ lista: a.lista as Lista, ...(p.accion === 'edicion' ? { fila: { id: a.id, ...a.campos } } : { inicial: a.campos }) }} alCerrar={alCerrar} />;
}

// alGuardar: después de confirmar o editar una tarjeta, para que la pantalla abierta muestre lo nuevo.
export function PanelAsistente({ abierto, alCerrar, ancho, maxAncho, alRedimensionar, pantalla, alGuardar }:
  { abierto: boolean; alCerrar: () => void; ancho: number; maxAncho: number; alRedimensionar: (ancho: number) => void; pantalla: string; alGuardar?: () => void }) {
  const [estado, setEstado] = useState<{ disponible: boolean; motivo?: string }>();
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [esperando, setEsperando] = useState<string>();
  const [error, setError] = useState<string>();
  const [gasto, setGasto] = useState<number>();
  const [adjuntos, setAdjuntos] = useState<{ id: number; nombre: string }[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [ocupadas, setOcupadas] = useState<number[]>([]);
  const [editando, setEditando] = useState<Propuesta | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const archivo = useRef<HTMLInputElement>(null);

  // Las tarjetas viven dentro de los turnos: se reemplaza la que cambió.
  const cambiar = (id: number, cambios: Partial<Propuesta>) =>
    setTurnos((ts) => ts.map((t) => (t.propuestas?.some((x) => x.id === id) ? { ...t, propuestas: t.propuestas.map((x) => (x.id === id ? { ...x, ...cambios } : x)) } : t)));
  const confirmar = async (p: Propuesta) => {
    setOcupadas((o) => [...o, p.id]);
    try {
      const r = await enviar<{ estado: string; resultado: unknown }>(`ia/propuestas/${p.id}/confirmar`, 'POST', {});
      cambiar(p.id, { estado: r.estado, resultado: r.estado === 'fallida' ? String(r.resultado) : null });
      if (r.estado === 'confirmada') alGuardar?.();
    } catch (e) {
      setError(textoError(e));
    } finally {
      setOcupadas((o) => o.filter((x) => x !== p.id));
    }
  };
  // De a una y en orden: si una falla, las demás se guardan igual.
  const confirmarTodas = async (ps: Propuesta[]) => { for (const p of ps) await confirmar(p); };
  const descartar = (p: Propuesta) => enviar(`ia/propuestas/${p.id}/descartar`, 'POST', {}).then(() => cambiar(p.id, { estado: 'descartada' }), (e) => setError(textoError(e)));
  const editar = (p: Propuesta) => { propuestaEnEdicion.id = p.id; setEditando(p); };
  const finEdicion = (guardado: boolean) => {
    if (guardado && editando) { cambiar(editando.id, { estado: 'editada' }); alGuardar?.(); }
    propuestaEnEdicion.id = null;
    setEditando(null);
  };
  const adjuntar = async (lista: FileList | null | undefined) => {
    setSubiendo(true);
    try {
      for (const a of Array.from(lista ?? [])) {
        const id = await subirComprobante(a);
        setAdjuntos((xs) => [...xs, { id, nombre: a.name }]);
      }
    } catch (e) {
      setError(textoError(e));
    } finally {
      setSubiendo(false);
    }
  };

  const listar = () => get<Conversacion[]>('ia/conversaciones').then(setConversaciones, (e) => setError(textoError(e)));
  // ponytail: si falla, el título queda sin el gasto; no vale un error en el panel.
  const leerGasto = () => get<{ costo: number }>('ia/gasto').then((g) => setGasto(g.costo), () => {});
  useEffect(() => {
    if (!abierto) return;
    get<{ disponible: boolean; motivo?: string }>('ia/estado').then(setEstado, (e) => setError(textoError(e)));
    listar();
    leerGasto();
  }, [abierto]);
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }); }, [turnos, esperando]);

  const abrir = async (id: number | null) => {
    setError(undefined);
    setConvId(id);
    if (id == null) return setTurnos([]);
    try {
      setTurnos((await get<{ turnos: Turno[] }>(`ia/conversaciones/${id}`)).turnos);
    } catch (e) {
      setError(textoError(e));
    }
  };
  const borrar = async () => {
    try {
      await enviar(`ia/conversaciones/${convId}`, 'DELETE', {});
      await abrir(null);
      listar();
    } catch (e) {
      setError(textoError(e));
    }
  };
  // Sin esfuerzo, la pregunta del cuadro en esta conversación. "Pensar más" repite la última con esfuerzo alto en una
  // conversación nueva: cambiar el esfuerzo en la misma invalidaría su caché, y así es una segunda opinión (plan 066).
  const preguntar = async (repetir?: string) => {
    const conAdjunto = !repetir && adjuntos.length > 0;
    const p = (repetir ?? pregunta).trim() || (conAdjunto ? 'Leé el comprobante y proponé el gasto.' : '');
    if (!p || esperando || subiendo) return;
    const enviados = repetir ? [] : adjuntos;
    const conv = repetir ? null : convId;
    if (repetir) { setConvId(null); setTurnos([]); }
    setEsperando(p);
    if (!repetir) { setPregunta(''); setAdjuntos([]); }
    setError(undefined);
    try {
      const r = await enviar<Turno & { conversacion_id: number | null }>('ia/preguntar', 'POST',
        { conversacion_id: conv, pregunta: p, pantalla, mes: mesVisto.valor, esfuerzo: repetir ? 'high' : undefined, adjuntos: enviados.map((a) => a.id) });
      setTurnos((ts) => [...ts, { ...r, pregunta: p }]);
      leerGasto();
      if (r.conversacion_id != null && r.conversacion_id !== conv) { setConvId(r.conversacion_id); listar(); }
    } catch (e) {
      if (!repetir) { setPregunta(p); setAdjuntos(enviados); } // para reintentar sin volver a cargarla
      setError(textoError(e));
    } finally {
      setEsperando(undefined);
    }
  };

  const noDisponible = estado?.disponible === false;
  // Sin conversación abierta el campo va arriba, con las conversaciones recientes debajo; en una conversación, al pie.
  const vacio = turnos.length === 0 && !esperando;
  const campo = (
    <div className="campo-ia">
      {adjuntos.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {adjuntos.map((a) => <Tag key={a.id} closable onClose={() => setAdjuntos((xs) => xs.filter((x) => x.id !== a.id))} icon={<PaperClipOutlined />}>{a.nombre}</Tag>)}
        </div>
      )}
      <Input.TextArea variant="borderless" value={pregunta} onChange={(e) => setPregunta(e.target.value)} autoSize={{ minRows: vacio ? 2 : 1, maxRows: 6 }}
        disabled={noDisponible} style={{ padding: '2px 4px' }} autoFocus
        placeholder="Preguntá, pedí que cargue algo o arrastrá un ticket" onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); preguntar(); } }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <Button type="text" size="small" title="Adjuntar un ticket o una factura (foto o PDF)" loading={subiendo} disabled={noDisponible}
          icon={<PaperClipOutlined />} onClick={() => archivo.current?.click()} />
        <Button type="primary" shape="circle" size="small" title="Preguntar (Enter)" onClick={() => preguntar()} loading={!!esperando}
          disabled={noDisponible || subiendo} icon={<ArrowUpOutlined />} />
      </div>
    </div>
  );
  return (
    <Drawer open={abierto} onClose={alCerrar} size={ancho} maxSize={Math.min(900, maxAncho)} mask={false}
      resizable={{ onResize: (n) => alRedimensionar(Math.max(360, n)) }}
      title={vacio ? 'Asistente' : <Typography.Text ellipsis>{conversaciones.find((c) => c.id === convId)?.titulo ?? 'Conversación nueva'}</Typography.Text>}
      extra={!vacio && (
        <Space size={4}>
          <Button type="text" title="Volver a las conversaciones" onClick={() => abrir(null)} disabled={!!esperando}>＋ Nueva</Button>
          {convId != null && <Button type="text" danger title="Borrar esta conversación" onClick={borrar} disabled={!!esperando}>Borrar</Button>}
        </Space>
      )}
      footer={<>
        <input ref={archivo} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" hidden
          onChange={(e) => { void adjuntar(e.target.files); e.target.value = ''; }} />
        {!vacio && campo}
        <div style={{ fontSize: 11.5, color: '#A39588', marginTop: vacio ? 0 : 6 }}>
          Lo que preguntás y los datos que consulta se envían a Anthropic{gasto != null && ` · ${dolares(gasto)} este mes`}
        </div>
      </>}>
      <div style={{ minHeight: '100%' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!noDisponible) void adjuntar(e.dataTransfer.files); }}>
      {noDisponible && <Alert type="warning" showIcon title="El asistente no está disponible" description={estado.motivo} style={{ marginBottom: 12 }} />}
      {vacio && (
        <>
          {campo}
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: '8px 2px 20px' }}>
            Sabe en qué pantalla y mes estás. Si le pedís cargar algo, arma una tarjeta: no se guarda nada hasta que tocás Confirmar.
          </Typography.Paragraph>
          {conversaciones.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#8A7E74', margin: '0 6px 4px' }}>Recientes</div>
              {conversaciones.slice(0, verTodas ? undefined : 5).map((c) => (
                <div key={c.id} className="reciente-ia" onClick={() => abrir(c.id)}>
                  <Typography.Text ellipsis style={{ flex: 1 }}>{c.titulo}</Typography.Text>
                  <span style={{ color: '#A39588', fontSize: 12 }}>{cuando(c.actualizada_en)}</span>
                </div>
              ))}
              {conversaciones.length > 5 && (
                <Typography.Link style={{ display: 'block', padding: '8px 6px', fontSize: 13 }} onClick={() => setVerTodas((v) => !v)}>
                  {verTodas ? 'Ver menos' : `Ver todas (${conversaciones.length})`}
                </Typography.Link>
              )}
            </>
          )}
        </>
      )}
      {[...turnos, ...(esperando ? [{ pregunta: esperando, texto: '' }] : [])].map((t, i) => (
        <div key={i} style={{ marginBottom: 24 }}>
          <div className="pregunta-ia">{t.pregunta}</div>
          <div>
            {t.texto ? <Markdown texto={t.texto} /> : <Typography.Text type="secondary">Pensando…</Typography.Text>}
            {t.propuestas?.map((p) => (
              <Tarjeta key={p.id} p={p} ocupada={ocupadas.includes(p.id)} confirmar={() => confirmar(p)} descartar={() => descartar(p)} editar={() => editar(p)} />
            ))}
            {(t.propuestas?.filter((p) => p.estado === 'pendiente').length ?? 0) > 1 && (
              <Button style={{ marginTop: 8 }} disabled={ocupadas.length > 0}
                onClick={() => confirmarTodas(t.propuestas!.filter((p) => p.estado === 'pendiente'))}>Confirmar todas</Button>
            )}
            <Pie t={t} pensarMas={i === turnos.length - 1 && !esperando && t.esfuerzo !== 'high' ? () => preguntar(t.pregunta) : undefined} />
          </div>
        </div>
      ))}
      {error && <Alert type="error" showIcon title={error} />}
      <div ref={fin} />
      </div>
      <EditorPropuesta p={editando} alCerrar={finEdicion} />
    </Drawer>
  );
}
