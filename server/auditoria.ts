// Registro de cambios financieros (DECISIONES: antes/después, con fecha y PC; sin login).
import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';

type Accion = 'alta' | 'modificacion' | 'anulacion' | 'cierre' | 'reapertura';

// Nombre de la terminal que hizo el pedido (lo pone server/terminales.ts); sin terminal, esta PC.
export const pcActual = new AsyncLocalStorage<string>();

export function auditar(db: DatabaseSync, tabla: string, id: number | null, accion: Accion, antes: unknown, despues: unknown) {
  db.prepare(`INSERT INTO auditoria(fecha, pc, tabla, registro_id, accion, antes_json, despues_json) VALUES (datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?)`)
    .run(pcActual.getStore() ?? hostname(), tabla, id, accion, antes == null ? null : JSON.stringify(antes), despues == null ? null : JSON.stringify(despues));
}
