# 043 — El manual y la guía de prueba explican la auditoría por usuario

Escrito contra el commit `c2902cd` + la auditoría por usuario sin commitear. Revisión `improve deep` de esa
tarea, 2026-10-21. Prioridad P2 · Esfuerzo S · Riesgo bajo · Confianza alta.

> Drift check: `git diff --stat c2902cd..HEAD -- manual/manual.html manual/capturar.mjs GUIA-PRUEBAS.md src/Auditoria.tsx src/Terminales.tsx`.
> Si `src/Auditoria.tsx` o `src/Terminales.tsx` no existen o no tienen lo descrito abajo, PARAR y avisar.
> El plan 042 (otra tarea) también toca `manual/`: si tiene cambios sin commitear en `manual/`, esperar a que se commiteen.

## Problema
La auditoría por usuario agregó dos cosas que el manual (`manual/manual.html`) y la guía de prueba
(`GUIA-PRUEBAS.md`) no mencionan:
- **Herramientas → Auditoría** (`src/Auditoria.tsx`): una tabla con Fecha, Quién (la PC), Qué (tipo y a qué se
  refiere), Acción y "Qué cambió" (solo los campos que cambiaron), con filtros por mes, PC y tipo. "Traer mes" de
  Stays y las importaciones (Excel mensual, gastos varios) dejan un renglón con el resumen.
- **Terminales → "Nombre de esta PC"** (`src/Terminales.tsx`): el nombre con el que quedan en la auditoría los
  cambios hechos en el servidor. Al guardarlo, los renglones viejos con el nombre anterior pasan a decir el nuevo.
  Las terminales quedan con el nombre del emparejamiento.

Lugares desactualizados:
- `manual/manual.html:148`: el menú dice "Stays, Importar Excel, Terminales" (falta Auditoría).
- `manual/manual.html:576-600` (capítulo "16. Terminales"): no tiene "Nombre de esta PC"; su figura
  `img/terminales.png` es vieja.
- No hay capítulo de la Auditoría.
- `GUIA-PRUEBAS.md`, sección "## 7. Terminales (fase 5d)": no prueba que lo hecho en cada PC quede con su nombre.

## Solución
1. `manual/manual.html:148`: "Stays, Importar Excel, Auditoría, Terminales".
2. En el capítulo 16, antes de `<h2>Conectar una PC nueva</h2>`, un `<h2>Nombre de esta PC</h2>` con dos o tres
   frases (qué es, que renombra lo anterior, que las terminales usan el nombre del emparejamiento). Usar el mismo
   estilo de los párrafos vecinos (`<span class="menu">`, `<span class="boton">`).
3. Un capítulo nuevo "Auditoría: quién cambió qué" justo antes del capítulo 16 (renumerar los `<h1>` siguientes y el
   índice, `manual/manual.html:70-90`), con una figura `img/auditoria.png` y una lista: qué registra (movimientos,
   ajustes de reservas, Variables, cotización, cierre/reapertura, cuentas, emisores, comprobantes; "traer mes" e
   importaciones como un renglón con el resumen), que "Qué cambió" muestra solo lo que cambió, y que lo de "Qué"
   usa los datos de hoy (si después se cambió el depto de un movimiento, se ve el nuevo).
4. `manual/capturar.mjs`: después de la captura de Terminales (buscar `terminales.png`), `await ir('Auditoría');
   await foto('auditoria');` y volver a sacar `terminales.png` (ahora con el nombre). Seguir el patrón de las
   capturas vecinas.
5. `GUIA-PRUEBAS.md` sección 7: agregar pasos:
   - "En el servidor, **Terminales** → *Nombre de esta PC* = el de quien la usa. En **Auditoría** los cambios
     viejos de esa PC pasan a decir ese nombre."
   - "Cargar un movimiento desde la terminal: en **Auditoría** figura con el nombre de la terminal; editarlo y ver
     que *Qué cambió* muestra solo el importe."
   - En la sección de Stays: "Después de *Traer mes*, en **Auditoría** hay un renglón *Traer mes de Stays* con el resumen."
6. Regenerar capturas y PDF con los comandos de `CLAUDE.md` (sección "Manual de usuario"): `node manual/seed.ts <tmp>`,
   abrir `npx electron . --user-data-dir=<tmp>`, `npx electron manual/capturar.mjs manual/img`, `npx electron manual/pdf.mjs`.

## Fuera de alcance
- No tocar código de `src/` ni `server/`. No tocar el capítulo de Liquidación (es del plan 042).
- Datos reales nunca: las capturas salen de `manual/seed.ts` (ficticios).

## Done
- `grep -c "Auditoría" manual/manual.html` ≥ 4 y `grep -n "Nombre de esta PC" manual/manual.html GUIA-PRUEBAS.md` encuentra ambos.
- `manual/img/auditoria.png` existe; el PDF se regeneró sin errores.
- `npm test` sigue en verde (no debería cambiar).

## Mantenimiento
Si se agrega una tabla auditada nueva, sumarla a la lista del capítulo y a `TIPOS` en `server/auditoria.ts`.
