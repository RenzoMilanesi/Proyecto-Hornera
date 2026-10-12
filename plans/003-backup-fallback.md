# Plan 003: Si la carpeta de backup configurada falla, la copia queda en la carpeta por defecto

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 7ca8b0e..HEAD -- server/backup.ts electron/main.ts server/app.test.ts`.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (pérdida de datos)
- **Planned at**: commit `7ca8b0e` + scaffold fase 2 sin commitear, 2026-10-12

## Why this matters
La carpeta de backup se puede configurar (Drive/OneDrive, clave
`backup.carpeta` en `configuracion`). Si esa carpeta no está disponible (Drive
desmontado, disco externo desconectado), `hacerBackup` tira error y ese cierre
queda sin copia. Debe caer a la carpeta por defecto y avisar.

## Current state
`server/backup.ts`: `hacerBackup(db, carpeta, ahora)` hace `VACUUM INTO` y
conserva 15; `carpetaBackup(db, porDefecto)` lee la configuración.
`electron/main.ts`, en `before-quit`:
```ts
try {
  hacerBackup(db, carpetaBackup(db, join(app.getPath('userData'), 'backups')));
} catch (e) {
  dialog.showErrorBox('No se pudo hacer la copia de seguridad', String(e));
}
```

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/backup.ts`, `electron/main.ts`, `server/app.test.ts`.
**Out**: UI para configurar la carpeta (fase 5).

## Steps
### Step 1: `respaldar(db, porDefecto)`
Nueva función en `server/backup.ts` que reemplaza a `carpetaBackup` como punto
de entrada: intenta en la carpeta configurada; si falla y no es la por defecto,
hace la copia en la por defecto y lanza un error que dice dónde quedó. Si la
configurada es la por defecto, propaga el error original. Devuelve la ruta de
la copia.

### Step 2: usarla en `electron/main.ts`
Reemplazar la llamada en `before-quit` por `respaldar(db, ...)`.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: test
Configurar `backup.carpeta` apuntando a un archivo (no carpeta) → `respaldar`
lanza error que menciona la carpeta por defecto y en la por defecto hay 1 copia.

**Verify**: `npm test` → pasa.

## STOP conditions
- Si `VACUUM INTO` deja archivos parciales en la carpeta configurada al fallar
  y eso rompe la rotación (reportar, no improvisar limpieza).

## Maintenance
El plan 004 reutiliza `respaldar` para el apagado de Windows.
