# Roadmap — Hornera

Versión `1.0.0` = reemplaza al Excel en producción, después de correr 1-2 meses en paralelo.

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Decisiones (`DECISIONES.md`), modelo de datos (`schema.sql`), versionado | Hecho |
| 1 | Motor de liquidación con test contra abril 2026 (`server/liquidacion/`) | Hecho |
| 2 | Scaffold Electron + React/Vite + Express + SQLite (TS, Ant Design), backups → `0.1.0` | Hecho |
| 3 | Importador del Excel (maestros, saldos, movimientos, histórico) | Hecho |
| 4 | Sync con Stays: reservas, pagos y medios de pago ("traer mes") | Hecho, falta probar contra el Stays real |
| 5 | Movimientos, cuentas, cierre y reapertura, PDF, transferencias, modo servidor/terminal en la LAN | Pendiente |
| 6 | Resumen: KPIs, resultado Hornera, saldos de cuentas, histórico | Pendiente |
| — | Fuera de la v1: mails, ARCA, mantenimiento, obligaciones, checklist | — |
