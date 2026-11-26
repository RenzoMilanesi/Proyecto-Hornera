# Plan 085: Ajustes del envío de mails (ventana de la cuenta en bucle, mails del Excel, letra de la factura, límite de Gmail)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected
> result before moving to the next step. If anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `plans/README.md`. Commit + push al cerrar (skill `commit-version`, patch).
>
> **Drift check (run first)**: `git log --oneline -3 -- server/mails.ts src/Transferencias.tsx`
> Written against v0.61.2 (`c713e31`). If `cargarCuenta`, `armarMensaje`, `nombreFactura` or `errorDeGmail` no longer
> look like the excerpts below, STOP.

## Status

- **Priority**: P1 (paso 1) / P3 (pasos 2-4)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 084 (hecho)
- **Category**: bug
- **Planned at**: v0.61.2 (`c713e31`), 2026-11-26

## Why this matters

Revisión `improve deep` del plan 084. Cuatro cosas, todas en los mismos dos archivos:

1. **La ventana "Cuenta de Gmail" no se puede cerrar sin guardar** (bug). En `src/Transferencias.tsx`:
   ```tsx
   const cargarCuenta = () => get<CuentaMail>('mails/cuenta').then((c) => { setCuenta(c.usuario); if (!c.usuario) setEditarCuenta(true); }, ...);
   ...
   <FormCuentaMail abierto={editarCuenta} alCerrar={() => { setEditarCuenta(false); cargarCuenta(); }} />
   ```
   Sin cuenta cargada, "Cancelar" cierra la ventana, `cargarCuenta` ve que no hay cuenta y la vuelve a abrir. Desde una
   **terminal** es peor: guardar da 403 ("Esto solo se hace en la PC servidor"), así que no hay salida salvo recargar la app.
2. **Los mails que vienen del Excel no se normalizan** (`server/importador/excel.ts:233`, columna P, texto libre). Al guardar
   desde la app se separan con `/[;,\s]+/` (`server/propietarios.ts:154`), pero `armarMensaje` separa solo por `;`
   (`server/mails.ts:82`). Un "a@x.com / b@y.com" del Excel llega a Gmail como un destinatario inválido y la fila falla
   recién al enviar.
3. **El adjunto se llama siempre "Factura C"** (`nombreFactura`, `server/mails.ts`). Un emisor responsable inscripto
   emite A o B (`server/fiscal.ts`, `LETRA_CBTE`); la factura en el `Transferencia.pagos[].factura` trae `cbte_tipo`.
4. **El límite diario de Gmail no corta el lote** (`errorDeGmail`): pasado el límite, Gmail contesta `550 5.4.5` o
   `421 4.7.0` y cada fila falla igual, una por una.

## Steps

### Step 1: La ventana de la cuenta se abre sola una sola vez

En `FormLoteMails`: abrir `FormCuentaMail` automáticamente **solo en la carga inicial** (el `useEffect` de `mes`), no en
`cargarCuenta`. Al cerrar la ventana se refresca la cuenta sin reabrirla. Si sigue sin cuenta, el botón "Enviar" ya queda
deshabilitado (`okButtonProps={{ disabled: !cuenta || ... }}`) y la ficha dice "sin cuenta cargada".

**Verify**: `npm run typecheck` → exit 0. A mano (servidor de prueba como en el plan 084): sin cuenta, abrir "Enviar por mail"
→ se abre la cuenta → Cancelar → queda el lote con "sin cuenta cargada" y Enviar deshabilitado.

### Step 2: Mails normalizados y validados al armar el lote

En `server/mails.ts`: una función `listaDeMails(texto)` que separe con `/[;,\s]+/` (lo mismo que `propietarios.ts:154`) y
devuelva `{ validos, invalidos }` con `esMail` de `server/propietarios.ts:141` (exportarlo; borrar la regex `MAIL` duplicada de `mails.ts` y usar `esMail` también en `guardarCuenta`). En `aEnviar`:
- `mails` del renglón = `validos.join('; ')`;
- si hay inválidos → `excluidos` con motivo `Mail inválido ("<invalido>"): corregilo en Propietarios → Datos para pagarle.`
`armarMensaje` usa `listaDeMails(p.mails).validos`. Test en `server/mails.test.ts`: un propietario con
`'luis@ejemplo.com, otro@ejemplo.com'` entra con los dos; uno con `'ana@ejemplo / x'` queda afuera con "Mail inválido".

**Verify**: `node --test server/mails.test.ts` → todos pasan.

### Step 3: Letra real en el nombre del adjunto

`aEnviar` guarda `cbte_tipo` en cada factura y `nombreFactura` usa `LETRA_CBTE[cbte_tipo]` de `server/fiscal.ts`
(`Factura A 0003-00000012.pdf`). Test: el actual sigue dando "Factura C …" (cbte_tipo 11); agregar uno con cbte_tipo 6 → "Factura B".

**Verify**: `node --test server/mails.test.ts` → todos pasan.

### Step 4: Límite de Gmail corta el lote

En `errorDeGmail`: `responseCode === 421` o el mensaje con `5.4.5` → `{ mensaje: 'Gmail no deja mandar más mails por hoy (límite de la cuenta): seguí mañana desde acá.', corta: true }`.
Test en el caso de fallas existente: un error `{ code: 'EMESSAGE', responseCode: 550, message: '550 5.4.5 Daily user sending limit exceeded' }` → 502.

**Verify**: `npm test` → todos pasan.

## Done criteria

- [ ] `npm run typecheck` y `npm test` exit 0
- [ ] Cancelar la ventana de la cuenta sin cuenta cargada no la vuelve a abrir (probado a mano)
- [ ] `git status` solo muestra `server/mails.ts`, `server/mails.test.ts`, `src/Transferencias.tsx`, `package.json`, `ROADMAP.md`, `plans/README.md`

## STOP conditions

- Los mails reales del Excel usan un separador que `/[;,\s]+/` corta mal (por ejemplo nombres con espacios antes del mail):
  reportar con un ejemplo **ficticio** del formato, nunca el dato real.

## Maintenance notes

- Si se valida el mail también al importar el Excel, `listaDeMails` es la función a reutilizar.
- Descartado en esta revisión: un mail que Gmail aceptó pero cuya respuesta se cortó queda como error y se puede reenviar
  (duplicado inofensivo); dos PC mandando el mismo lote a la vez (raro, y el lote ya marca "enviado el …"); `aEnviar`
  recalcula el mes por cada envío (decenas de propietarios).
