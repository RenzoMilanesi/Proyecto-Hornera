# 052 — PDF del propietario: que la ocupación se entienda con los renglones de arriba

Escrito contra `fcbdf9e` (2026-10-23). P3 · S · riesgo BAJO. Depende de: ninguno.

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 052 de `plans/README.md`.
>
> **Chequeo de cambios (primero):** `grep -n "Ocupación</span>" src/Imprimir.tsx` → 1 línea que contiene
> `ocupables / (h.noches.disponibles - h.noches.propietario)`. Si no, parar y avisar.

## Por qué

Desde v0.37.0 la ocupación del PDF del propietario no cuenta las estadías del propietario ("Ocupado cliente")
ni como vendidas ni como disponibles. Pero el bloque "Período" del PDF sigue mostrando los renglones de
siempre, y la cuenta no cierra a simple vista. Ejemplo con 30 noches, 5 del propietario y 20 ocupadas:

```
Disponible        30 noches
No disponible      0 noches
Ocupado cliente    5 noches
Ocupado           20 noches     ← incluye las 5 del propietario
Ocupación         60 %          ← (20 − 5) / (30 − 5); quien lee hace 20/30 = 67 % y piensa que está mal
```

## Estado actual

`src/Imprimir.tsx` (hoja del PDF de cada depto):

```tsx
  const ocupables = h.noches.ocupadas - h.noches.propietario;
  ...
          <div className="fila"><span className="etiqueta">Disponible</span><span>{h.noches.disponibles} noches</span></div>
          <div className="fila"><span className="etiqueta">No disponible</span><span>{h.noches.noDisponibles} noches</span></div>
          <div className="fila"><span className="etiqueta">Ocupado cliente</span><span>{h.noches.propietario} noches</span></div>
          <div className="fila"><span className="etiqueta">Ocupado</span><span>{h.noches.ocupadas} noches</span></div>
          <div className="fila"><span className="etiqueta">Reservas</span><span>{h.noches.reservas}</span></div>
          <div className="fila"><span className="etiqueta">Ocupación</span><span>{h.noches.disponibles > h.noches.propietario ? pct(ocupables / (h.noches.disponibles - h.noches.propietario)) : '-'}</span></div>
```

Los renglones "Disponible", "No disponible", "Ocupado cliente" y "Ocupado" copian la hoja del Excel que los
propietarios conocen: **no cambiarlos ni sacarlos**.

## Paso 1 — Dos renglones nuevos, justo antes de "Ocupación"

Agregar, con el mismo marcado de `div.fila`:

- **"Para alquilar"**: `{h.noches.disponibles - h.noches.propietario} noches`
- **"Alquilado"**: `{ocupables} noches`

y cambiar la etiqueta "Ocupación" por **"Ocupación (alquilado / para alquilar)"**. El valor no cambia.

Con el ejemplo: Para alquilar 25 · Alquilado 15 · Ocupación (alquilado / para alquilar) 60 %.

No tocar "Tarifa diaria prom." ni el resto del PDF.

Verificación: `npm run typecheck` sin errores.

## Paso 2 — Ver el PDF

1. `node manual/seed.ts <carpeta temporal>` y `npx electron . --user-data-dir=<esa carpeta>`.
2. Abrir Liquidación de un mes cerrado → imprimir/ver el PDF de un depto. Los dos renglones nuevos aparecen y
   el bloque "Período" no se pasa de su columna (si empuja la tabla "Resumen" de al lado hacia abajo, avisar).
3. La base de demo no tiene estadías del propietario: ahí "Para alquilar" = "Disponible" y "Alquilado" = "Ocupado".
   Es lo esperado.

## Paso 3 — Manual

En `manual/manual.html`, buscar donde se explica el bloque "Período" del PDF (`grep -n "Ocupado cliente" manual/manual.html`).
Si existe, sumar una línea: "Para alquilar" = disponibles menos las noches del propietario; "Alquilado" = ocupadas
menos las del propietario; la ocupación es alquilado sobre para alquilar. Si no existe esa explicación, no
agregar una sección nueva. **No** regenerar capturas ni el PDF del manual.

## Hecho cuando

- `npm run typecheck` sin errores y `npm test` → `fail 0`.
- `grep -c "Para alquilar\|Alquilado" src/Imprimir.tsx` → 2 o más.
- PDF visto con la base de demo (paso 2).

## Fuera de alcance

- `server/liquidacion/hoja.ts`, el motor, Resumen y la pantalla Liquidación.
- Cambiar o sacar los renglones que vienen del Excel.

## Parar y avisar

- Si los renglones nuevos rompen el diseño de la hoja (la grilla de dos columnas) y no se arregla sin tocar CSS
  compartido.

## Mantenimiento

- Si algún día se dejan de mostrar las estadías del propietario en el PDF, volver a revisar estos renglones.
