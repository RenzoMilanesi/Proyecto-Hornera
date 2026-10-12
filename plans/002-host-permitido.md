# Plan 002: La API solo responde a pedidos dirigidos a esta PC

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 7ca8b0e..HEAD -- server/app.ts server/app.test.ts`.
> Si `server/app.ts` no coincide con el extracto, STOP.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: security
- **Planned at**: commit `7ca8b0e` + scaffold fase 2 sin commitear, 2026-10-12

## Why this matters
La API (Express en `127.0.0.1:4310`) no tiene login (decisión del proyecto).
Una página web cualquiera abierta en la misma PC puede usar DNS rebinding: un
dominio del atacante que resuelve a `127.0.0.1`, con lo que el navegador
considera la respuesta del mismo origen y la deja leer. Hoy expone nombres de
propietarios; con el importador, CBU y saldos. El navegador manda en `Host` el
dominio del atacante: rechazar todo `Host` que no sea esta PC lo corta.

## Current state
`server/app.ts`:
```ts
export function crearApp(db: DatabaseSync, version: string) {
  const app = express();
  app.use(express.json());
  app.get('/api/estado', ...
```
`electron/main.ts` agrega después Vite (dev) o `express.static` (prod) sobre la
misma app: el chequeo en `crearApp` los cubre también.
Test de referencia: `server/app.test.ts` ("la API lista deptos con su propietario")
levanta la app con `listen(0)`.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/app.ts`, `server/app.test.ts`.
**Out**: el WebSocket de HMR de Vite (Vite ya valida el host por su cuenta);
la escucha en LAN de la fase 5 (ahí se amplía la lista con las IP de la red).

## Steps
### Step 1: middleware de host
Primer middleware de `crearApp`: si `req.headers.host` no matchea
`/^(127\.0\.0\.1|localhost)(:\d+)?$/`, responder `403` con
`{ error: 'Host no permitido' }`.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: test
En `server/app.test.ts`, test que con `node:http` `request` (fetch no deja
cambiar `Host`) pide `/api/estado` con `host: 'atacante.com'` → 403, y con el
host real → 200.

**Verify**: `npm test` → pasa el test nuevo.

## STOP conditions
- Si la app de Electron deja de cargar (pantalla en blanco) tras el cambio.

## Maintenance
Fase 5 (terminales en LAN): sumar las IP/nombres de la PC servidor a la lista,
no quitar el chequeo.
