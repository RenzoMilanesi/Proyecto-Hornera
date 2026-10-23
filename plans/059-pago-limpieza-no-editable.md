# 059 — El pago de una liquidación de limpieza no se edita desde Movimientos

Escrito contra `ad5d3f7` + los cambios sin commitear del plan 057 (2026-10-23). P2 · S · riesgo BAJO. Depende de: 057.

## Por qué
`pagarLiquidacion` (`server/limpieza.ts`) crea el pago a la coordinadora como un movimiento de tipo `gasto` de la
empresa (concepto Limpieza) y guarda la foto por chica en `liquidacion_limpieza_operaria`. Pero
`editarMovimiento` (`server/movimientos.ts`, ~línea 107) solo frena la edición de los tipos `liquidacion` y
`transferencia`:

```ts
if (antes.tipo === 'liquidacion' || antes.tipo === 'transferencia') {
  throw new Error('Los pagos de liquidación y las transferencias no se editan: se anulan y se vuelven a cargar.');
}
```

Entonces desde la pantalla Movimientos se puede cambiar el importe o la fecha de ese gasto y queda distinto del total
de la liquidación de limpieza (que sigue mostrando la foto y "pagada"). Lo correcto es lo mismo que con los pagos a
propietarios: **se anula y se vuelve a pagar** (anular ya deja la liquidación pendiente, por el trigger
`tr_mov_anulado_libera_liq_limpieza` de `schema.sql`).

## Reglas del repo (de CLAUDE.md)
TypeScript sin build, imports con `.ts`, mensajes de error en español para mostrar tal cual, estilo mínimo.

## Pasos
1. En `server/movimientos.ts`, dentro de `editarMovimiento`, después del chequeo de `liquidacion`/`transferencia`,
   agregar:
   ```ts
   if (db.prepare('SELECT 1 FROM liquidacion_limpieza WHERE movimiento_id = ?').get(id)) {
     throw new Error('Es el pago de una liquidación de limpieza: no se edita. Anulalo y volvé a marcarla pagada en Limpieza.');
   }
   ```
   No tocar `anularMovimiento`: anular tiene que seguir funcionando.
2. En `server/limpieza.test.ts`, en el test `liquidación: toma las tareas del período…`, antes de `anularMovimiento`,
   agregar `assert.throws(() => editarMovimiento(db, movimiento_id, {...}), /liquidación de limpieza/)` (importar
   `editarMovimiento` de `./movimientos.ts`; datos: `mes: '2026-10', fecha: '2026-10-16', depto: null, tipo: 'gasto',
   concepto: 'Limpieza', detalle: null, importe_ars: -1, importe_usd: 0, cuenta_id: null`).

## Done
`npm test` (todo pasa, incluido el assert nuevo) y `npm run typecheck` sin errores.

## Fuera de alcance
Cambiar la pantalla Movimientos (el botón Editar puede seguir; el error del servidor se muestra solo).

## STOP si
`editarMovimiento` ya tiene otro chequeo de este tipo (otro plan lo agregó): no duplicar.
