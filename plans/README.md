# Planes — Hornera

Generados por `improve deep` sobre el scaffold de la fase 2 (2026-10-12),
sobre el commit `7ca8b0e` + el scaffold de la fase 2 todavía sin commitear.

| # | Plan | Prioridad | Esfuerzo | Depende de | Estado |
|---|---|---|---|---|---|
| 001 | [Una sola instancia sin error al reabrir](001-instancia-unica.md) | P1 | S | — | DONE |
| 002 | [API solo para pedidos dirigidos a la PC (DNS rebinding)](002-host-permitido.md) | P1 | S | — | DONE |
| 003 | [Backup con carpeta de respaldo si falla la configurada](003-backup-fallback.md) | P1 | S | — | DONE |
| 004 | [Backup también al apagar Windows](004-backup-apagado.md) | P2 | S | 003 | DONE |
| 005 | [Errores de la API como JSON corto](005-errores-json.md) | P2 | S | 002 | DONE |

Orden recomendado: 001 → 002 → 003 → 004 → 005. 004 reutiliza la función
`respaldar` de 003; 005 agrega middlewares al final de `crearApp`, después del
de 002.

## Considerados y descartados
- Aviso de tamaño del bundle de Vite: app de escritorio local, no viaja por red.
- CORS: el navegador ya bloquea leer respuestas de otro origen; el único vector
  de lectura es DNS rebinding (plan 002).

## Pendiente de verificar (sin plan)
- Que Electron empaquetado (asar) corra los `.ts` con type stripping. Verificar
  al armar el instalador; si no, compilar `electron/` y `server/` con `tsc`.
