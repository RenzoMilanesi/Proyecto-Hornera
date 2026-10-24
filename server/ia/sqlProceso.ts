// consulta_sql del asistente en un proceso aparte (plan 063): node:sqlite es sincrónico y no se puede interrumpir,
// así que una consulta sin fin congelaría el servidor. Matar el proceso sí la corta (un Worker no: terminate() espera
// a que SQLite devuelva el control, y una consulta infinita no lo devuelve nunca).
import { DatabaseSync, constants as c } from 'node:sqlite';

// Tablas que la IA nunca ve: el hash de los tokens de las terminales y la configuración (ticket de ARCA, etc.).
export const OCULTAS = ['terminal', 'configuracion', 'adjunto', 'propuesta_ia'];
export const MAX_FILAS = 200;
// raw_json y desglose_json de una reserva pesan KB: cada texto largo se corta (plan 064).
export const MAX_CELDA = 2000;

const cortar = (fila: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(fila)) {
    if (typeof v === 'string' && v.length > MAX_CELDA) fila[k] = `${v.slice(0, MAX_CELDA)}… (cortado: ${v.length} caracteres)`;
  }
  return fila;
};

export interface PedidoSql { ruta: string; sql: string }
export type RespuestaSql = { filas: unknown[]; aviso?: string } | { error: string };

export function correrSql({ ruta, sql }: PedidoSql): RespuestaSql {
  // Cerco 1: aunque el texto diga DELETE, SQLite no escribe en una conexión de solo lectura.
  const db = new DatabaseSync(ruta, { readOnly: true });
  try {
    // Cerco 2: solo SELECT, lectura de columnas, funciones y CTE recursivas; nada de ATTACH, PRAGMA, etc., ni las tablas ocultas.
    db.setAuthorizer((accion, a1) => {
      if (accion === c.SQLITE_READ) return OCULTAS.includes(String(a1).toLowerCase()) ? c.SQLITE_DENY : c.SQLITE_OK;
      return [c.SQLITE_SELECT, c.SQLITE_FUNCTION, c.SQLITE_RECURSIVE].includes(accion) ? c.SQLITE_OK : c.SQLITE_DENY;
    });
    // Cerco 3: tope de filas (el de tiempo lo pone quien lanzó el proceso).
    const filas: unknown[] = [];
    for (const fila of db.prepare(sql).iterate()) {
      if (filas.length === MAX_FILAS) return { filas, aviso: `Se muestran las primeras ${MAX_FILAS} filas: hay más.` };
      filas.push(cortar(fila));
    }
    return { filas };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    db.close();
  }
}

// Como proceso hijo (fork): un pedido, una respuesta, y termina.
if (import.meta.main) {
  process.once('message', (p: PedidoSql) => process.send!(correrSql(p), () => process.exit(0)));
}
