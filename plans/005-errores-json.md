# Plan 005: Los errores de la API vuelven como JSON corto

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 7ca8b0e..HEAD -- server/app.ts src/api.ts server/app.test.ts`.

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: plans/002-host-permitido.md
- **Category**: dx / UX
- **Planned at**: commit `7ca8b0e` + scaffold fase 2 sin commitear, 2026-10-12

## Why this matters
1. Si una ruta falla, el manejador por defecto de Express responde HTML con el
   stack (no hay `NODE_ENV=production`), y `src/api.ts` lo muestra entero en un
   `Alert`.
2. Una ruta `/api/...` inexistente cae en el middleware de Vite/static y
   devuelve `index.html` con 200: el cliente falla con un error de JSON
   confuso en vez de un 404.

## Current state
`server/app.ts`: rutas `GET /api/estado|propietarios|deptos`, sin manejador de
errores. `src/api.ts`:
```ts
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
```

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/app.ts`, `src/api.ts`, `server/app.test.ts`.
**Out**: mensajes traducidos por tipo de error (cuando haya formularios).

## Steps
### Step 1: servidor
Al final de `crearApp`, después de las rutas: `app.use('/api', ...)` → 404
`{ error: 'No existe ...' }`; y un manejador de errores de 4 argumentos que
loguea y responde 500 `{ error: mensaje }`. Como están dentro de `crearApp`,
quedan antes de Vite/static, que solo reciben lo que no es `/api`.

### Step 2: cliente
`src/api.ts`: leer `{ error }` del JSON si existe; si no, `res.statusText`.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: tests
- `GET /api/nada` → 404 JSON con `error`.
- Con la base cerrada (`db.close()`), `GET /api/deptos` → 500 JSON con `error`.

**Verify**: `npm test` → pasan.

## STOP conditions
- Si la app de Electron deja de cargar la interfaz (el 404 de `/api` no debe
  tapar rutas de Vite como `/@vite/client` o `/src/...`).

## Maintenance
Las rutas nuevas deben registrarse antes del 404 de `/api`, o sea dentro de
`crearApp` antes de esas dos líneas.
