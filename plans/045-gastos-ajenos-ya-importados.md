# 045 — Anular los gastos ajenos que ya se importaron como gasto de Hornera

Escrito contra `da19b98` (más el cambio sin commitear de gastos ajenos en `server/importador/gastos.ts`). P2 · S.

## Por qué
Hasta este cambio, los códigos CAY, LAU, CAY/LAU, CASEST/CASAEST y BBVA del Excel de gastos varios entraban
como **gasto de la empresa** (movimiento sin depto, concepto "Gastos varios", detalle `[CODIGO] · descripción`).
Ahora no se importan (son personales, de la casa o de la Casa del Estudiante). Pero los que ya entraron en un
mes abierto siguen ahí y restan del Resultado de Hornera (`server/resumen.ts`). Reimportar no los saca:
`importarGastos` sale antes de mirar `origen` para esos códigos.

## Qué hacer
1. En `server/importador/gastos.ts`, dentro del `forEach`, justo donde hoy está
   `if (AJENOS.has(codigo)) return;`, antes del `return`: si existe un movimiento **vigente** con ese `origen`,
   del mes abierto, sin depto y cuyo `detalle` empieza con `[${codigo}]` (o `[CASAEST]` / `[LAU/CAY]` para los
   alias), anularlo con `anularMovimiento(db, id)` de `server/movimientos.ts` y sumar `r.anulados++`
   (campo nuevo en `ReporteGastos`, también en la interfaz de `src/Importar.tsx`, mostrado en el `Descriptions`
   de "Ya estaban"). El chequeo del detalle evita tocar uno que alguien ya reasignó a mano.
   Mismo tratamiento para `BBVA` en su `if`.
2. Test en `server/importador/gastos.test.ts`, siguiendo el primero: insertar a mano (o importar con la
   versión vieja simulada vía `crearMovimiento`) un movimiento con `origen = 'gastos:X10:1'`,
   `detalle = '[CAY] · ropa'`, sin depto; importar el Excel; esperar `estado = 'anulado'` y `anulados: 1`.
   Otro con el detalle editado (sin `[CAY]`) no se anula.

## Fuera de alcance
Meses cerrados (no se tocan); el cálculo de `cuenta`.

## Done
`npm test` y `npm run typecheck` pasan.

## STOP si
`anularMovimiento` tira por mes siguiente cerrado: reportar en `avisos` en vez de cortar la importación.
