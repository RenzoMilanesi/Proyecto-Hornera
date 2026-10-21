# Guía para probar Hornera

Esta guía explica **cómo** probar cada parte de la app. El checklist para tildar lo probado
está en `ROADMAP.md` ("Checklist de prueba"): esta guía sigue el mismo orden.

Todo se prueba **en paralelo con el Excel**: el Excel sigue siendo el que manda hasta la versión
`1.0.0`. Si la app y el Excel no coinciden, anotarlo (ver "Cómo reportar un problema" al final).

---

## 0. Preparación

### Instalar
1. Generar el instalador en la PC de desarrollo: `npm run dist` → `release\Hornera Setup <versión>.exe`.
2. Copiarlo a la PC y ejecutarlo. Windows puede mostrar **"Windows protegió su PC"** porque el
   instalador no está firmado: *Más información → Ejecutar de todas formas*.
3. Elegir la carpeta (la que propone está bien). Queda un acceso directo **Hornera** en el escritorio
   y en el menú Inicio.
4. La primera vez pregunta **¿Qué es esta PC?**:
   - **Servidor**: la PC donde quedan los datos (la de la oficina, la que más está prendida).
   - **Terminal**: una PC que usa los datos del servidor (ver sección 7).
5. Si Windows pregunta por el **firewall**, permitir el acceso en **redes privadas** (lo necesitan las
   terminales; en una sola PC no molesta).

### Dónde quedan los datos
- Base y configuración: `%APPDATA%\Hornera` (pegarlo en la barra del Explorador de archivos).
- Copias de seguridad: `%APPDATA%\Hornera\backups` (al cerrar la app y cada 6 h con la app abierta;
  se guardan las últimas 60).
