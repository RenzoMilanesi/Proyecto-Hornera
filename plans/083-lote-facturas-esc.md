# Plan 083: Esc no cierra el lote de facturas mientras emite

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git log --oneline -3 -- src/Transferencias.tsx DECISIONES.md`
> Written against v0.59.1 (`013b3d2`). If the `<Modal` of `FormLoteFacturas` no longer matches the excerpt below, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 082 (hecho)
- **Category**: bug + docs
- **Planned at**: v0.59.1 (sobre `013b3d2`), 2026-11-26

## Why this matters

`FormLoteFacturas` (Transferencias → "Facturar pagos del mes") emite facturas de a una en un `for` con `await`.
Mientras emite, oculta la X (`closable={!emitiendo}`) y desactiva Cancelar, pero **Esc igual cierra el modal**:
`@rc-component/dialog` (`node_modules/@rc-component/dialog/lib/DialogWrap.js:49`) llama a `onClose` con Esc si
`keyboard` es true (el default), sin mirar `closable`. Con Esc el padre desmonta el modal y el `for` **sigue emitiendo
facturas reales en ARCA sin que nadie vea el resultado**. Si se reabre el lote enseguida, lista pagos que todavía se
están facturando y la segunda emisión choca con "Ya se está emitiendo un comprobante" o "ya tiene la factura".

Además, las decisiones de producto del plan 082 no quedaron en `DECISIONES.md`, que es donde se buscan.

## Current state

`src/Transferencias.tsx` (función `FormLoteFacturas`):

```tsx
<Modal open={!!mes} title={mes && `Facturar los pagos de ${mes}`} width={1040} destroyOnHidden closable={!emitiendo} maskClosable={false}
  okText={...} cancelText="Cancelar"
  onOk={emitido && !marcadas.length ? () => alCerrar(true) : emitir} onCancel={() => alCerrar(emitido)} confirmLoading={emitiendo}
  okButtonProps={{ disabled: !emitido && !marcadas.length }} cancelButtonProps={{ disabled: emitiendo }}>
```

`DECISIONES.md` línea 11: el ítem "**Facturación ARCA**" (plan 031).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Todo      | `npm test`          | all pass            |

## Scope

**In scope**: el `<Modal` de `FormLoteFacturas` en `src/Transferencias.tsx`; `DECISIONES.md` (una línea).

**Out of scope**: `FormFactura`, `FormNotaCredito` y los demás modales (emiten un solo comprobante y esperan la respuesta
con el modal abierto; si se cierra con Esc, el pedido único termina igual y queda guardado). Servidor.

## Steps

### Step 1: Esc bloqueado mientras emite

En el `<Modal` de `FormLoteFacturas`: agregar `keyboard={!emitiendo}` y cambiar `onCancel` a
`onCancel={() => { if (!emitiendo) alCerrar(emitido); }}` (doble seguro: cualquier otro camino a `onCancel` tampoco cierra).

**Verify**: `npm run typecheck` → exit 0. A mano (servidor de prueba o homologación con 2+ pagos): Emitir y apretar Esc
durante la emisión → el modal sigue abierto hasta que termina; después Esc lo cierra.

### Step 2: DECISIONES.md

Después del ítem "Facturación ARCA" (línea 11), agregar:

```
- **Facturar en lote** (2026-11-26, plan 082): Transferencias → "Facturar pagos del mes" factura los pagos ya registrados sin factura, con un emisor para todo el lote (editable por fila). Emite de a uno con la ruta de un pago (el servidor no encola); sin conexión corta. Quedan afuera, para hacerlos de a uno, los propietarios sin datos fiscales o con facturas hechas por fuera en ARCA ese mes. Marcar pagado sigue siendo de a uno.
```

### Step 3: Suite completa

**Verify**: `npm run typecheck` → exit 0; `npm test` → todos pasan.

## Done criteria

- [ ] `grep -n "keyboard={!emitiendo}" src/Transferencias.tsx` → una línea
- [ ] `grep -n "Facturar en lote" DECISIONES.md` → una línea
- [ ] `npm run typecheck` y `npm test` exit 0
- [ ] `git status` solo muestra `src/Transferencias.tsx`, `DECISIONES.md`, `package.json` (patch) y `plans/README.md`

## STOP conditions

- Antd ya no acepta `keyboard` en `Modal` (typecheck falla en esa prop).

## Maintenance notes

- Si algún día otro modal hace un `for` de pedidos, tiene que bloquear Esc igual (`keyboard={!ocupado}`).
- Sin test automático: la app no tiene tests de componentes React; se prueba a mano.
