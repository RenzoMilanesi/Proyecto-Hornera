import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Drawer, Form, Input, Select, Space, Typography } from 'antd';
import { enviar, get } from './api.ts';

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
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<{ final: string | null }>('ia/clave').then((r) => setFinal(r.final), (e) => setError(String(e)));
    get<Config>('ia/configuracion').then(setConfig, (e) => setError(String(e)));
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
          Sonnet con esfuerzo medio alcanza para la mayoría de las preguntas. Si se equivoca en análisis, probar Opus; si sobra, Haiku.
        </Typography.Paragraph>
      </Card>

      {error && <Alert type="error" showIcon title={error} />}
    </Space>
  );
}

// ---- Panel del asistente (plan 061 paso 6): un Drawer abrible desde cualquier pantalla.

interface Usada { id: string; nombre: string; entrada: Record<string, unknown>; filas: number | null; error?: string }
interface Turno { pregunta: string; texto: string; modelo?: string; costo?: number | null; herramientas?: Usada[] }
interface Conversacion { id: number; titulo: string }

// El mes que muestra la pantalla actual: lo escribe cada pantalla con selector de mes y App lo borra al cambiar de sección.
// ponytail: un objeto suelto y no un contexto de React; el panel solo lo lee al preguntar.
export const mesVisto = { valor: '' };

// claude-sonnet-5-5 → Sonnet 5.5
const nombreModelo = (m: string) => m.replace(/^claude-/, '').replace(/^(\w+?)-(.*)$/, (_, n: string, v: string) => `${n[0].toUpperCase()}${n.slice(1)} ${v.replace(/-/g, '.')}`);
const dolares = (c: number) => `US$ ${c.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: c < 0.01 ? 3 : 2 })}`;

