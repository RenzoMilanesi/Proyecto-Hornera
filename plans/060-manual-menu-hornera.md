# Plan 060: El manual explica el menú nuevo y la pantalla Resumen Hornera

> **Instrucciones para quien ejecuta**: seguí el plan paso por paso. Corré cada verificación y confirmá el
> resultado esperado antes de seguir. Si pasa algo de "Condiciones de STOP", pará y avisá: no improvises.
> Al terminar, actualizá la fila de este plan en `plans/README.md`.
>
> **Chequeo de deriva (primero)**: `git diff --stat dcc7481..HEAD -- manual/manual.html src/ResumenHornera.tsx src/App.tsx`
> `src/App.tsx` y `src/ResumenHornera.tsx` cambian en el commit que agrega Resumen Hornera (es esperable). Si
> `manual/manual.html` cambió, compará los fragmentos de "Estado actual" con el archivo; si no coinciden, STOP.

## Estado

- **Prioridad**: P2
- **Esfuerzo**: S
- **Riesgo**: LOW
- **Depende de**: ninguno (el código de Resumen Hornera ya está)
- **Categoría**: docs
- **Planificado sobre**: commit `dcc7481` + el cambio de Resumen Hornera sin commitear, 2026-10-23

## Por qué importa

La app reagrupó el menú (MES desapareció; ahora hay PROPIETARIOS y HORNERA) y sumó la pantalla **Resumen Hornera**.
El Resumen de deptos ya no muestra el resultado de Hornera ni los saldos de cuentas. El manual de usuario
(`manual/manual.html`, que se convierte en el PDF que abre la app) sigue describiendo el menú y el Resumen viejos:
quien lo lea va a buscar pantallas y tarjetas que no están donde dice.

## Estado actual

- `src/App.tsx`: el objeto `secciones` define el menú (`grupo: 'Datos/Propiedades'` = submenú desplegable dentro de DATOS). Grupos y pantallas hoy:
  - sin grupo: Resumen
  - **HORNERA**: Resumen Hornera, Movimientos, Cuentas, Vencimientos, Limpieza, Comprobantes, Emisores, Gastos personales
  - **DATOS**: Deptos y el submenú **Propiedades** (abierto de entrada) con Liquidación, Transferencias, Historial y Propietarios
  - **HERRAMIENTAS**: Stays, Importar Excel, Auditoría, Terminales, Copias de seguridad (las dos últimas solo en la PC servidor)
- `src/ResumenHornera.tsx`: la pantalla nueva. Abre en el **mes en curso** (se puede elegir otro). Muestra:
  - tarjetas: Resultado del mes, Honorarios, Ingresos − gastos empresa, Disponible $, Disponible US$, Gastos personales;
  - "Resultado del mes": honorarios + costos operativos cobrados + ingresos y gastos de la empresa, y una tabla de esos
    ingresos y gastos **por concepto** ("Sin concepto" si no tiene). La limpieza pagada aparece como concepto Limpieza;
  - "Gastos personales del mes": total por persona (Amancay, Lautaro, Compartidos, Casa del Estudiante, Casa). No se restan del resultado;
  - "Lo que falta pagar": vencimientos del mes sin pagar (vencidos en rojo, sin importe porque no está cargado),
    liquidaciones de limpieza sin pagar con su importe, y lo que falta pagar a propietarios del último mes cerrado
    (sin los deptos de Hornera ni saldos en contra);
  - "Saldos de cuentas (hoy)" y la regla: Disponible = saldos − limpieza sin pagar − lo que falta pagar a propietarios;
  - "Facturado por emisor": el mes y los últimos 12 meses (para el tope del monotributo); suma lo emitido desde la app
    y lo importado de Mis Comprobantes sin contarlo dos veces; las notas de crédito restan;
  - "Evolución mensual" (meses cerrados): honorarios, costos operativos, gastos de la empresa, resultado, gastos personales.
- `src/Resumen.tsx`: el Resumen de deptos. La sexta tarjeta ahora es **Honorarios** (con el % del bruto). Ya no tiene
  "Resultado de Hornera" ni "Saldos de cuentas". La evolución quedó con noches, ocupación, ADR, RevPAR y bruto.
- `manual/manual.html`, fragmentos a corregir (líneas al planificar):
  - 141: `<p>A la izquierda está el menú, agrupado en tres partes.`
  - 145–148: tabla del menú con filas `—/Resumen`, `MES`, `DATOS`, `HERRAMIENTAS` (la de MES lista Liquidación, Transferencias,
    Historial, Comprobantes, Movimientos, Gastos personales, Vencimientos; la de DATOS lista Deptos, Propietarios, Cuentas, Emisores).
  - 178: `<div><b>9 · Controlar</b><br>Resumen y Cuentas: que los saldos den como el banco.</div>`
  - 186–205: capítulo `<h1>5. Resumen</h1>`; la línea 187 dice "ocupación, plata y el resultado de Hornera"; la 195 nombra
    "resultado de Hornera" entre las tarjetas; las 197–199 describen "Resultado de Hornera" y "Saldos de cuentas (hoy)".
- Estilo del manual: español rioplatense, frases cortas, `<b>` para nombres de pantallas y tarjetas, listas `<ul><li>`.
  Copiá el formato del capítulo 5 tal como está.

## Comandos

