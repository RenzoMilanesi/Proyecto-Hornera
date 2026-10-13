# Plan 025: No se paga un mes cuyo saldo ya pasó al mes siguiente cerrado

> **Executor instructions**: Seguí los pasos en orden y corré cada verificación.
> Si aparece una condición STOP, frená y reportá. Al terminar, marcá DONE en
> `plans/README.md`.
>
> **Drift check**: `git diff --stat 96c5a7e..HEAD -- server/liquidacion/pagos.ts src/Transferencias.tsx`.
> La fase 5c se escribió después de ese commit (sin commitear al planificar).

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none
- **Category**: bug (plata)
- **Planned at**: commit `96c5a7e` + fase 5c sin commitear, 2026-10-12

## Why this matters
El saldo de arrastre de un mes es el saldo final del mes anterior menos lo pagado
(`server/liquidacion/servicio.ts`). Si el mes M+1 se cierra con M sin pagar, el saldo de M queda
congelado dentro de M+1 (la nota de la hoja: "se computará como crédito para el próximo período").
`pagarLiquidacion` (`server/liquidacion/pagos.ts`) igual deja pagar M: esa plata se pagaría dos veces.

## Commands
| Propósito | Comando | Esperado |
|---|---|---|
| Tipos | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |

## Scope
**In**: `server/liquidacion/pagos.ts`, `server/liquidacion/cierre.test.ts`, `src/Transferencias.tsx`.

## Steps
1. `listarTransferencias`: campo `arrastrado` = el período siguiente existe y está cerrado.
2. `pagarLiquidacion`: si `arrastrado`, error "El saldo de M ya pasó a M+1 (cerrado): pagalo desde M+1."
3. `excelTransferencias`: no lista los arrastrados.
4. Pantalla Transferencias: en vez de "Marcar pagado", etiqueta "pasó a M+1".
5. Test en `cierre.test.ts`: cerrar mayo y junio sin pagar mayo → pagar mayo falla y la fila sale
   como arrastrada.

**Verify**: `npm test` → pasa.
