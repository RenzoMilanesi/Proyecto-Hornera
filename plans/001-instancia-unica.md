# Plan 001: Abrir Hornera dos veces trae la ventana existente, sin error

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 7ca8b0e..HEAD -- electron/main.ts`. Si
> `electron/main.ts` no coincide con el extracto de abajo, STOP.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug
- **Planned at**: commit `7ca8b0e` + scaffold fase 2 sin commitear, 2026-10-12

## Why this matters
`electron/main.ts` pide el lock de instancia única, pero si no lo obtiene solo
llama `app.quit()` (asíncrono) y el `app.whenReady().then(iniciar)` del final
igual corre. La segunda instancia abre la base y choca con el puerto 4310
ocupado: el usuario ve "Hornera no pudo iniciar" en vez de la ventana abierta.

## Current state
`electron/main.ts`:
```ts
if (!app.requestSingleInstanceLock()) app.quit();
...
app.whenReady().then(iniciar).catch((e) => {
  dialog.showErrorBox('Hornera no pudo iniciar', String(e?.stack ?? e));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
```
Convenciones: comentarios en español, identificadores en español (`ventana`,
`iniciar`), TypeScript ejecutado directo (sin enums ni sintaxis no borrable).

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan, `schema OK` |

## Scope
**In**: `electron/main.ts`. **Out**: `server/*`, `src/*`.

## Steps
### Step 1: iniciar solo con el lock
Envolver el arranque: si no hay lock, `app.quit()` y nada más; si hay lock,
registrar `second-instance` (restaurar si está minimizada y enfocar la primera
ventana de `BrowserWindow.getAllWindows()`) y recién ahí `app.whenReady().then(iniciar)`.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: prueba manual
Abrir `npx electron . --user-data-dir=<carpeta temporal>`; con la ventana
abierta, lanzar otra vez el mismo comando.

**Verify**: el segundo proceso termina solo (exit 0) en menos de 5 s, sin
diálogo de error, y la primera ventana queda al frente.

## Test plan
Manual (paso 2): no hay infraestructura de tests de Electron en el repo y no
se justifica agregarla por esto.

## STOP conditions
- Si el segundo proceso no termina o muestra un diálogo después del cambio.

## Maintenance
El modo terminal (fase 5) abre la misma app en otra PC: el lock es por PC, no
lo afecta.
