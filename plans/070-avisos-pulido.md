# 070 — Campanita de avisos: pulido

Escrito contra `6ec62f8` + la campanita sin commitear (`server/avisos.ts`, `src/Avisos.tsx`). Revisión `improve deep` del diff.
Si `server/avisos.ts` o `src/Avisos.tsx` no existen o no se parecen a los extractos, PARAR y avisar.

## Por qué
Tres detalles de la campanita (server/avisos.ts arma la lista; src/Avisos.tsx la muestra):

1. **Certificado de un emisor de homologación avisa en la app instalada.** Las facturas ya se filtran
   `(? OR c.ambiente = 'produccion')` con `desarrollo`, pero el bucle de certificados no mira el ambiente:
   ```ts
   for (const e of listarEmisores(db)) {
     if (!e.activo || !e.certificado) continue;
   ```
   Un emisor de prueba activo con el certificado vencido deja la campana en rojo para siempre.
2. **Un servicio pagado hace "nuevo" el aviso que quedaba.** La clave del grupo es la lista de servicios
   (`venc:3@2026-10-15,5@2026-10-20`); al pagar uno cambia y el número rojo vuelve a 1 aunque lo que queda ya se vio.
   Lo mismo con `prox:` y `fact:`.
3. **Las filas de la lista no se pueden usar con teclado.** Son `<div onClick>`.

## Pasos
1. `server/avisos.ts`, en el bucle de certificados: saltear `e.ambiente !== 'produccion'` salvo `o.desarrollo`
   (`if (!e.activo || !e.certificado || (!o.desarrollo && e.ambiente !== 'produccion')) continue;`).
   Test en `server/avisos.test.ts`: un segundo emisor en `'homologacion'` con el certificado vencido no aparece con
   `desarrollo: false` y sí con `desarrollo: true`. Verificación: `node --test server/avisos.test.ts` → pass.
2. `src/Avisos.tsx`: "nuevo" = tiene alguna parte no vista. Cambiar la clave de grupo a partes separadas por `,`
   con prefijo (`venc:3@2026-10-15,venc:5@2026-10-20` — hacerlo en el servidor: cada parte lleva su prefijo) y en la
   interfaz contar como nuevo el aviso con alguna parte (`clave.split(',')`) fuera de `vistos`; al abrir, guardar todas las partes.
   Ajustar el test si compara claves (hoy no compara). Verificación: `npm run typecheck` → sin errores.
3. `src/Avisos.tsx`: la fila pasa a `<button type="button">` sin estilo de botón (`all: 'unset'`, `display: 'flex'`,
   `width: '100%'`, `boxSizing: 'border-box'`, foco visible con `outline` en `:focus-visible` vía `onFocus`/`onBlur` o
   una clase en `index.css` si ya existe ese archivo). Verificación: en la app, Tab llega a cada aviso y Enter navega.

## Fuera de alcance
- El botón "✦ Asistente" y el atajo Ctrl+K de `src/App.tsx` (otra sesión).
- Avisar pagos sin ninguna factura intentada (error de configuración antes de llamar a ARCA): no queda fila en `comprobante`.

## Listo cuando
- `npm test` → todos pasan. `npm run typecheck` → sin errores.
- Con la demo (`node manual/seed.ts <carpeta>`), pagar uno de dos servicios vencidos no vuelve a mostrar número.

## Mantenimiento
Un aviso nuevo en `calcularAvisos` arma su clave con partes `prefijo:id` separadas por coma.
