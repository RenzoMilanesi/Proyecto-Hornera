# Plan 079: La tolerancia de "Comparar con el Excel" solo se guarda si cambió

> **Executor**: seguí los pasos en orden; corré cada verificación y confirmá el resultado antes de seguir. Si pasa algo
> de "PARAR si", frená y avisá: no improvises. Al terminar, actualizá la fila 079 de `plans/README.md`.
>
> **Drift check (primero)**: `git diff --stat 99306d3..HEAD -- src/Liquidacion.tsx server/liquidacion/comparar.ts`
> El commit de la tolerancia (v0.54.x) es esperado; si hay otros cambios en `guardarTolerancia`, comparar con los
> extractos de abajo y, si no coinciden, PARAR.

## Estado
- **Prioridad**: P3 · **Esfuerzo**: S · **Riesgo**: BAJO · **Depende de**: nada · **Categoría**: bug chico
- **Escrito contra**: `99306d3` + el diff de la tolerancia, 2026-11-25. Revisión `improve deep` de la tolerancia %.

## Por qué
En Liquidación hay un campo "Tolerancia %" junto a "Comparar con el Excel del mes". Se guarda en
`configuracion` (`comparar.tolerancia_pct`) con `guardarTolerancia` en `server/liquidacion/comparar.ts`, que además
escribe una fila de auditoría. En la pantalla, `guardarTolerancia` corre en **cada** `onBlur` y `onPressEnter`:

1. Entrar y salir del campo sin cambiar nada escribe una fila en Auditoría con antes = después (ruido).
2. Si ya había una comparación, la repite entera (vuelve a subir y leer el Excel) aunque el valor sea el mismo.
3. Si se borra el campo (queda `null`) no se guarda nada, pero el campo queda vacío: no muestra el valor vigente.

### Estado actual (`src/Liquidacion.tsx`)
```ts
  const guardarTolerancia = async () => {
    if (tolerancia === null) return;
    try {
      await enviar('liquidacion/comparar/tolerancia', 'PUT', { pct: tolerancia });
      if (comparado && comparacion) await comparar(comparado);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
```
El valor inicial se carga con `get<{ pct: number }>('liquidacion/comparar/tolerancia').then((t) => setTolerancia(t.pct), ...)`.

## Pasos
1. En `src/Liquidacion.tsx`, agregar un estado `toleranciaGuardada` (number | null), que se setea junto con
   `setTolerancia` al cargar el valor inicial.
2. En `guardarTolerancia`: si `tolerancia === null`, volver a `setTolerancia(toleranciaGuardada)` y salir; si
   `tolerancia === toleranciaGuardada`, salir sin hacer nada. Después del PUT exitoso, `setToleranciaGuardada(tolerancia)`.
3. Verificación: `npm run typecheck` sin errores; `npm test` todo en verde.
4. Prueba manual (`npm run dev`): en Liquidación, entrar y salir del campo sin cambiarlo → Herramientas → Auditoría no
   muestra una fila nueva de Configuración. Cambiarlo a 5 → aparece una fila (3 → 5). Borrarlo y salir → vuelve a 5.

## Fuera de alcance
- `server/liquidacion/comparar.ts` y las rutas de `server/app.ts`: no tocar.
- No agregar debounce ni guardar en cada tecla.

## Hecho cuando
- `npm run typecheck` y `npm test` pasan.
- La prueba manual del paso 4 da lo esperado.

## Mantenimiento
Si más adelante la tolerancia pasa a una pantalla de configuración general, llevar esta misma regla (guardar solo
si cambió) a ese lugar.
