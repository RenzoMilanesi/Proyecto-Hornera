# 044 — Auditoría: nombre de PC que choca con una terminal, pagos en dólares viejos y texto del ROADMAP

Escrito contra el commit `c2902cd` + la auditoría por usuario sin commitear. Revisión `improve deep` de esa
tarea, 2026-10-21. Prioridad P3 · Esfuerzo S · Riesgo bajo · Confianza alta (los tres verificados leyendo el código).

> Drift check: `git diff --stat c2902cd..HEAD -- server/auditoria.ts server/terminales.ts ROADMAP.md`. Si `nombrarPc`
> o `cambios` en `server/auditoria.ts` ya no son como se citan abajo, PARAR y avisar.

## Contexto
`server/auditoria.ts` registra cada cambio con `pc` = el nombre de la terminal (`pcActual`, lo pone
`server/terminales.ts` al autorizar) o el de la PC servidor (`nombrePc(db)`: `configuracion` clave `pc.nombre`, o el
de Windows). `nombrarPc(db, nombre)` guarda el nombre y hace `UPDATE auditoria SET pc = nuevo WHERE pc = anterior`.
`listarAuditoria` arma el texto "Qué cambió" con `cambios()` y `valor()`.

## 1. El nombre del servidor puede chocar con el de una terminal
`nombrarPc` no mira la tabla `terminal`. Si el servidor se llama igual que una terminal emparejada (p. ej. las dos
"Lautaro"), la auditoría no las distingue. Y si el servidor se llamaba como una terminal y se renombra, el `UPDATE`
también le cambia el nombre a los renglones de esa terminal.

Arreglo, en `nombrarPc` antes del `BEGIN`:
```ts
if (db.prepare('SELECT 1 FROM terminal WHERE revocada_en IS NULL AND lower(nombre) = lower(?)').get(n))
  throw new Error(`Ya hay una terminal que se llama ${n}: elegí otro nombre.`);
```
Y en `server/terminales.ts`, en `/api/terminales/emparejar`, el caso inverso: si `n` es igual (sin distinguir
mayúsculas) a `nombrePc(db)` o a otra terminal no revocada, responder 400 con un mensaje parecido. Ya importa
`nombrePc`.
Test en `server/auditoria.test.ts` (seguir el test "ponerle nombre a esta PC…"): insertar
`INSERT INTO terminal(nombre, token_hash, creada_en) VALUES ('PC Dos', 'x', 'x')` y verificar que
`nombrarPc(db, 'pc dos')` tira el error.

## 2. Pagos de liquidación en dólares registrados antes de este cambio se ven en pesos
`server/liquidacion/pagos.ts` registraba `{ pago_liquidacion, depto, mes, ...d }` con `d.importe` sin moneda; desde
la auditoría por usuario agrega `moneda`. `cambios()` usa `fila.moneda === 'USD'` para el campo `importe`, así que
los pagos viejos en dólares dicen "$ 731,00" en vez de "US$ 731,00". El pago trae `cuenta_id` (la cuenta tiene moneda).

Arreglo en `listarAuditoria`: cargar también `SELECT id, moneda FROM cuenta` y, para `importe`, usar
`fila.moneda ?? monedaDeCuenta(fila.cuenta_id)`. Si `cuenta_id` es null, queda en pesos (no hay de dónde saberlo).
Test: insertar a mano un renglón de auditoría `{"pago_liquidacion":1,"cuenta_id":<cuenta USD>,"importe":73100}` y
verificar "Importe: US$ 731,00".

## 3. El ROADMAP promete "reservas nuevas/cambiadas"
`ROADMAP.md`, punto 3 de Pendientes, dice que el renglón de "traer mes" tiene "(reservas nuevas/cambiadas, cobros)".
Lo que se registra es el `ReporteSync` de `server/stays/sync.ts` sin los avisos: reservas y pagos **traídos**,
medios, eliminadas, canceladas y la cantidad de avisos. Cambiar el texto a "(reservas y cobros traídos, canceladas,
eliminadas, avisos)". No cambiar el código.

## Fuera de alcance
- No hacer la auditoría inmutable ni deshacer el renombrado: renombrar lo viejo fue una decisión del usuario (2026-10-21).
- No agregar índices: la consulta por mes es chica.

## Done
- `npm run typecheck` sin errores y `npm test` en verde, con los dos tests nuevos.
- `grep -n "nuevas/cambiadas" ROADMAP.md` no encuentra nada.
