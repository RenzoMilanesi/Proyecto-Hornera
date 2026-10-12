---
name: commit-version
description: >
  Ritual obligatorio de commit en HORNERA: decidir el bump de versión SemVer
  según la escala del cambio, actualizar package.json y ROADMAP.md, formato
  del mensaje, tag solo en entregas, y push. Usar SIEMPRE que el usuario
  diga "commit", "commiteá", "push", "subí esto", "cerrá el cambio", o
  cuando termine una implementación que toque código o tests. También al
  preparar un build o una entrega.
---

Todo commit que toca código sube la versión. La versión es lo que Lautaro y
Amancay ven en la app; si dos builds distintos dicen `v0.3.0`, no hay forma
de saber qué tienen instalado en cada PC (servidor y terminal).

Adaptada de la skill `commit-version` de Programa Roble.

## 1 — Clasificar el cambio

```
git status --short
git diff --stat
```

**¿Requiere bump?**

| Archivos tocados | Bump |
|---|---|
| `src/`, `electron/`, `server/` (incluye los `*.test.ts`), `schema.sql`, `schema.check.mjs`, `package.json` (deps) | **Sí** |
| Solo `plans/`, `.claude/`, `CLAUDE.md`, `DECISIONES.md`, `ROADMAP.md`, `.gitignore` | No |
| Mezcla de código y docs | Sí (manda el código) |

**¿Qué número sube?** Ante la duda, el más bajo.

| Nivel | Cuándo | Ejemplos en Hornera |
|---|---|---|
| **major** `0.x.y` → `1.0.0` | Ruptura de datos o de operación | Migración destructiva, esquema incompatible con la DB en uso, cambio que altera liquidaciones ya cerradas, rediseño del flujo de cierre de mes |
| **minor** `0.5.1` → `0.6.0` | Capacidad nueva | Pantalla nueva, endpoint nuevo, tabla/columna nueva, regla de liquidación nueva, campo nuevo de Stays o del importador del Excel |
| **patch** `0.5.0` → `0.5.1` | Corrección o pulido | Bug fix, ajuste visual, refactor interno, corrección de cálculo sin cambiar el modelo, mensaje de error |

`1.0.0` = primera versión que reemplaza al Excel en producción (tras correr
en paralelo 1-2 meses). Nunca dos bumps en un mismo commit: un feature con
varios fixes es **un** minor.

## 2 — Aplicar el bump

Editar `"version"` en `package.json`, en el **mismo commit** que el código.

Nunca escribir el número en el código: la UI la pide a `/api/estado`, que
la toma de `package.json` con `app.getVersion()` de Electron.

## 3 — Docs que acompañan

- **Feature o cierre de plan** → actualizar `ROADMAP.md`. No hay features
  sin roadmap.
- **Cambio de modelo de datos** → `schema.sql` + su migración en `server/db.ts`
  (`MIGRACIONES`) + `schema.check.mjs`, los tres juntos.
- **Decisión de producto o técnica nueva** → `DECISIONES.md`.
- Si se cerró un plan de `plans/`, marcarlo como hecho en `plans/README.md`.

## 4 — Verificación

El hook de pre-commit (`.githooks/pre-commit`, se activa con `npm install`)
corre `npm run typecheck` y `npm test`: **no duplicarlos antes de commitear**.
No hay lint. Si el hook falla, se arregla la causa — nunca `--no-verify`.

## 5 — Mensaje de commit

```
<Tipo>: <qué cambió, en una línea, imperativo>

<Por qué. Si fue un bug: la causa raíz, no solo el síntoma.>
<Lista de puntos si tocó varios archivos o módulos.>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Tipos en uso: `Fix:`, `Feature:`, `Merge:`, `Refactor:`, `Docs:`, `Chore:`.

## 6 — Tag: solo en entregas

**No** taguear cada commit. El tag `vX.Y.Z` se crea únicamente cuando esa
versión se instala en las PCs de Hornera (build del `.exe`):

```
git tag v0.6.0        # sobre el commit del bump que se entrega
git push --follow-tags
```

Commits normales: `git push` a secas.

## 7 — Push

Remoto: `https://github.com/RenzoMilanesi/Proyecto-Hornera.git` (privado).
Pedir confirmación antes de pushear salvo que el usuario ya lo haya pedido
en el mismo mensaje ("commit y push"). Reportar el SHA corto, la versión
resultante y si se creó tag.

## 8 — Nunca al repo

`Archivos Originales/` está en `.gitignore` y así queda: tiene DNI, CUIT, CBU
y mails de propietarios, documentos de huéspedes y credenciales de Stays.
Lo mismo cualquier `.env`, `.db` o export con datos reales. Antes de
commitear, revisar que `git status` no muestre nada de eso.

## Checklist rápida

```
[ ] ¿Toca código? → bump en package.json
[ ] ¿major / minor / patch? → tabla de arriba, ante la duda el más bajo
[ ] ¿Feature? → ROADMAP.md actualizado
[ ] ¿Toca datos? → schema.sql + migración + check sincronizados
[ ] ¿Nada sensible en git status?
[ ] Commit con Tipo:, porqué y footer
[ ] ¿Es entrega? → tag vX.Y.Z + push --follow-tags. Si no, push a secas
```
