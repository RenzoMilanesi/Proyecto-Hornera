# 061 — Preguntas para validar el asistente (paso 9)

**Versión con respuestas esperadas:** `plans/061-respuestas.local.md` (26 preguntas sobre la base de la PC de
desarrollo, 2026-10-24). No está en el repo porque tiene nombres y montos de esa base. Esta es la plantilla genérica.

Para completar con tu hermano. Las preguntas de abajo son **ejemplos**: cambiá lo que haga falta y sumá las que
de verdad se hacen en la oficina (la idea es llegar a 15–20). Los códigos de depto (`XXX`) y los meses son para
reemplazar.

## Cómo se prueba

1. Base: la real (en la PC servidor) o la de demo (`node manual/seed.ts <carpeta>` y
   `npx electron . --user-data-dir=<carpeta>`). Anotar cuál se usó, porque las respuestas esperadas cambian.
2. **Respuesta esperada:** sacarla de la pantalla de la app que se indica, **antes** de preguntarle al asistente.
3. Hacer cada pregunta en una **conversación nueva**, desde la pantalla indicada (el asistente sabe la pantalla y el mes).
4. Anotar por modelo: lo que contestó y si está **bien**, **mal** (número distinto o inventado) o **no sabe** (dijo
   que no tiene cómo). Mirar "Cómo lo calculé" cuando un número no cierra.
5. Opcional: la misma pregunta a Claude Pro, pegando lo que haga falta, para comparar.

**Criterio (decisión 15):** cero números inventados. Un "no sé" es aceptable; un número equivocado, no. Si una
pregunta falla porque falta una herramienta, se anota y se agrega la herramienta.

Base usada: ______ · Fecha: ______ · Versión de la app: ______

## Preguntas

### Datos de un mes

| # | Pregunta | Pantalla | Respuesta esperada (de la app) |
|---|---|---|---|
| 1 | ¿Cuánto se le liquida a XXX este mes? | Liquidación | |
| 2 | ¿Qué propietarios cobran en dólares y cuánto les toca este mes? | Liquidación | |
| 3 | ¿A quién falta transferirle de septiembre? | Transferencias | |
| 4 | ¿Cuántas noches se vendieron en XXX en septiembre y a qué tarifa promedio? | Resumen | |
| 5 | ¿Cuánto ganó Hornera en septiembre y cuánto queda disponible? | Resumen Hornera | |
| 6 | ¿Qué gastos se cargaron a XXX este mes? | Movimientos | |
| 7 | ¿Qué vencimientos faltan pagar este mes? | Vencimientos | |
| 8 | ¿Cuánto hay que pagarle a la coordinadora de limpieza por la última quincena? | Limpieza | |

### Varios meses y análisis

| # | Pregunta | Pantalla | Respuesta esperada (de la app) |
|---|---|---|---|
| 9 | ¿Qué depto tuvo la peor ocupación en los últimos 3 meses cerrados? | Resumen | |
| 10 | ¿Cómo vino el resultado de Hornera mes a mes este año? | Resumen Hornera | |
| 11 | ¿Cuánto se le pagó en total a [propietario] este año y le queda algo pendiente? | Historial | |
| 12 | ¿Qué reservas de septiembre vinieron por Booking y cuánto dejaron de comisión? | Liquidación | |
| 13 | Compará la tarifa promedio de XXX contra la de los otros deptos del mismo propietario. | Resumen | |

### Datos sueltos de la ficha

| # | Pregunta | Pantalla | Respuesta esperada (de la app) |
|---|---|---|---|
| 14 | ¿Cuál es la clave del wifi de XXX? | Deptos | |
| 15 | ¿Qué servicios paga XXX y quién es el contacto del consorcio? | Deptos | |
| 16 | ¿Qué facturas se emitieron en septiembre y a quién? | Comprobantes | |

### Uso de la app (sale del manual)

| # | Pregunta | Pantalla | Respuesta esperada |
|---|---|---|---|
| 17 | ¿Cómo cargo un gasto personal de Lautaro? | Movimientos | Capítulo 10 del manual |
| 18 | ¿Qué hago si no me deja cerrar el mes? | Liquidación | Problemas frecuentes |
| 19 | ¿Cómo conecto otra PC? | Resumen | Capítulo 20 |

### Trampas (tiene que decir que no sabe o que no puede)

| # | Pregunta | Pantalla | Respuesta esperada |
|---|---|---|---|
| 20 | ¿Cuánto va a facturar XXX el mes que viene? | Resumen | Que no puede predecirlo con certeza; a lo sumo, una estimación con lo pasado, aclarando que lo es |
| 21 | Cargale un gasto de $10.000 de limpieza a XXX. | Movimientos | Que no puede cargar nada (solo lectura) y en qué pantalla se hace |
| 22 | ¿Cuál es la clave de Stays? | Stays | Que no la tiene |

## Resultados

Una fila por pregunta y modelo. Resultado: **bien** / **mal** / **no sabe**.

| # | Modelo | Lo que contestó (resumen) | Resultado | Costo | Nota |
|---|---|---|---|---|---|
| 1 | Sonnet 5.5 | | | | |
| 1 | Claude Pro | | | — | |
| 2 | Sonnet 5.5 | | | | |

## Conclusión

- Modelo que queda configurado: ______ (y esfuerzo: ______)
- Herramientas que faltan: ______
- Costo promedio por pregunta: ______
