# Plan 033: Fechas de servicio en facturas y NC, y CAE perdido por timeout (etapas 5 y 6 del plan 031)

> **Executor instructions**: este plan no es código suelto: son tres reglas que la **etapa 5 y la
> etapa 6 del plan 031** tienen que cumplir al implementarse. Ejecutalo junto con esas etapas (en
> `server/facturacion.ts`), no antes. Si aparece una condición STOP, frená y reportá. Al terminar,
> marcá A TESTEAR en `plans/README.md`.
>
> **Drift check**: `git diff --stat 87d34c8..HEAD -- server/arca.ts server/fiscal.ts`. Si
> `solicitarCAE` ya no recibe `servDesde`/`servHasta`/`vtoPago`, o `fechaComprobante` cambió de
> firma, STOP.

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: MED (rechazos de ARCA en producción) · **Depends on**: 031 etapa 2 (hecha)
- **Category**: correctness
- **Planned at**: `87d34c8` + etapa 2 del plan 031 sin commitear (v0.17.x), 2026-10-19 (revisión
  `improve deep` de la etapa 2)

## Why this matters
La etapa 2 dejó `server/arca.ts` (`solicitarCAE`) y `server/fiscal.ts` (`fechaComprobante`) listos.
`solicitarCAE` arma Concepto 2 (servicios) así: después de `<ImpIVA>` manda
`<FchServDesde>`, `<FchServHasta>` y `<FchVtoPago>` (AAAAMMDD), y sin esos tres sale con
`ErrorArca` tipo `config` sin llamar a ARCA. El plan 031 deja tres huecos que el porte de Roble no
cubre porque Roble solo emite Concepto 1 (productos):

1. **FchVtoPago anterior a CbteFch.** El plan 031 dice `FchVtoPago = fecha de emisión` y
   `CbteFch = fecha del pago`, corregida por `fechaComprobante` (que puede **subirla** hasta la
   fecha del último comprobante autorizado). Si el último autorizado quedó con fecha posterior a
   hoy, `CbteFch > FchVtoPago` y ARCA rechaza (el vencimiento del pago no puede ser anterior a la
   fecha del comprobante). Confianza MEDIA en el código exacto del error: confirmarlo en homologación.
2. **La NC también es Concepto 2.** Una nota de crédito de un servicio lleva las mismas tres fechas.
   La etapa 6 del plan 031 no lo dice, y `solicitarCAE` la rechazaría con `config` antes de salir.
3. **CAE perdido por timeout.** Si `solicitarCAE` corta por red (`tipo: 'red'`) después de que
   ARCA otorgó el CAE, el intento se guarda `rechazado` y el reintento usa `ultimoAutorizado + 1`:
   no duplica, pero ese número queda autorizado en ARCA y sin fila aprobada en Hornera. Roble tiene
   el mismo techo marcado con `ponytail:` (`electron/db/repos/facturacion.js`, en `solicitarCAE`).

## Estado
- Reglas 1 y 3: **HECHAS** con la etapa 5 del plan 031 (`server/facturacion.ts`, tests en
  `server/facturacion.test.ts`). Regla 3: el intento sin respuesta guarda lo pedido en `request_json` (JSON, sin
  ticket) con `response_json` NULL; si `ultimoAutorizado` llegó a ese número, la API responde 409 con `revisar`
  y no pide el CAE hasta que se reenvíe con `revisado: true` ("Ya lo revisé: emitir igual").
- Regla 2 (NC): pendiente, va con la etapa 6.
- Falta confirmar en homologación que ARCA acepta `FchVtoPago == CbteFch` (STOP de abajo).

## Reglas a implementar (en `server/facturacion.ts`)

1. **Fecha**: calcular primero `cbteFecha = fechaComprobante({ fechaPago, fechaUltimo, hoy: hoyLocal() })`
   (`hoyLocal` está en `server/cotizacion.ts`), y pasar **`vtoPago = fechaArca(cbteFecha)`**, no hoy.
   Así `FchVtoPago == CbteFch` siempre.
2. **NC**: `notaCredito(comprobanteId)` pasa `servDesde`/`servHasta` de la factura asociada
   (`comprobante.serv_desde`/`serv_hasta`, convertidas con `fechaArca`), `fecha` = hoy local y
   `vtoPago` = esa misma fecha. Guarda `serv_desde`/`serv_hasta` iguales a los de la factura.
3. **CAE perdido**: antes de emitir (y al reintentar), si hay un intento `rechazado` de ese
   movimiento cuyo `motivo` es de red, consultar `ultimoAutorizado`; si el número avanzó respecto del
   que se intentó, **no** emitir de nuevo a ciegas: mostrar "ARCA puede haber autorizado el
   comprobante n.º X: revisalo en Comprobantes en Línea antes de reintentar". ponytail: aviso
   manual; el upgrade es `FECompConsultar` del número y guardar el CAE recuperado, pero
   `consultarComprobante` hoy solo devuelve la fecha.

## Tests (en `server/facturacion.test.ts`, con `fetch` falso como en `server/arca.test.ts`)
- Último autorizado con fecha posterior a la del pago: el request lleva `<FchVtoPago>` igual a `<CbteFch>`.
- NC: el request lleva `<Concepto>2</Concepto>` y las fechas de servicio de la factura.
- Timeout en `solicitarCAE` seguido de `ultimoAutorizado` que avanzó: no se llama a `FECAESolicitar`
  y el error dice el número.

## Done criteria
- `npm test` y `npm run typecheck` en verde.
- En homologación: una factura y su NC autorizadas con Concepto 2.

## STOP conditions
- ARCA rechaza `FchVtoPago == CbteFch` en homologación: STOP con el código de error.

## Maintenance
Si alguna vez se factura Concepto 1, `solicitarCAE` ya omite las fechas de servicio (`concepto: 1`).
