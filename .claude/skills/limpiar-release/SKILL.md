---
name: limpiar-release
description: >
  Limpieza de la carpeta `release/` al compilar el instalador de HORNERA:
  después de `npm run dist`, borrar los `Hornera Setup X.Y.Z.exe` (y sus
  `.blockmap`) de versiones viejas y los restos desactualizados de
  electron-builder, dejando solo el instalador de la versión actual. Usar
  SIEMPRE que se corra `npm run dist`, se genere el `.exe`, o el usuario
  diga "compilá", "generá el instalador", "armá el ejecutable", "build",
  "limpiá release".
---

# Limpiar `release/` al compilar

Adaptada de la skill `limpiar-release` de Programa Roble.

La salida de electron-builder es `release/`, ignorada por git. Cada build agrega un
`Hornera Setup X.Y.Z.exe` y nunca borra los anteriores, así que la carpeta acumula
instaladores viejos y es fácil instalar el equivocado en la PC servidor o en una terminal.

## Orden: compilar primero, limpiar después

Nunca limpiar antes: si el build falla, te quedás sin ningún instalador.

1. `npm run dist` (corre typecheck + tests y arma el instalador NSIS).
2. Verificar que existe `release/Hornera Setup <version>.exe`, con `<version>` =
   `"version"` de `package.json`. Si no existe, el build falló: **no borrar nada**
   y reportar el error.
3. Correr la limpieza (abajo).
4. Listar lo que quedó en `release/` y decirle al usuario qué se borró.
5. Es una entrega: tag según `commit-version` (`git tag -a vX.Y.Z`; pedir confirmación
   antes de `git push --follow-tags`).

## Qué se borra y qué se conserva

| Contenido | Acción |
|---|---|
| `Hornera Setup <versión actual>.exe` y su `.blockmap` | **Conservar** |
| `Hornera Setup <otra versión>.exe` / `.blockmap` | Borrar |
| `win-unpacked/` | Conservar (lo regenera cada build; es la app de esta versión sin instalar) |
| `builder-debug.yml`, `builder-effective-config.yaml`, `latest*.yml` | Borrar (logs del build; no hay actualización automática que use `latest.yml`) |
| `Guia de pruebas Hornera.pdf` | Conservar (se entrega junto al instalador; ver `GUIA-PRUEBAS.md`) |
| Cualquier otra cosa (p. ej. una carpeta con `hornera.db`, `stays.cred` o `.key`) | **No tocar.** No es salida del build: puede ser una base real o credenciales. Mencionarla al usuario y preguntar antes de borrarla. |

## Limpieza (Bash)

```bash
cd release
v=$(node -p "require('../package.json').version")
test -f "Hornera Setup $v.exe" || { echo "Falta Hornera Setup $v.exe — no limpio"; exit 1; }
for f in "Hornera Setup "*.exe "Hornera Setup "*.exe.blockmap; do
  case "$f" in "Hornera Setup $v.exe"|"Hornera Setup $v.exe.blockmap") ;; *) rm -v -- "$f" ;; esac
done
rm -fv builder-debug.yml builder-effective-config.yaml latest*.yml
ls -la
```

Si `ls` muestra algo fuera de la tabla, preguntar al usuario antes de borrarlo.

## Si la versión no cambió

Si se recompila sin bumpear, electron-builder pisa el `.exe` del mismo nombre:
está bien, no hay nada viejo que borrar. Pero recordá la regla de `commit-version`:
dos builds distintos con el mismo número no dejan saber qué tiene instalado cada PC
(servidor y terminal) — si el código cambió, bumpear antes de compilar una entrega.
