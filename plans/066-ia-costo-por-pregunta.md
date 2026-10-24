# 066 — Bajar el costo de cada pregunta al asistente

Escrito sobre `548d5f2` (v0.44.2), 2026-10-23. Sale de pedir "optimizar": hoy hay que elegir modelo y esfuerzo antes
de preguntar.

## Lo medido (las 11 respuestas de la base real, Sonnet 5.5)

| Caso | Entrada sin caché | Caché | Costo |
|---|---|---|---|
| Primera pregunta de una conversación | ~34.000 | ~28.500 | ~US$ 0,07 |
| Siguiente, con el caché vivo (< 5 min) | ~400 | ~42.000 | ~US$ 0,01 |

Lo caro es arrancar en frío: unos 28.500 tokens fijos (herramientas + reglas + manual entero) que se escriben en el
caché. El manual eran unos 21.000 de esos tokens.

**Descartado:** un filtro que elija modelo o esfuerzo antes de preguntar. Por palabras clave se equivoca; con Haiku es
otra llamada con su contexto; si elige mal sale un número equivocado (contra la decisión 15). El pensamiento adaptativo
ya piensa poco en lo fácil: las 8 preguntas de prueba salieron bien con Sonnet en esfuerzo bajo.

## Paso 1 — El manual a pedido

- `server/ia/herramientas.ts`: `capitulosManual()` corta `manual/manual.html` por los `<h1>` numerados; herramienta
  `manual(capitulo)` devuelve uno.
- `server/ia/asistente.ts`: en las instrucciones va solo el índice (24 títulos) y la regla de leer el capítulo con la
  herramienta.
- Lo fijo baja a unos 7.000 tokens. Una pregunta de uso de la app paga una consulta más (un capítulo: ≤ 5.500 caracteres).

**Hecho (v0.44.3).**

## Paso 2 — Sonnet en esfuerzo bajo por defecto y "Pensar más"

- Lo predeterminado pasa a Sonnet 5.5 + esfuerzo bajo (el selector de Herramientas → Asistente sigue para cambiarlo).
- Debajo de cada respuesta, "Pensar más": repite esa pregunta en una conversación nueva con esfuerzo alto. Se paga más
  solo cuando una respuesta no convence, y se decide después de verla. Conversación nueva y no la misma: cambiar el
  esfuerzo a mitad de una conversación invalida su caché; además es una segunda opinión que no arrastra la primera.

**Hecho (v0.45.0).** Sin probar contra la API real.

## Paso 3 — El gasto del mes a la vista

Herramientas → Asistente muestra lo gastado desde el 1 del mes (todas las PCs, con los precios de `PRECIOS`) y el
promedio por pregunta: sirve para ver si vale seguir optimizando y para decidir el caché de 1 hora.

**Hecho (v0.46.0).**

## Para más adelante

- Caché de 1 hora (`ttl: '1h'`): escribir cuesta 2× en vez de 1,25×, y paga solo si entre pregunta y pregunta pasan
  entre 5 y 60 minutos. Decidir con un mes de `respuesta_ia.creada_en` real (la distribución de los intervalos).
