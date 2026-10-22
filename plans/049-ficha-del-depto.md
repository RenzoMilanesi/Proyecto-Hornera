# 049 — Ficha del depto y Vencimientos: lo que falta después de implementarlos

Escrito contra `cc1acdd` + el módulo Ficha/Vencimientos sin commitear (2026-10-22). P2 · S · riesgo BAJO. Depende de: ninguno.

> **Para quien ejecute:** seguí los pasos en orden y corré cada verificación antes de pasar al
> siguiente. Si pasa algo de la sección "Parar y avisar", pará y avisá: no improvises. Al terminar,
> actualizá la fila 049 de `plans/README.md`.
>
> **Chequeo de cambios (primero):** `git log --oneline -5 -- server/ficha.ts src/Ficha.tsx src/Vencimientos.tsx`.
> Tiene que existir el commit que agregó esos archivos. Si `server/ficha.ts` no existe, parar y avisar.

## Qué ya está hecho (no tocar)

El módulo se implementó el 2026-10-22, con las decisiones tomadas con Lautaro (no reabrir):

- **Esquema 19** (`schema.sql` + migración 18 → 19 en `server/db.ts`): `depto.notas`, `depto_servicio`
  (concepto, N° de cuenta, titular, `paga` hornera/propietario, vencimiento = `dia` + `cada_meses` + `mes_desde`),
  `depto_clave` (nombre, usuario, clave, nota) y `depto_contacto` (nombre, rol, teléfono, nota).
- **`server/ficha.ts`**: CRUD de las tres listas, notas y `vencimientos(db, mes)`. Un vencimiento se da por
  **pagado** si hay un movimiento `gasto` vigente del mismo depto y concepto con fecha en el mes. Solo avisan
  los servicios que paga Hornera, de deptos no finalizados.
- **Claves en texto en la base**: viajan en los backups (que pueden ir a Drive). Se ven ocultas en pantalla
  (mostrar/copiar). La auditoría registra solo las claves, **sin el valor** (dice "cargada" o "anterior → nueva").
- **UI**: botón "Ficha" en Deptos → Drawer con pestañas Servicios e impuestos · Claves · Contactos · Notas
  (`src/Ficha.tsx`); pantalla **Mes → Vencimientos** (`src/Vencimientos.tsx`).
- Quedaron afuera: adjuntos, inventario, cifrado de claves, contador en el menú, aviso en Resumen.

## Lo que falta

### Paso 1 — Registrar las decisiones en `DECISIONES.md`

En `DECISIONES.md`, antes de la sección `## Pendiente`, agregar un bloque con el estilo de los demás
(viñetas en negrita, una o dos líneas cada una):

```markdown
- **Ficha del depto (2026-10-22, con Lautaro):** servicios e impuestos con su vencimiento (día + cada cuántos meses +
  un mes en que vence), claves, contactos y notas. Un vencimiento se da por pagado solo, con un gasto vigente del depto
  y el mismo concepto en el mes: no hay tilde manual. Solo avisan los que paga Hornera.
- **Claves de los deptos en texto en la base:** viajan en los backups (y a Drive si la carpeta de copias está ahí); a
  cambio, si la PC se rompe se recuperan. La auditoría no guarda el valor. Sin adjuntos por ahora (engordarían las 60 copias).
```

Verificación: `grep -n "Ficha del depto" DECISIONES.md` → 1 línea.

### Paso 2 — Manual de usuario (`manual/manual.html`)

Leer `manual/manual.html` entero antes de editar e imitar sus secciones. Agregar:

1. En la tabla de grupos del menú (la fila `<tr><td><b>MES</b></td>…` y la de `DATOS`, cerca de la línea 147),
   sumar "Vencimientos" a la lista de MES.
2. En la sección de Deptos, un párrafo sobre el botón **Ficha**: qué tiene cada pestaña; que las claves se ven
   con el ojo y se copian con el ícono; que el concepto del servicio es el mismo que se usa al cargar el gasto en
   Movimientos (por eso el vencimiento se marca pagado solo).
3. Una sección corta **Vencimientos**: elegir el mes, "Por pagar" / "Todos", qué significa Pagado / Pendiente /
   Vencido, y que se da por pagado cuando el gasto del depto con ese concepto tiene fecha en el mes.

**No** regenerar capturas ni el PDF en este paso (se hace al final de la tanda: ver la nota de capturas en el
`README` del manual o preguntar). Usar solo datos ficticios.

Verificación: `grep -c "Vencimientos" manual/manual.html` → al menos 3.

### Paso 3 — Test de las rutas en `server/app.test.ts`

`server/ficha.test.ts` cubre la lógica, pero ninguna prueba pasa por las rutas de `server/app.ts`
(`/api/deptos/:id/ficha`, `/api/deptos/:id/notas`, `/api/deptos/:id/ficha/:lista`, `/api/ficha/:lista/:id`,
`/api/vencimientos`). Agregar **un** test en `server/app.test.ts` siguiendo el de
`'cuentas, medios de pago y movimientos por la API'` (buscarlo con `grep -n "por la API" server/app.test.ts` y
copiar cómo levanta la app y hace los pedidos). Debe:

- agregar una clave por POST, leerla con GET `/api/deptos/:id/ficha`, editarla con PUT y borrarla con DELETE;
- pedir `/api/vencimientos?mes=2026-13` y esperar 400 con el mensaje "Mes inválido";
- pedir POST `/api/deptos/:id/ficha/propietario` y esperar 400 ("No existe la lista").

Datos ficticios (depto `OVL`, "Wifi", clave `demo-1`).

Verificación: `node --test server/app.test.ts` → 0 fallas; `npm test` → 0 fallas, `schema OK`.

## Fuera de alcance

- No tocar `server/ficha.ts`, `src/Ficha.tsx`, `src/Vencimientos.tsx` ni el esquema.
- No agregar adjuntos, cifrado, contador en el menú ni tarjeta en Resumen (decididos afuera).

## Parar y avisar

- Si `npm test` falla antes de empezar.
- Si el manual no tiene una sección de Deptos donde colgar el párrafo de Ficha.

## Mantenimiento

- Si se agrega un tipo de movimiento que también sea un pago de servicio (hoy solo `gasto`), revisar la regla
  de pagado en `vencimientos()`.
- Dos servicios con el **mismo concepto** en un depto (por ejemplo, dos medidores de EPE) se marcan pagados con
  un solo gasto. Hoy no pasa; si aparece, la salida es distinguirlos por el `detalle` del movimiento o por la cuenta.