| Para qué | Comando | Resultado esperado |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test` | todos pasan |
| Base de demo | `node manual/seed.ts <carpeta temporal>` | imprime `ok <carpeta>` |
| PDF | ver `CLAUDE.md` ("Manual de usuario") | — |

## Alcance

**Dentro** (lo único que se modifica):
- `manual/manual.html`
- `src/ResumenHornera.tsx` — solo el título de una columna (paso 4)

**Fuera** (no tocar):
- `manual/img/*` y el PDF: las capturas se regeneran al final de la tanda de cambios visuales, no en este plan
  (decisión del usuario). Si una captura nueva hace falta, dejá el `<figure>` con `src="img/resumen-hornera.png"` igual;
  la generará `manual/capturar.mjs` más adelante.
- `manual/capturar.mjs`: agregar la captura de Resumen Hornera queda para esa tanda.
- Cualquier otro archivo de `src/` o `server/`.

## Git

Commit con el skill `commit-version` del repo (bump de versión, mensaje tipo `Docs: manual con el menú HORNERA y Resumen Hornera`). No hacer push salvo que lo pidan.

## Pasos

### Paso 1: Tabla del menú

En `manual/manual.html`, dejar "agrupado en tres partes". Reemplazar las filas de MES y DATOS por estas dos filas
(y dejar la de Resumen y la de HERRAMIENTAS):
- **HORNERA** · Resumen Hornera, Movimientos, Cuentas, Vencimientos, Limpieza, Comprobantes, Emisores, Gastos personales · La empresa misma: su plata, sus gastos y lo que factura.
- **DATOS** · Deptos y el desplegable <b>Propiedades</b> (Liquidación, Transferencias, Historial, Propietarios) · Los deptos, y lo que se le liquida y paga a cada dueño.

Cambiar el "Para qué" de Resumen a "La primera pantalla: cómo viene el mes en los deptos.". Agregar a HERRAMIENTAS
"Auditoría, Copias de seguridad" si no están (comparar con `src/App.tsx`).

**Verificar**: `grep -c "<b>MES</b>" manual/manual.html` → `0`; `grep -c "<b>HORNERA</b>" manual/manual.html` → `1`.

### Paso 2: Ciclo del mes

En el paso 9 del ciclo (línea ~178), cambiar el texto por: `Resumen Hornera y Cuentas: que los saldos den como el banco.`

**Verificar**: `grep -n "9 · Controlar" manual/manual.html` → la línea contiene `Resumen Hornera`.

### Paso 3: Capítulo Resumen y capítulo nuevo

- En el capítulo 5 (Resumen): sacar "y el resultado de Hornera" de la primera frase; en "Tarjetas de arriba" cambiar
  "resultado de Hornera" por "honorarios del mes (con el % sobre el bruto)"; borrar los dos `<li>` de "Resultado de Hornera"
  y "Saldos de cuentas (hoy)"; agregar al final del `<p>` inicial: `Lo de Hornera misma (resultado, cuentas, lo que falta
  pagar) está en <b>Resumen Hornera</b>.`
- Inmediatamente después del capítulo 5 (antes de `<h1>6. Liquidación</h1>`), agregar `<h2>Resumen Hornera</h2>` con
  un `<p>` que diga que abre en el mes en curso, y un `<ul>` con un `<li>` por bloque descripto en "Estado actual"
  (tarjetas, Resultado del mes, Gastos personales, Lo que falta pagar, Saldos y Disponible, Facturado por emisor,
  Evolución). Usá `<h2>` y no `<h1>` para no renumerar los capítulos siguientes.

**Verificar**: `grep -c "Saldos de cuentas (hoy):" manual/manual.html` → `1` (solo en Resumen Hornera);
`grep -c "<h2>Resumen Hornera</h2>" manual/manual.html` → `1`.

### Paso 4: Nombre de la columna de la evolución

En `src/ResumenHornera.tsx`, en la tabla "Evolución mensual", la columna `empresa_ars` se titula `'Gastos de la empresa'`
pero el número es ingresos menos gastos (la tarjeta de arriba ya dice "Ingresos − gastos empresa"). Cambiar el título
a `'Ingresos − gastos empresa'`.

**Verificar**: `grep -c "Gastos de la empresa'" src/ResumenHornera.tsx` → `0`; `npm run typecheck` → exit 0.

## Plan de tests

Sin tests nuevos (texto). `npm test` tiene que seguir pasando.

## Criterios de terminado

- [ ] `grep -c "<b>MES</b>" manual/manual.html` → `0`
- [ ] `grep -c "<h2>Resumen Hornera</h2>" manual/manual.html` → `1`
- [ ] `grep -c "Gastos de la empresa'" src/ResumenHornera.tsx` → `0`
- [ ] `npm run typecheck` y `npm test` → exit 0
- [ ] `git status` solo muestra `manual/manual.html`, `src/ResumenHornera.tsx` y `plans/README.md` (más lo de `commit-version`)

## Condiciones de STOP

- El menú de `src/App.tsx` no coincide con la lista de "Estado actual" (alguien lo volvió a cambiar).
- El capítulo 5 del manual ya no es "Resumen" o no tiene los `<li>` citados.
- Hace falta regenerar capturas o el PDF para terminar: no lo hagas, avisá.

## Notas de mantenimiento

- Cuando se regeneren las capturas, sumar en `manual/capturar.mjs` una de Resumen Hornera y actualizar `img/resumen.png`
  (la actual muestra las tarjetas viejas).
- Si se agrega una pantalla al menú, la tabla del capítulo 3 se actualiza en el mismo cambio.
