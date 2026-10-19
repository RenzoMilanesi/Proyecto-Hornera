# Plan 034: El ticket de acceso de ARCA no viaja en los backups

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación. Si aparece una
> condición STOP, frená y reportá. Al terminar, marcá A TESTEAR en `plans/README.md`.
>
> **Drift check**: `git diff --stat 5885e25..HEAD -- server/backup.ts server/emisores.ts`. Si
> `hacerBackup` ya no usa `VACUUM INTO`, o el ticket ya no se guarda en `configuracion` con clave
> `arca.ta.<servicio>.<ambiente>.<cuit>`, STOP.

## Status
- **Priority**: P3 · **Effort**: S · **Risk**: LOW · **Depends on**: 031 etapa 3 (hecha)
- **Category**: security
- **Planned at**: `5885e25` + etapa 3 del plan 031 (v0.19.0), 2026-10-19 (revisión `improve deep` de la etapa 3)

## Why this matters
`server/emisores.ts` (`ticketAcceso`) cachea el ticket de acceso del WSAA de ARCA (token + sign, vale
12 h) en la tabla `configuracion`, con clave `arca.ta.wsfe.<ambiente>.<cuit>`. Con ese par se pueden
pedir CAE en nombre del emisor sin el certificado. `server/backup.ts` copia la base entera
(`db.prepare('VACUUM INTO ?').run(destino)`, línea ~14) a la carpeta de backups, que puede ser
Drive/OneDrive (`configuracion.backup.carpeta`). Resultado: quien accede a un backup reciente puede
facturar como Lautaro o Amancay hasta que venza el ticket. La clave privada sí queda fuera (archivo
cifrado `arca-<cuit>.key` en `userData`); el ticket no.

Se elige **limpiar la copia** y no sacar el ticket de la base: cachearlo en la base es lo que evita el
error "El CEE ya posee un TA valido" al reiniciar la app (no se puede pedir otro mientras el anterior
siga vigente).

## Pasos
1. En `server/backup.ts`, `hacerBackup`, justo después del `VACUUM INTO`, abrir la copia y borrar los
   tickets:
   ```ts
   const copia = new DatabaseSync(destino);
   try {
     copia.prepare(`DELETE FROM configuracion WHERE clave LIKE 'arca.ta.%'`).run();
     copia.exec('VACUUM');  // que el token borrado no quede en páginas libres del archivo
   } finally {
     copia.close();
   }
   ```
   (`DatabaseSync` de `node:sqlite`; agregar el import de valor si hoy solo es `import type`).
   Comentario corto en español explicando por qué (estilo del archivo).
2. Verificación: `npm run typecheck` → exit 0.

## Test
En `server/app.test.ts`, junto a `'el backup conserva solo las últimas copias'` (usa `hacerBackup` y
una carpeta temporal con `temporal(t)`): insertar
`INSERT INTO configuracion VALUES ('arca.ta.wsfe.homologacion.20111111112', '{"token":"T"}')` y
`('pdf.carpeta', 'x')`, hacer el backup, abrir la copia con `new DatabaseSync(ruta)` y comprobar que
no quedan claves `arca.ta.%`, que `pdf.carpeta` sigue, y que el archivo no contiene el texto `"token":"T"`
(`readFileSync(ruta).includes('"token":"T"')` → false). La base original conserva su ticket.

## Done criteria
- `npm test` y `npm run typecheck` en verde.

## STOP conditions
- Abrir la copia falla porque la carpeta de backup es de solo lectura o de red lenta: STOP y reportar
  (no cambiar a otra estrategia sin consultar).

## Maintenance
Cualquier otro secreto que se agregue a `configuracion` (por ejemplo un ticket del padrón,
`arca.ta.ws_sr_constancia_inscripcion.*`, ya cubierto por el prefijo) tiene que quedar bajo `arca.ta.`
o sumarse a este DELETE.
