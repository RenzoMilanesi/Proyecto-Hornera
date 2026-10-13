# Hornera

App de escritorio que reemplaza al Google Sheet de liquidaciones mensuales a
propietarios de HORNERA (alquileres temporarios, Rosario). Contexto y decisiones:
`DECISIONES.md`. Fases: `ROADMAP.md`. Planes de mejora: `plans/README.md`.

## Comandos
- `npm install`: dependencias; activa el hook de pre-commit (typecheck + tests).
- `npm start`: abre la app (Electron; en desarrollo Vite corre dentro del mismo Express).
  Con datos de prueba: `npx electron . --user-data-dir=<carpeta temporal>`.
- `npm test`: tests (`node --test "server/**/*.test.ts"`) y `node schema.check.mjs`.
- `npm run typecheck`: `tsc` solo chequea tipos (no compila).

## Estructura
- `electron/main.ts`: rol de la PC (servidor o terminal), ventana, API en el puerto 4310 de la LAN, backups,
  credenciales de Stays (safeStorage). `server/terminales.ts`: emparejamiento de terminales.
- `server/app.ts`: rutas `/api/*`. `server/db.ts`: esquema y migraciones. `schema.sql`: esquema actual.
- `server/liquidacion/motor.ts`: motor de liquidación (función pura).
- `server/importador/excel.ts`: importa el Excel mensual. `server/stays/`: "traer mes" de Stays.
- `server/periodo.ts`: regla única de qué reserva pertenece a un período.
- `src/`: interfaz (React + Ant Design).

## Reglas
- **Datos reales nunca al repo.** No abrir ni commitear nada de `Archivos Originales/` (DNI,
  CBU, mails, credenciales de Stays). En código, tests y comentarios usar datos ficticios.
- Los tests de importador y regresión usan `Archivos Originales/2026-04.xlsx`; sin ese
  archivo se saltean (aparecen como `skipped`) y el resto pasa igual.
- TypeScript sin build: Node/Electron lo ejecutan directo. Nada de enums, namespaces ni
  parámetros de propiedad en constructores; imports con extensión `.ts`.
- Plata en centavos (INTEGER). Fechas ISO `YYYY-MM-DD`.
- Cambio de esquema: `schema.sql` + migración en `server/db.ts` (`MIGRACIONES`) +
  `schema.check.mjs`, juntos.
- Estilo mínimo: sin abstracciones especulativas; un comentario `ponytail:` marca una
  simplificación hecha a propósito.
- Commits: skill `commit-version` (bump de versión, mensaje, push).
- Responder en español.
