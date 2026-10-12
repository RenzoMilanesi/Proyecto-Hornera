# Plan 008: Avisos repetidos de la importación sin advertencia de React

> **Executor instructions**: Al terminar, marcá DONE en `plans/README.md`.
>
> **Drift check**: `git diff --stat 589b9b1..HEAD -- src/Importar.tsx`.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: dx
- **Planned at**: commit `589b9b1` + fase 3 sin commitear, 2026-10-12

## Why this matters
`src/Importar.tsx` lista los avisos con `<li key={a}>`. Dos avisos con el mismo
texto repiten la `key` y React advierte en la consola (y puede no renderizar uno).

## Scope
**In**: `src/Importar.tsx`.

## Steps
### Step 1
Usar el índice como key: la lista es estática (no se reordena ni se edita).

**Verify**: `npm run typecheck` → exit 0.