// Markdown mínimo de las respuestas: párrafos, listas, tablas con | y **negrita**, _cursiva_, `código`.
function enLinea(t: string) {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`|\b_[^_]+_\b)/).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b>
      : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code>
        : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : p);
}
function Markdown({ texto }: { texto: string }) {
  const bloques: { tipo: 'tabla' | 'lista' | 'texto'; lineas: string[] }[] = [];
  for (const linea of texto.split('\n')) {
    const tipo = linea.trim().startsWith('|') ? 'tabla' : /^\s*([-*]|\d+\.) /.test(linea) ? 'lista' : 'texto';
    const ultimo = bloques[bloques.length - 1];
    if (!linea.trim()) bloques.push({ tipo: 'texto', lineas: [] });
    else if (ultimo?.tipo === tipo) ultimo.lineas.push(linea);
    else bloques.push({ tipo, lineas: [linea] });
  }
  return bloques.filter((b) => b.lineas.length).map((b, i) => {
    if (b.tipo === 'tabla') {
      const filas = b.lineas.filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const [cabecera, ...cuerpo] = filas;
      // Columnas con números (montos, noches) a la derecha.
      const derecha = cabecera.map((_, j) => cuerpo.length > 0 && cuerpo.every((f) => !f[j] || /^[-$US\s]*[\d.,]+\s*%?$/.test(f[j])));
      const celda = (j: number) => ({ textAlign: derecha[j] ? 'right' as const : 'left' as const });
      return (
        <table key={i} className="tabla-ia">
          <thead><tr>{cabecera.map((c, j) => <th key={j} style={celda(j)}>{enLinea(c)}</th>)}</tr></thead>
          <tbody>{cuerpo.map((f, k) => <tr key={k}>{cabecera.map((_, j) => <td key={j} style={celda(j)}>{enLinea(f[j] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      );
    }
    if (b.tipo === 'lista') return <ul key={i} style={{ margin: '0 0 8px', paddingLeft: 20 }}>{b.lineas.map((l, k) => <li key={k}>{enLinea(l.replace(/^\s*([-*]|\d+\.) /, ''))}</li>)}</ul>;
    return <p key={i} style={{ margin: '0 0 8px' }}>{b.lineas.map((l, k) => <span key={k}>{k > 0 && <br />}{enLinea(l.replace(/^#+ /, ''))}</span>)}</p>;
  });
}

// Al pie de cada respuesta: modelo, consultas y costo, y qué consultó (para verificar los números).
function Pie({ t }: { t: Turno }) {
  if (!t.modelo) return null;
  const usadas = t.herramientas ?? [];
  return (
    <div style={{ fontSize: 12, color: '#8A7E74', marginTop: 4 }}>
      {nombreModelo(t.modelo)} · {usadas.length === 1 ? '1 consulta' : `${usadas.length} consultas`}{t.costo != null && ` · ${dolares(t.costo)}`}
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

export function PanelAsistente({ abierto, alCerrar, pantalla }: { abierto: boolean; alCerrar: () => void; pantalla: string }) {
  const [estado, setEstado] = useState<{ disponible: boolean; motivo?: string }>();
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [esperando, setEsperando] = useState<string>();
  const [error, setError] = useState<string>();
  const fin = useRef<HTMLDivElement>(null);

  const listar = () => get<Conversacion[]>('ia/conversaciones').then(setConversaciones, (e) => setError(textoError(e)));
  useEffect(() => {
    if (!abierto) return;
    get<{ disponible: boolean; motivo?: string }>('ia/estado').then(setEstado, (e) => setError(textoError(e)));
    listar();
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
  const preguntar = async () => {
    const p = pregunta.trim();
    if (!p || esperando) return;
    setEsperando(p);
    setPregunta('');
    setError(undefined);
    try {
      const r = await enviar<Turno & { conversacion_id: number | null }>('ia/preguntar', 'POST', { conversacion_id: convId, pregunta: p, pantalla, mes: mesVisto.valor });
      setTurnos((ts) => [...ts, { ...r, pregunta: p }]);
      if (r.conversacion_id != null && r.conversacion_id !== convId) { setConvId(r.conversacion_id); listar(); }
    } catch (e) {
      setPregunta(p); // para reintentar sin volver a escribirla
      setError(textoError(e));
    } finally {
      setEsperando(undefined);
    }
  };

  const noDisponible = estado?.disponible === false;
  return (
    <Drawer open={abierto} onClose={alCerrar} size={560} mask={false} title="Asistente"
      extra={
        <Space>
          <Select style={{ width: 200 }} placeholder="Conversaciones anteriores" value={convId ?? undefined} onChange={abrir} disabled={!!esperando}
            options={conversaciones.map((c) => ({ value: c.id, label: c.titulo }))} />
          <Button onClick={() => abrir(null)} disabled={!!esperando}>Nueva</Button>
          {convId != null && <Button danger onClick={borrar} disabled={!!esperando}>Borrar</Button>}
        </Space>
      }
      footer={
        <Space.Compact style={{ width: '100%' }}>
          <Input.TextArea value={pregunta} onChange={(e) => setPregunta(e.target.value)} autoSize={{ minRows: 1, maxRows: 6 }} disabled={noDisponible}
            placeholder="Preguntá sobre los datos, el uso de la app o pedí un análisis" onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); preguntar(); } }} />
          <Button type="primary" onClick={preguntar} loading={!!esperando} disabled={noDisponible}>Preguntar</Button>
        </Space.Compact>
      }>
      {noDisponible && <Alert type="warning" showIcon title="El asistente no está disponible" description={estado.motivo} style={{ marginBottom: 12 }} />}
      {turnos.length === 0 && !esperando && !noDisponible && (
        <Typography.Paragraph type="secondary">
          Contesta con los datos de la app (solo los lee, no cambia nada), cómo se usa y análisis. Sabe en qué pantalla y mes estás.
          Lo que preguntás y los datos que consulta se mandan a Anthropic.
        </Typography.Paragraph>
      )}
      {[...turnos, ...(esperando ? [{ pregunta: esperando, texto: '' }] : [])].map((t, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div className="burbuja-ia burbuja-ia-usuario">{t.pregunta}</div>
          <div className="burbuja-ia">
            {t.texto ? <Markdown texto={t.texto} /> : <Typography.Text type="secondary">Pensando…</Typography.Text>}
            <Pie t={t} />
          </div>
        </div>
      ))}
      {error && <Alert type="error" showIcon title={error} />}
      <div ref={fin} />
    </Drawer>
  );
}