- PDF de las liquidaciones: `Documentos\Hornera\Liquidaciones\<mes>\`.

### Probar sin miedo: una carpeta de prueba
Para pruebas que ensucian datos (cerrar y reabrir meses, cargar gastos inventados), conviene una
copia aparte que no toque los datos de verdad:
1. Copiar el acceso directo **Hornera** y renombrarlo **Hornera (prueba)**.
2. Clic derecho → *Propiedades* → en **Destino**, agregar al final (después de las comillas):
   ` --user-data-dir=C:\HorneraPrueba`
3. Esa copia usa su propia base en `C:\HorneraPrueba`. Para **empezar de cero**, cerrar la app y
   borrar esa carpeta.

> Las dos no pueden estar abiertas a la vez en la misma PC (usan el mismo puerto): cerrar una antes
> de abrir la otra.

---

## 1. App y copias de seguridad (fase 2)
1. Abrir Hornera. Volver a hacer doble clic en el acceso directo: **no** se abre otra ventana, vuelve
   al frente la que estaba.
2. Cerrar la app y mirar `%APPDATA%\Hornera\backups`: tiene que haber un archivo
   `hornera-<fecha>.db` nuevo.
3. Abajo a la izquierda se ve la versión (p. ej. `v0.8.1`): es la que hay que anotar al reportar.

## 2. Importar el Excel (fase 3)
1. **Importar Excel** → elegir el export del Google Sheet de abril (`2026-04.xlsx`).
2. Tiene que decir **24 liquidaciones** y mostrar avisos de **JAI** y **SAR** (sin facturante, no se
   importan) y del **fondo de CNG** (columna "FONDO / ACUMULADO").
3. **Propietarios**: nombres, deptos, "Liquida en" (5 en USD: S38, COT, R64, MAI, ITU) y si falta el CBU.
4. **Deptos**: código, nombre, propietario, comisión y estado como en la hoja Propiedades.
5. Cuando lleguen los **meses anteriores**, importarlos en cualquier orden: no tienen que cambiar
   nada de abril (propietarios, deptos, saldos).

## 3. Stays (fase 4) — necesita la contraseña nueva de Stays
1. **Stays** → cargar usuario y clave (solo se puede en la PC servidor; la clave queda cifrada en
   esta PC y no vuelve a mostrarse).
2. **Traer mes de Stays** eligiendo **mayo** (abril ya está cerrado por el Excel y no se trae).
3. Cotejar con la hoja **RESERVAS** del Excel de mayo: cantidad de reservas por depto, fechas,
   huéspedes y lo cobrado.
4. Leer los **avisos**: comisión de Mercado Pago / PayPal que falta cargar en Stays, canales o deptos
   que la app no reconoce.
5. Volver a traer el mes: no tiene que duplicar nada ni borrar los ajustes cargados a mano.

## 4. Liquidación del mes abierto (fase 5a)
1. **Liquidación** → mes de mayo → cargar el **dólar cripto al cierre** y *Guardar*.
2. Revisar la tabla: saldo de cada depto y, desplegando la fila, la **cuenta de la liquidación**: ingresos
   operativos − costos = ingreso bruto − honorarios = valor inicial − costos excepcionales = valor final. Valor final
   + saldo anterior (+ "Redondeo" si aparece) tiene que dar el saldo a liquidar, en los que liquidan en pesos.
   Desplegar no tiene que agrandar la tabla a lo ancho.
   - **Ajustar** una reserva y **Agregar** un costo excepcional desde el detalle: la cuenta y el PDF del depto cambian.
   - En un mes cerrado, la cuenta es la guardada al cerrar (la misma del PDF) y no hay botones para corregir.
3. Cuando esté el Excel de mayo: **Comparar con el Excel del mes** → elegir el archivo. Cada depto
   dice "igual al Excel" o cuántas diferencias tiene. **Cada diferencia tiene que tener una
   explicación** (un gasto que falta cargar, una corrección hecha a mano en el Excel, etc.).
4. **Ajustes de reserva** (pantalla Stays, botón **Ajustes** de cada reserva): corrección ARS/USD, comisión, excluir.
   Volver a Liquidación y ver que el saldo del depto cambió lo esperado.

## 5. Movimientos y cuentas (fase 5b)
1. **Cuentas**: crear las cuentas que falten y, en **Medios de pago de Stays**, asociar cada uno a
   su cuenta (p. ej. "Mercado Pago …" → la cuenta de Mercado Pago).
2. **Movimientos**: cargar el **saldo inicial** de cada cuenta (tipo "Saldo inicial", con la cuenta,
   sin depto) con el saldo real del banco a una fecha.
3. Volver a **Cuentas**: el saldo tiene que dar como el banco (saldo inicial + lo cobrado en Stays
   después de esa fecha + los movimientos).
4. **Nuevo movimiento**: cargar los **gastos del mes** como hoy en CORRIENTE (depto o INT, concepto, importe, cuenta).
   Editar uno y anular otro: el anulado no suma pero queda en la lista.
5. **Transferencia entre cuentas** propias y una **compra de dólares** (de una cuenta en pesos a
   una en USD): cada cuenta cambia su saldo.

## 6. Cierre, transferencias y PDF (fase 5c) — mejor en la carpeta de prueba
1. **Liquidación** → **Cerrar mes** (necesita la cotización y el mes anterior cerrado).
2. **PDF de todos los deptos**: se abre la carpeta con un PDF por depto. Compararlos con los que hoy
   salen del Excel: mismos números, mismo orden.
3. **Transferencias**: **Marcar pagado** un depto completo y otro en dos partes; anular un pago.
4. **Exportar a Excel** la lista de transferencias y revisarlo como si se fuera a subir al banco (CBU/CVU).
5. **Reabrir** el mes (antes hay que anular los pagos) y volver a cerrarlo: los números no cambian.

## 7. Terminales (fase 5d) — dos PC en la misma red
1. En el **servidor**: **Terminales** → anotar la dirección (la primera, con el nombre de la PC).
2. En la **otra PC**: instalar, elegir **Terminal**, escribir esa dirección y *Conectar*.
3. Pide un código: en el servidor **Generar código** (dura 10 minutos, sirve una vez) y escribirlo en
   la terminal junto con un nombre (p. ej. "PC de la oficina").
4. Cargar un movimiento desde la terminal y verlo en el servidor (al entrar a la pantalla).
5. En el servidor, **Revocar** la terminal: la terminal tiene que volver a pedir el código.
6. Cerrar Hornera en el servidor: la terminal muestra que no puede conectar. Abrirlo de nuevo y
   tocar *Conectar*: vuelve a entrar.
7. Escribir mal la dirección (p. ej. otro nombre): tiene que volver a la pantalla de conectar con un
   mensaje, no quedarse trabada.

## 8. Resumen (fase 6)
1. **Resumen** (es la primera pantalla) → mes de abril.
2. Por depto: ocupación, bruto y honorarios **iguales a las hojas del Excel** de abril.
3. **Resultado de Hornera**: revisar con Lautaro y Amancay si la cuenta es la correcta
   (honorarios + costos operativos cobrados + ingresos y gastos de la empresa).
4. **Evolución mensual**: los meses de 12/2021 a 10/2024 solo con noches (hoja OCUPACION); los meses
   cerrados con todo.

## 9. Facturación ARCA de los honorarios — primero en homologación, en la carpeta de prueba

Cada emisor (Lautaro, Amancay) factura con **su** CUIT y **su** certificado. Homologación es el ARCA
de prueba: las facturas no valen nada, aunque el CUIT sea real. Producción es la de verdad. Los
certificados de uno no sirven en el otro.

### Antes: el trámite en ARCA (una vez por emisor)
Lo hace cada uno con su clave fiscal; el detalle está en el manual del certificado de Roble
(`docs/manual-certificado-arca.md`). Resumen:
1. **Clave fiscal nivel 3** y un **punto de venta de tipo "Web Services"** (*Administración de puntos de
   venta y domicilios*). No sirve el de "Comprobantes en Línea": es otro, con otra numeración.
2. Generar la **clave privada (.key)** y el pedido (.csr) con openssl, en la PC servidor. El CUIT va
   en el `serialNumber` como `CUIT 20123456789`, sin guiones.
3. Subir el .csr y bajar el **certificado (.crt)**: en homologación desde **WSASS**; en producción desde
   *Administración de Certificados Digitales*.
4. **Autorizar el servicio "Facturación Electrónica" (wsfe)** al certificado (*Administrador de
   Relaciones* → Nueva relación). Si falta, "Probar" dice *Computador no autorizado a acceder al
   servicio*: casi nunca es el certificado, es esta autorización. Para "Consultar ARCA" en los datos
   fiscales del propietario, autorizar también `ws_sr_constancia_inscripcion` (solo producción).

> La .key es como la clave fiscal: quien la tiene factura a nombre de ese CUIT. No mandarla por mail ni
> dejar copias en pendrives; una vez cargada en Hornera, borrar las copias sueltas.

### Prueba en homologación
1. **Datos → Emisores → Nuevo emisor**: nombre, CUIT, razón social, condición (monotributista),
   **domicilio** (la factura lo imprime; la RG 1415 lo pide), punto de venta Web Services y ambiente
   **Homologación**.
2. **Certificado** (en la PC servidor): elegir el .crt y el .key. Tienen que rechazarse un certificado de
   otro CUIT y una clave que no es la de ese certificado.
3. **Probar**: tiene que decir *ARCA respondió bien … último comprobante autorizado Factura C n.º X*
   (0 si nunca se facturó por Web Services). En homologación los números pueden venir altos: el punto
   de venta de prueba es compartido.
4. **Datos → Propietarios → Datos fiscales** de un propietario: razón social, CUIT o DNI, condición IVA y
   domicilio. Sin esos datos no se puede facturar. ("Consultar ARCA" en homologación responde que es
   solo de producción.)
5. **Transferencias** de un mes cerrado → **Marcar pagado** un depto de ese propietario. Se abre
   **Facturar este pago**: emisor, importe propuesto (los honorarios del depto; la parte proporcional si
   el pago es parcial) → **Emitir**. La fila del pago muestra **prueba n.º 0003-…** (en homologación) y el
   botón **PDF**.
6. **PDF**: datos del emisor y del propietario, "FACTURA C", período del servicio (el mes liquidado),
   CAE, vencimiento y el **QR**. Escanear el QR con el celular: abre la página de ARCA con los datos del
   comprobante.
7. Pagar otro depto en **dos partes**: cada pago propone su proporción. Facturar de más avisa pero deja.
8. **Anular** un pago facturado: queda marcado y aparece **Emitir nota de crédito**. Emitirla: NC C con
   la factura asociada; la marca desaparece.
9. Sin internet (desenchufar el cable o cortar el Wi-Fi) → Marcar pagado y Emitir: el pago queda
   registrado, la factura **rechazada** con el motivo y el botón **Reintentar**. Volver a conectar y
   reintentar.
10. **PDF de la liquidación** del depto: suma una página por factura; las de homologación salen marcadas
    "sin validez fiscal".
11. **Lo facturado por fuera** (Comprobantes en Línea): en ARCA, *Mis Comprobantes → Emitidos* → exportar a
    CSV. En Hornera, **Mes → Comprobantes → En ARCA → Importar de ARCA**, elegir el emisor y el archivo. Una
    factura a un propietario aparece "propietario, sin vincular"; al facturar un pago de ese propietario,
    "Facturar este pago" la muestra: **Es esta** la vincula (el pago queda "por fuera n.º …") y **No es
    ninguna de estas** deja emitir igual. Importar el archivo de otro emisor tiene que rechazarse.

### Antes de la primera factura real (producción)
1. Repetir el trámite con el certificado **de producción** y el punto de venta Web Services real.
2. En Emisores, **Editar** → ambiente **Producción** (borra el certificado de homologación) → **Certificado**
   con el .crt y .key de producción.
3. **Probar** antes de emitir nada: es solo lectura y no gasta números. Si responde un número (aunque
   sea 0), certificado, autorización y punto de venta están bien.
4. **Consultar ARCA** en los datos fiscales de un propietario con CUIT: completa razón social, condición y
   domicilio (revisarlos y guardar).
5. Primera factura real: un pago chico de un propietario de confianza. Revisar el PDF, escanear el QR y
   verla en *Mis Comprobantes* de ARCA.
6. Anotar la **fecha de vencimiento** del certificado (2 años; Emisores avisa 30 días antes). Para
   renovarlo, en ARCA usar **"Actualizar"** sobre el mismo alias: así no hay que volver a autorizar wsfe.

---

## Cómo reportar un problema
Anotar para cada cosa rara:
- **Versión** (abajo a la izquierda) y **pantalla**.
- **Qué se hizo** (pasos), **qué se esperaba** y **qué pasó**.
- Si es una diferencia con el Excel: depto, mes, campo y los dos valores.
- Una captura ayuda. **No mandarla por canales públicos**: muestra datos de propietarios y montos.

Si algo sale muy mal, los datos se recuperan de `%APPDATA%\Hornera\backups`: con la app cerrada,
copiar el backup que corresponda sobre `%APPDATA%\Hornera\hornera.db` (guardar antes una copia de
ese archivo) y borrar `hornera.db-wal` y `hornera.db-shm` si están.
