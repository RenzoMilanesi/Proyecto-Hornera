# Roadmap — Hornera

Versión `1.0.0` = reemplaza al Excel en producción, después de correr 1-2 meses en paralelo.

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Decisiones (`DECISIONES.md`), modelo de datos (`schema.sql`), versionado | A testear |
| 1 | Motor de liquidación con test contra abril 2026 (`server/liquidacion/`) | A testear |
| 2 | Scaffold Electron + React/Vite + Express + SQLite (TS, Ant Design), backups → `0.1.0` | A testear |
| 3 | Importador del Excel (maestros, saldos, movimientos, histórico) | A testear |
| 4 | Sync con Stays: reservas, pagos y medios de pago ("traer mes") | A testear (falta probar contra el Stays real) |
| 5a | Liquidación del mes abierto desde la base (motor), cotización, ajustes de reserva y comparación con el Excel del mes | A testear |
| 5b | Movimientos (reemplaza CORRIENTE) y cuentas: carga, medios de pago → cuenta, saldos | A testear |
| 5c | Cierre y reapertura del mes (snapshot), transferencias (pantalla + Excel) y PDF por depto | A testear |
| 5d | Modo servidor/terminal en la LAN, con emparejamiento | A testear |
| 6 | Resumen: KPIs, resultado Hornera, saldos de cuentas, histórico | A testear |
| — | Instalador de Windows (`npm run dist`) y guía de prueba (`GUIA-PRUEBAS.md`) | A testear |
| — | Fuera de la v1: mails, ARCA, mantenimiento, obligaciones, checklist | — |

Todo lo construido (fases 0 a 6, instalador, y alojamientos, fotos, propietarios, canceladas, horarios y desglose de Stays, tema visual "Ladrillo", buscadores y filtros en todas las pantallas, historial de pagos por depto y propietario, versión `0.14.0`) está **a testear**: tiene tests automáticos y se
probó en la app con datos de prueba, pero falta revisarlo a mano con los dueños y con datos reales.

## Checklist de prueba (próxima sesión)

Cómo probar cada punto, paso a paso: `GUIA-PRUEBAS.md`.

**Instalador**
- [ ] Instalar con `Hornera Setup <versión>.exe` en la PC servidor; queda el acceso directo y abre la app.
- [ ] Instalar una versión nueva encima: los datos (`%APPDATA%\Hornera`) siguen ahí.

**Fase 2 · App y backups**
- [ ] La app instalada abre; abrirla dos veces trae la ventana existente.
- [ ] Al cerrar queda un backup en `%APPDATA%\hornera\backups`; con la app abierta, uno cada 6 h.

**Fase 3 · Importar Excel**
- [ ] Importar `2026-04.xlsx`: 24 liquidaciones, avisos de JAI, SAR y el fondo de CNG.
- [ ] Propietarios y Deptos con los datos de Propiedades; los 5 que liquidan en USD.
- [ ] Importar los meses anteriores cuando lleguen (no deben pisar a abril).

**Fase 4 · Stays** (necesita la contraseña nueva)
- [ ] Cargar usuario y clave; "traer mes" de abril y mayo contra el Stays real.
- [ ] Cotejar reservas y cobros con la hoja RESERVAS; revisar los avisos (comisión MP/PayPal, canales, deptos).
- [ ] Revisar los avisos de alojamientos (activos en Stays y no en la app, y al revés), las direcciones completadas desde Stays, que las fotos se vean en Deptos, los avisos de propietarios (deptos con otro dueño en Stays), y que las canceladas, los horarios y el desglose de precio lleguen bien.

**Fase 5a · Liquidación**
- [ ] Cargar la cotización; revisar saldos y detalle por depto.
- [ ] "Comparar con el Excel del mes" con el mes traído de Stays: las diferencias tienen que tener explicación.
- [ ] Ajustes de reserva (corrección, comisión, excluir) desde Stays y su efecto en la liquidación.

**Fase 5b · Movimientos y cuentas**
- [ ] Cargar gastos del mes como en CORRIENTE; editar y anular.
- [ ] Asociar cada medio de pago de Stays a su cuenta; cargar el saldo inicial de cada cuenta y compararlo con el banco.
- [ ] Transferencia entre cuentas y compra de dólares.

**Fase 5c · Cierre, transferencias y PDF**
- [ ] Cerrar un mes, generar los PDF y compararlos con los que hoy se mandan desde el Excel.
- [ ] Marcar pagado (total y en partes), anular un pago, exportar el Excel de transferencias.
- [ ] Reabrir un mes (sin pagos) y volver a cerrarlo.

**Fase 5d · Terminales** (dos PC en la misma red)
- [ ] En la PC servidor, permitir Hornera en el firewall de Windows (redes privadas) cuando lo pregunte.
- [ ] Instalar en la segunda PC, elegir "Terminal" y conectar con el nombre del servidor (Terminales lo muestra).
- [ ] Emparejar con el código; cargar un movimiento desde la terminal y verlo en el servidor (y en la auditoría con el nombre de la terminal).
- [ ] Revocar la terminal: tiene que volver a pedir el código.
- [ ] Cerrar Hornera en el servidor: la terminal avisa que no puede conectar; al reabrirlo, "Conectar" vuelve a entrar.

**Fase 6 · Resumen**
- [ ] Con abril importado: ocupación, bruto y honorarios por depto iguales a las hojas del Excel.
- [ ] Revisar con los dueños la definición de "Resultado de Hornera" (DECISIONES, "Pendiente").
- [ ] Evolución: los meses del histórico (12/2021 a 10/2024) con sus noches; los meses cerrados con todo.

**Preguntas para los dueños** (`DECISIONES.md`, "Pendiente"): contraseña de Stays, meses del Sheet,
RIO/AND, 4 % de R64, qué plataformas cobran comisión, fee de AND, honorarios en meses sin reservas,
qué es el resultado de Hornera, cómo cargan en Stays las estadías del propietario y los bloqueos.
