// Registro de cambios financieros (DECISIONES: antes/después, con fecha y PC; sin login).
import { hostname } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';

type Accion = 'alta' | 'modificacion' | 'anulacion' | 'cierre' | 'reapertura';

export function auditar(db: DatabaseSync, tabla: string, id: number | null, accion: Accion, antes: unknown, despues: unknown) {
  db.prepare(`INSERT INTO auditoria(fecha, pc, tabla, registro_id, accion, antes_json, despues_json) VALUES (datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?)`)
    .run(hostname(), tabla, id, accion, antes == null ? null : JSON.stringify(antes), despues == null ? null : JSON.stringify(despues));
}
