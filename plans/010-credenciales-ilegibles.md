# Plan 010: Credenciales de Stays que no se pueden descifrar no rompen la pantalla

> **Executor instructions**: Al terminar, marcá DONE en `plans/README.md`.
>
> **Drift check**: `git diff --stat 261b949..HEAD -- electron/main.ts`.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug
- **Planned at**: commit `261b949` + fase 4 sin commitear, 2026-10-12

## Why this matters
`almacenCredenciales().leer()` (`electron/main.ts`) hace
`JSON.parse(safeStorage.decryptString(readFileSync(ruta)))`. DPAPI solo descifra
con el mismo usuario de Windows en la misma PC: si se copia la carpeta de datos a
otra PC, `GET /api/stays` responde 500 y la pantalla no deja volver a cargar la
clave.

## Scope
**In**: `electron/main.ts`.

## Steps
### Step 1
Envolver la lectura en try/catch: si falla, loguear y devolver `null` (queda como
"sin credenciales" y el usuario las vuelve a cargar, lo que pisa el archivo).

**Verify**: `npm run typecheck` → exit 0. Manual: con un `stays.cred` de basura,
la sección Stays muestra el formulario de credenciales.
