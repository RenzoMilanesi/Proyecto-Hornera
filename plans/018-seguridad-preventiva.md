# Plan 018: Seguridad preventiva de la API local y la ventana

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 8188cfe..HEAD -- server/ electron/`. Si los extractos
> de "Current state" no coinciden con el código, STOP.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: security
- **Planned at**: commit `8188cfe`, 2026-10-12 (auditoría `improve deep` de las fases 1-4)

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan, `schema OK` |

Convenciones: TypeScript ejecutado directo por Node/Electron (sin enums ni sintaxis no
borrable, imports con extensión `.ts`), comentarios e identificadores en español,
importes en centavos, estilo mínimo (comentario `ponytail:` en simplificaciones a propósito).

## Why this matters
Nada es explotable hoy, pero la fase 5 suma rutas que escriben y terminales en la red.

## Steps
1. `server/app.ts`: rechazar (403) pedidos que no sean GET/HEAD a `/api` cuando el navegador los
   marca como de otro sitio (`Sec-Fetch-Site` presente y distinto de `same-origin`/`none`).
2. `electron/main.ts`: negar `window.open`, impedir navegar fuera de `http://127.0.0.1:4310` y
   negar permisos (cámara, notificaciones, etc.).
3. URL de Stays (`configuracion.stays.url`): solo `https://*.stays.net` o `http://` a la propia
   PC (Stays de prueba); si no, error. `fetch` con `redirect: 'error'` para no reenviar la clave.
4. `server/backup.ts`: carpeta de backup en otra PC de la red (ruta UNC) → no se usa (cae a la
   carpeta por defecto con aviso).
5. Manejador de errores: loguear solo el mensaje (el error de body-parser trae el cuerpo, que
   puede tener la clave).

## Test plan
403 con `Sec-Fetch-Site: cross-site`; URL de Stays `http://otro` → error sin pedir nada; carpeta
UNC → copia en la por defecto. Paso 2: prueba manual.

**Verify**: `npm test` → pasa.
