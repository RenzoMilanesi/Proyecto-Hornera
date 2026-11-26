# Plan 082: Facturar en lote los pagos del mes que no tienen factura

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`. Commit + push al cerrar cada paso (skill `commit-version`).
>
> **Drift check (run first)**: `git log --oneline -3 -- server/facturacion.ts src/Transferencias.tsx server/liquidacion/pagos.ts`
> Written against v0.58.2 (`edc66e2`). If `propuesta`, `emitirSinCandado`, `exclusivo` or `FormFactura` no longer match
> what's described in "Current state", STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM (emite comprobantes reales en ARCA)
- **Depends on**: 031, 033, 036 (todos hechos)
- **Category**: feature
- **Planned at**: v0.58.2 (sobre `edc66e2`), 2026-11-26

## Why this matters

Hoy cada pago se factura desde su fila en Transferencias, con un modal por pago. A fin de mes son decenas de pagos y
el mismo clic repetido. El lote factura de una vez todos los pagos ya registrados que no tienen factura, con un emisor.

## Decisiones (usuario, 2026-11-26)

1. **Alcance**: solo factura pagos **ya registrados**. Marcar pagado sigue siendo de a uno (no se toca `pagarLiquidacion`).
2. **Emisor**: uno para todo el lote, elegido arriba; se puede cambiar por fila antes de emitir. Sin cambios de esquema.
3. **Facturas hechas por fuera**: si el propietario tiene en ARCA facturas del mes hechas por fuera (`facturasExternas`),
   el pago **queda afuera del lote** con su motivo y se resuelve de a uno con el flujo actual ("Es esta" / "No es ninguna").
4. **Dónde**: botón "Facturar pagos del mes" en **Transferencias**.

## Current state

- `server/facturacion.ts`:
  - `propuesta(db, movimientoId, emisorId)` → `{ ofrece, motivo? , propuesto, facturado, aviso, externas }` (proporcional: honorarios × pago ÷ saldo).
  - `emitir(...)` = `exclusivo(emitirSinCandado)`. `exclusivo` **rechaza** (no encola) un segundo pedido mientras otro está en curso:
    el lote tiene que mandar las emisiones **de a una, esperando cada respuesta**.
  - `emitirSinCandado` valida: pago vigente, saldo > 0 y no es de Hornera, importe entero > 0, emisor activo con clave,
    **datos fiscales completos**, sin factura vigente en ese ambiente, sin `externaDePago`, y `externas` vacío salvo `ignorar_externas`.
  - `ErrorRevisar` (plan 033, CAE perdido) → la ruta responde 409 con `revisar`.
- `server/app.ts:606` `conArca`: 409 = revisar, 502 = red (`ErrorArca` tipo `red`), 400 = el resto.
- `server/liquidacion/pagos.ts` `listarTransferencias(db, mes)`: pagos de cada depto con su `factura` (`FacturaDePago`) y `externa`.
- `src/Transferencias.tsx`: `FormFactura` (modal de un pago), `EstadoFactura` (botón Facturar/Reintentar por pago).

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                      | exit 0              |
| Tests     | `node --test server/facturacion.test.ts` | all pass            |
| Todo      | `npm test`                               | all pass            |

## Scope

**In scope**: `server/facturacion.ts` (función nueva `aFacturar` + helper de receptor compartido), `server/app.ts` (una ruta GET),
`server/facturacion.test.ts`, `src/Transferencias.tsx` (botón + modal del lote), `GUIA-PRUEBAS.md` (sección 9), `ROADMAP.md`, `plans/README.md`.

**Out of scope**: esquema (`schema.sql`, migraciones), `exclusivo` (sigue rechazando; el lote es secuencial), un endpoint de emisión
en lote del lado del servidor, `FECAESolicitar` con varios registros, marcar pagado en lote, emisor por propietario.

## Steps

### Step 1: Tests que fallan

En `server/facturacion.test.ts` (mismo armado que el test de `propuesta`, línea ~103, y `arcaFalso`):

(a) `aFacturar(db, mes, emisorId)` con un mes que tiene: un pago vigente sin factura (entra, con `propuesto` igual al de
`propuesta`), un pago ya facturado (no aparece), un pago anulado (no aparece), un pago de un propietario sin datos fiscales
(en `excluidos` con motivo que menciona "Datos fiscales"), un pago cuyo propietario tiene una factura por fuera en
`comprobante_arca` del mes (en `excluidos` con motivo "por fuera"), un depto de Hornera (no aparece) y un pago con el último
intento rechazado (entra: es un reintento).

(b) Facturado en homologación no saca al pago del lote si el emisor elegido es de producción (y al revés), igual que `facturado`.

(c) Emitir los `incluidos` uno tras otro con `emitir` → números consecutivos y `aFacturar` del mismo mes devuelve `incluidos` vacío.

(d) Inputs inválidos: mes mal formado → error; emisor inexistente → error.

**Verify**: `node --test server/facturacion.test.ts` → los nuevos fallan (no existe `aFacturar`).

### Step 2: `aFacturar` en el servidor

En `server/facturacion.ts`:

1. Extraer de `emitirSinCandado` la validación de datos fiscales a un helper `faltanDatosFiscales(p): string | null`
   (devuelve el mensaje actual) y usarlo en los dos lados, para que el lote y la emisión digan lo mismo.
2. `export function aFacturar(db, mes, emisorId)`:
   - valida `mes` (`/^\d{4}-\d{2}$/`) y que el emisor exista (usar `ambienteDe` solo después de validar);
   - recorre los movimientos `tipo = 'liquidacion' AND estado = 'vigente'` del período de `mes`;
   - para cada uno: `propuesta(db, id, emisorId)`; si `!ofrece` → se omite (Hornera, sin saldo, o pago ya vinculado a una
     factura por fuera: ya está facturado); si tiene factura vigente en el ambiente del emisor → se omite; si `faltanDatosFiscales` →
     `excluidos`; si `externas.length` → `excluidos` con "En ARCA hay facturas a <propietario> hechas por fuera: facturalo de a uno.";
     si no → `incluidos` con `{ pagoId, codigo, propietario, fecha_pago, importe_pago, propuesto, aviso }`.
   - devuelve `{ incluidos, excluidos: { pagoId, codigo, propietario, motivo }[] }`.
   - ponytail: N llamadas a `propuesta` (una consulta por pago); alcanza para decenas de pagos por mes.
3. En `server/app.ts`, junto a `/api/pagos/:id/factura`: `app.get('/api/facturas/a-facturar', ...)` con `mes` y `emisor` del query,
   envuelto en `intentar`.

**Verify**: `node --test server/facturacion.test.ts` → todos pasan.

### Step 3: Modal del lote en Transferencias

Seguir la skill `modales` (ficha arriba, secciones, plata con `pesos`/`entradaPlata`, error al pie).

1. Botón **"Facturar pagos del mes"** arriba de la tabla de Transferencias (deshabilitado si no hay emisores activos).
2. Modal:
   - Emisor (select con los emisores activos; por defecto el primero). Al cambiarlo se vuelve a pedir `a-facturar`.
   - Tabla de `incluidos`: casilla (marcada salvo los que tienen `aviso`), depto, propietario, fecha del pago, importe editable
     (`entradaPlata`, arranca en `propuesto`), emisor por fila (por defecto el del lote) y columna **Resultado**.
   - Sección "Quedan afuera" con `excluidos` y su motivo.
   - Botón **"Emitir N facturas"**.
3. Emisión: un `for` con `await enviar('pagos/<id>/factura', 'POST', { emisor_id, importe })` por fila marcada, **en secuencia**.
   Por fila: aprobado → "emitida n.º …"; 409 (`revisar`) → "revisar en ARCA" y sigue; 400 → el motivo y sigue;
   **502 (red) → corta el lote** ("Sin conexión con ARCA: se emitieron X de N") porque el resto fallaría igual.
   Mientras emite, el modal no se cierra (o al cerrarlo se corta después de la emisión en curso) y el botón queda en loading.
4. Al cerrar, recargar Transferencias.

**Verify**: `npm run typecheck` → exit 0. A mano con `npx electron . --user-data-dir=<carpeta temporal>` y un emisor en
**homologación**: mes con 3 pagos sin factura, uno sin datos fiscales → el modal lista 2 y 1 afuera; emitir → 2 "prueba n.º"
consecutivos; reabrir el modal → 0 incluidos. Cortar la red a mitad → el lote se detiene y lo emitido queda.

### Step 4: Docs y suite completa

- `GUIA-PRUEBAS.md`, sección 9: el caso del lote (homologación primero).
- `ROADMAP.md`: ítem en Facturación ARCA, "A testear".

**Verify**: `npm run typecheck` → exit 0; `npm test` → todos pasan.

## Done criteria

- [ ] `npm run typecheck` exit 0; `npm test` exit 0 con los casos nuevos de `aFacturar`
- [ ] El lote nunca manda dos emisiones a la vez (`grep -n "Promise.all" src/Transferencias.tsx` no muestra el lote)
- [ ] Probado en homologación: emitir, reabrir sin pendientes, corte de red
- [ ] `git status` solo muestra los archivos en scope

## STOP conditions

- `emitirSinCandado` dejó de validar alguno de los puntos de "Current state" (el lote confía en esa validación).
- Al emitir en secuencia aparece "Ya se está emitiendo un comprobante" (algo más está emitiendo en paralelo: reportar, no reintentar).
- Hace falta un cambio de esquema para cualquier paso.

## Maintenance notes

- El lote reutiliza la ruta de un pago: todas las reglas (tope de honorarios con aviso, CAE perdido, facturas por fuera,
  ambiente) siguen en un solo lugar, `emitirSinCandado`.
- Upgrade si los meses pasan de ~100 pagos: un solo `FECAESolicitar` con varios registros (WSFEv1 lo permite), con cuidado
  en la regla 3 del plan 033 (un timeout deja en duda todo el bloque).
- Emisor por propietario quedó descartado (decisión 2); si se pide, es una columna en `propietario` + migración.
