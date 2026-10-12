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
| 006 | [Importar un mes anterior no pisa maestros](006-importar-mes-anterior.md) | P1 | S | — | DONE |
| 007 | [Rollback si falla una migración](007-migracion-rollback.md) | P3 | S | — | DONE |
| 008 | [Avisos repetidos sin advertencia de React](008-avisos-key.md) | P3 | S | — | DONE |
| 009 | ["Traer mes" solo borra lo que Stays ya no tiene](009-sync-no-borra-lo-devuelto.md) | P1 | S | — | DONE |
| 010 | [Credenciales ilegibles no rompen la pantalla](010-credenciales-ilegibles.md) | P3 | S | — | DONE |

Planes 006-008: revisión `improve deep` del importador (fase 3), 2026-10-12.
Planes 009-010: revisión de la sincronización con Stays (fase 4), 2026-10-12.

Orden recomendado: 001 → 002 → 003 → 004 → 005. 004 reutiliza la función
`respaldar` de 003; 005 agrega middlewares al final de `crearApp`, después del
de 002.

## Considerados y descartados
- Aviso de tamaño del bundle de Vite: app de escritorio local, no viaja por red.
- CORS: el navegador ya bloquea leer respuestas de otro origen; el único vector
  de lectura es DNS rebinding (plan 002).
- Avisar fechas de CORRIENTE fuera del período (p. ej. pagos de D25 y PRO
  tipeados 10/11/2025): descartado por el usuario, se importan tal cual.
- Efectivo en Stays cuenta como ARS: Stays no informa la moneda del pago, los
  scripts hacían lo mismo y la moneda del medio se edita en la app (la sync no la pisa).
- Traer un mes anterior a los importados crea un período abierto: se avisa; caso raro.
- Tests del importador con un Excel sintético: hoy usan el export real (no está
  en git) y se saltean sin él. Retomar cuando llegue otro mes con variaciones.

## Pendiente de verificar (sin plan)
- Que Electron empaquetado (asar) corra los `.ts` con type stripping. Verificar
  al armar el instalador; si no, compilar `electron/` y `server/` con `tsc`.
