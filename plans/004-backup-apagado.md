# Plan 004: Hacer el backup también cuando Windows se apaga con la app abierta

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 7ca8b0e..HEAD -- electron/main.ts`.

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: plans/003-backup-fallback.md
- **Category**: bug (pérdida de datos)
- **Planned at**: commit `7ca8b0e` + scaffold fase 2 sin commitear, 2026-10-12

## Why this matters
En Windows, al apagar o cerrar sesión con la app abierta, Electron no emite
`before-quit`: emite `session-end`. Hoy ese caso queda sin backup. Es probable
que pase (la PC se apaga con el programa abierto).

## Current state
`electron/main.ts`: el backup vive en un handler de `before-quit` con un flag
`respaldado` para no repetirlo, que muestra `dialog.showErrorBox` si falla.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |

## Scope
**In**: `electron/main.ts`. **Out**: `server/*`.

## Steps
### Step 1: un solo `cerrar`
Extraer el handler a una función con el flag de "ya respaldado", que recibe si
debe avisar con diálogo. Registrarla en `before-quit` (con aviso) y en
`session-end` de la `BrowserWindow` (es evento de ventana, no de `app`; sin diálogo: un diálogo modal bloquearía el apagado; loguear
con `console.error`).

**Verify**: `npm run typecheck` → exit 0; cerrar la app normalmente sigue
dejando una copia en `<userData>/backups`.

## Test plan
`session-end` no se puede simular sin apagar la PC; se verifica el cierre
normal y la revisión de código.

## STOP conditions
- Si Electron no expone `session-end` en los tipos de `BrowserWindow` (versión distinta). Nota: en la ejecución se vio que no existe en `app`; el plan se corrigió.

## Maintenance
Cualquier tarea nueva de cierre (p. ej. avisar a terminales en fase 5) va en
la misma función `cerrar`.
