# Hornera

App de escritorio que reemplaza al Google Sheet de liquidaciones mensuales a
propietarios de HORNERA (alquileres temporarios, Rosario). Contexto y decisiones:
`DECISIONES.md`. Fases: `ROADMAP.md`. Planes de mejora: `plans/README.md`.

## Comandos
- `npm install`: dependencias; activa el hook de pre-commit (typecheck + tests).
- `npm run dev`: abre la app (Electron; en desarrollo Vite corre dentro del mismo Express).
  Con datos de prueba: `npx electron . --user-data-dir=<carpeta temporal>`.
- `npm test`: tests (`node --test "server/**/*.test.ts"`) y `node schema.check.mjs`.
- `npm run typecheck`: `tsc` solo chequea tipos (no compila).
- `npm run dist`: typecheck + tests y el instalador de Windows en `release\` (electron-builder, NSIS). Guía de prueba: `GUIA-PRUEBAS.md`.
- Manual de usuario (`manual/`): `node manual/seed.ts <carpeta>` arma una base de demo ficticia; con
  `npx electron . --user-data-dir=<carpeta>` abierta, `npx electron manual/capturar.mjs manual/img` saca las
  capturas y `npx electron manual/pdf.mjs` genera el PDF desde `manual/manual.html`.

## Estructura
- `electron/main.ts`: rol de la PC (servidor o terminal), ventana, API en el puerto 4310 de la LAN, backups,
  credenciales de Stays (safeStorage). `server/terminales.ts`: emparejamiento de terminales.
- `server/app.ts`: rutas `/api/*`. `server/db.ts`: esquema y migraciones. `schema.sql`: esquema actual.
- `server/liquidacion/motor.ts`: motor de liquidación (función pura).
- `server/importador/excel.ts`: importa el Excel mensual. `server/importador/gastos.ts`: el Excel de gastos varios.
  `server/stays/`: "traer mes" de Stays.
- Facturación ARCA: `server/arca.ts` (WSAA/WSFEv1), `server/facturacion.ts` (factura y NC de cada pago),
  `server/emisores.ts` (emisores y certificados), `server/fiscal.ts` (tipos de comprobante, CUIT, QR),
  `server/misComprobantes.ts` (lo facturado por fuera, importado de ARCA).
- `server/resumen.ts`: KPIs, resultado de Hornera y evolución (pantalla Resumen).
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
- Modales y ventanas: skill `modales` (ficha, secciones, plata con `entradaPlata`), igual que las existentes.
- Commits: skill `commit-version` (bump de versión, mensaje, push).
- Responder en español.
