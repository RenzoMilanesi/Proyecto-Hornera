-- ============================================================
--  HORNERA — Liquidación mensual a propietarios
--  Esquema físico (DDL) v1 — SQLite 3.37+ (tablas STRICT)
-- ============================================================
--  Convenciones (las de Roble):
--   - snake_case, singular, sin acentos. PK `id INTEGER PRIMARY KEY`.
--   - FK `<entidad>_id` con ON DELETE explícito e índice propio.
--   - Importes: INTEGER en CENTAVOS con signo (+ ingreso / − egreso).
--     Cada importe tiene dos columnas: `_ars` y `_usd`, como en el Excel.
--   - Tasas y cotizaciones: REAL (no son plata; el resultado se redondea a centavos).
--   - Fechas: TEXT ISO 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS'.
--   - Booleanos 0/1 con CHECK. Enumerados TEXT con CHECK IN.
--   - Catálogos: baja lógica `activo = 0`. Transaccionales: `estado = 'anulado'`.
--   - Saldos de cuentas y de deptos con período abierto: vistas v_*.
--     Excepción deliberada: la liquidación de un período CERRADO se guarda
--     como snapshot (decisión "mes congelado"), igual que Roble guarda el
--     precio histórico en una venta.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
--  CATÁLOGOS
-- ------------------------------------------------------------

-- Hoja Propiedades, columnas E, N, O, P, Q. Una misma persona puede tener
-- varios deptos (en abril 2026: OVL y BAL; GUE, ALV y ESP; CAF, RIO y MAPU).
CREATE TABLE propietario (
    id                 INTEGER PRIMARY KEY,
    nombre             TEXT    NOT NULL,          -- "Pérez, Ana / Gómez, Luis" (ejemplo ficticio)
    documento          TEXT,                       -- texto libre: hoy viene "DNI N°11.111.111 / ..."
    cuit               TEXT,
    categoria_fiscal   TEXT    CHECK (categoria_fiscal IN ('RM','RI','CF','EX','NI')),  -- NI = "No inf."
    cbu                TEXT,                       -- CBU/CVU; NULL = no informado
    es_hornera         INTEGER NOT NULL DEFAULT 0 CHECK (es_hornera IN (0,1)),  -- SFE: CBU "Nosotros"
    mails              TEXT,                       -- separados por ';' (como en el Excel)
    -- Moneda en la que cierra el saldo (fila "Cambio moneda"). ARS: el USD se
    -- pasa a ARS (la mayoría). USD: el ARS se pasa a USD (S38, COT, R64, MAI
    -- e ITU en abril 2026), a cambio / (1 − comision_cobro_usd_pct);
    -- R64 usa 0,04 (¿Payoneer?).
    moneda_liquidacion     TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda_liquidacion IN ('ARS','USD')),
    comision_cobro_usd_pct REAL NOT NULL DEFAULT 0 CHECK (comision_cobro_usd_pct >= 0 AND comision_cobro_usd_pct < 1),
    activo             INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    -- Datos para facturarle (receptor ante ARCA). Aparte de cuit/documento/categoria_fiscal,
    -- que vienen del Excel en texto libre: sin estos completos no se factura.
    fiscal_razon_social  TEXT,
    fiscal_doc_tipo      INTEGER CHECK (fiscal_doc_tipo IN (80, 96)),   -- 80 CUIT, 96 DNI
    fiscal_doc_nro       TEXT,
    fiscal_condicion_iva TEXT CHECK (fiscal_condicion_iva IN ('responsable_inscripto','monotributista','exento','consumidor_final')),
    fiscal_domicilio     TEXT,
    stays_owner_id     TEXT                        -- _id en /finance/owners; lo vincula "traer mes"
) STRICT;
CREATE UNIQUE INDEX uq_propietario_stays ON propietario(stays_owner_id);

-- Hoja Propiedades. Los códigos especiales HOR / INT / CAN / PRUE NO son deptos:
-- INT pasa a ser movimiento.depto_id = NULL (gasto de la empresa).
CREATE TABLE depto (
    id                        INTEGER PRIMARY KEY,
    codigo                    TEXT    NOT NULL,   -- OVL, BAL, ... (= "Nombre interno del alojamiento" en Stays)
    nombre                    TEXT    NOT NULL,   -- Hornera Lagos
    direccion                 TEXT,
    tipologia                 TEXT    CHECK (tipologia IN ('monoambiente','1 dormitorio','2 dormitorios','3 dormitorios')),
    estado                    TEXT    NOT NULL DEFAULT 'activo'
                              CHECK (estado IN ('potencial','proximo','activo','pausado','finalizado')),
    propietario_id            INTEGER NOT NULL,
    comision_pct              REAL    NOT NULL DEFAULT 0.20 CHECK (comision_pct BETWEEN 0 AND 1),
    tipo_administracion       TEXT    NOT NULL DEFAULT 'integral',
    horas_limpieza_prom       REAL,               -- informativo (col. J)
    -- Overrides de tarifa: NULL = usar el parámetro global del período.
    tarifa_base_override      INTEGER,            -- centavos ARS por reserva
    adicional_huesped_override INTEGER,           -- centavos ARS por par de huéspedes extra
    cm_fee_usd_override       INTEGER,            -- centavos USD por mes (conexión channel manager)
    -- Identificadores externos
    stays_listing_id          TEXT,               -- "ID interno del anuncio" en Stays
    id_alquiler_argentina     TEXT,
    id_booking                TEXT,
    id_alohar                 TEXT,
    fotos                     TEXT    CHECK (fotos IS NULL OR json_valid(fotos)),  -- JSON: URLs de Stays, la principal primero
    notas                     TEXT,               -- ficha: cómo entrar, medidores, mañas del depto
    CONSTRAINT uq_depto_codigo UNIQUE (codigo),
    CONSTRAINT fk_depto_propietario FOREIGN KEY (propietario_id)
        REFERENCES propietario(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_depto_propietario ON depto(propietario_id);

-- Ficha del depto (plan 049): servicios e impuestos con su vencimiento, claves y contactos.
-- Un vencimiento de un servicio que paga Hornera se da por pagado con un gasto vigente del
-- depto con ese concepto y fecha en el mes (server/ficha.ts).
CREATE TABLE depto_servicio (
    id           INTEGER PRIMARY KEY,
    depto_id     INTEGER NOT NULL,
    concepto_id  INTEGER NOT NULL,                -- EPE, API, TGI, Expensas...
    cuenta       TEXT,                            -- N° de cuenta, partida o cliente
    titular      TEXT,
    paga         TEXT    NOT NULL DEFAULT 'hornera' CHECK (paga IN ('hornera','propietario')),
    -- Vence el día `dia` cada `cada_meses` meses, contando desde el mes `mes_desde` (1-12). NULL = sin vencimiento.
    dia          INTEGER CHECK (dia BETWEEN 1 AND 31),
    cada_meses   INTEGER CHECK (cada_meses IN (1,2,3,4,6,12)),
    mes_desde    INTEGER CHECK (mes_desde BETWEEN 1 AND 12),
    nota         TEXT,
    CONSTRAINT ck_servicio_vence CHECK ((dia IS NULL) = (cada_meses IS NULL) AND (dia IS NULL) = (mes_desde IS NULL)),
    CONSTRAINT fk_servicio_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_servicio_concepto FOREIGN KEY (concepto_id) REFERENCES concepto(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_servicio_depto ON depto_servicio(depto_id);
CREATE INDEX ix_servicio_concepto ON depto_servicio(concepto_id);

-- Wifi, alarma, caja de llaves... En claro (decisión 2026-10-22): viajan en los backups; la auditoría no guarda la clave.
CREATE TABLE depto_clave (
    id        INTEGER PRIMARY KEY,
    depto_id  INTEGER NOT NULL,
    nombre    TEXT    NOT NULL,                   -- "Wifi 5G"
    usuario   TEXT,                               -- usuario o nombre de la red
    clave     TEXT,
    nota      TEXT,
    CONSTRAINT fk_clave_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE CASCADE ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_clave_depto ON depto_clave(depto_id);

CREATE TABLE depto_contacto (
    id        INTEGER PRIMARY KEY,
    depto_id  INTEGER NOT NULL,
    nombre    TEXT    NOT NULL,
    rol       TEXT,                               -- portero, administración, plomero...
    telefono  TEXT,
    nota      TEXT,
    CONSTRAINT fk_contacto_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE CASCADE ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_contacto_depto ON depto_contacto(depto_id);

-- Hoja Plataformas. `nombre_stays` es el texto de la columna "Canal" de Stays.
CREATE TABLE plataforma (
    id               INTEGER PRIMARY KEY,
    nombre_stays     TEXT    NOT NULL,            -- "API airbnb"
    nombre           TEXT    NOT NULL,            -- "Airbnb"
    codigo           TEXT    NOT NULL,            -- A, B, D, Q, V, G, T, P, W, H
    gestiona_pago    INTEGER NOT NULL CHECK (gestiona_pago IN (0,1)),
    comision_pct     REAL    NOT NULL DEFAULT 0 CHECK (comision_pct BETWEEN 0 AND 1),
    activo           INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    CONSTRAINT uq_plataforma_nombre_stays UNIQUE (nombre_stays)
) STRICT;

-- Deptos donde una plataforma le paga directo al propietario (co-host Airbnb:
-- ALV, GUE, R64, AND). Reemplaza la lista fija de 3-Union_Reservas_Cuentas.PY.
CREATE TABLE depto_pago_directo (
    depto_id         INTEGER NOT NULL,
    plataforma_id    INTEGER NOT NULL,
    CONSTRAINT pk_depto_pago_directo PRIMARY KEY (depto_id, plataforma_id),
    CONSTRAINT fk_dpd_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dpd_plataforma FOREIGN KEY (plataforma_id) REFERENCES plataforma(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_dpd_plataforma ON depto_pago_directo(plataforma_id);

-- Cuentas de la empresa (Listas col. B): Galicia A, Mercadopago L, Efectivo USD...
CREATE TABLE cuenta (
    id          INTEGER PRIMARY KEY,
    nombre      TEXT    NOT NULL,
    moneda      TEXT    NOT NULL CHECK (moneda IN ('ARS','USD')),
    activo      INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    CONSTRAINT uq_cuenta_nombre UNIQUE (nombre)
) STRICT;

-- Medios de pago de Stays (/finance/payment-providers) mapeados a una cuenta.
CREATE TABLE medio_pago (
    id                 INTEGER PRIMARY KEY,
    stays_id           TEXT    NOT NULL,          -- _id
    nombre             TEXT    NOT NULL,          -- internalName ("Mercado Pago Lau")
    tipo_stays         TEXT    NOT NULL,          -- type (mercadopago, paypal, user...)
    moneda             TEXT    NOT NULL CHECK (moneda IN ('ARS','USD')),
    descuenta_comision INTEGER NOT NULL DEFAULT 0 CHECK (descuenta_comision IN (0,1)),  -- MP y PayPal: neto = val − tax
    cuenta_id          INTEGER,                   -- NULL = sin mapear (la sync lo avisa)
    activo             INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    CONSTRAINT uq_medio_pago_stays UNIQUE (stays_id),
    CONSTRAINT fk_medio_pago_cuenta FOREIGN KEY (cuenta_id) REFERENCES cuenta(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_medio_pago_cuenta ON medio_pago(cuenta_id);

-- Conceptos de movimiento (Listas col. C y A). `grupo` = rubro contable de la empresa.
CREATE TABLE concepto (
    id          INTEGER PRIMARY KEY,
    nombre      TEXT    NOT NULL,                 -- EPE, Expensas, Cerrajería, Viáticos...
    grupo       TEXT,                             -- Gastos Administración, Honorarios, Impuestos...
    activo      INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    CONSTRAINT uq_concepto_nombre UNIQUE (nombre)
) STRICT;

-- ------------------------------------------------------------
--  PERÍODO (hoja Datos balance)
-- ------------------------------------------------------------

CREATE TABLE periodo (
    id                       INTEGER PRIMARY KEY,
    mes                      TEXT    NOT NULL CHECK (mes GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),  -- '2026-04'
    fecha_inicio             TEXT    NOT NULL,    -- 2026-04-01
    fecha_cierre_reservas    TEXT    NOT NULL,    -- 2026-05-01 (exclusivo, prorrateo de noches)
    fecha_corte_gastos       TEXT    NOT NULL,
    fecha_pago               TEXT    NOT NULL,
    -- Tipo de cambio: dólar cripto (automático) con override manual.
    usd_cotizacion           REAL,                -- 1490
    usd_cotizacion_fuente    TEXT    CHECK (usd_cotizacion_fuente IN ('api','manual')),
    -- Día del valor de la API; antes del cierre del período = provisoria. NULL si es manual.
    usd_cotizacion_fecha     TEXT    CHECK (usd_cotizacion_fecha IS NULL OR date(usd_cotizacion_fecha) IS usd_cotizacion_fecha),
    usd_cotizacion_provisoria INTEGER NOT NULL DEFAULT 0 CHECK (usd_cotizacion_provisoria IN (0,1)), -- 1 = la de un momento, no la del cierre
    usd_descuento_pct        REAL    NOT NULL DEFAULT 0.06,
    -- Parámetros de tarifa (centavos ARS). La UI los propone desde costo_hora_limpieza.
    costo_hora_limpieza      INTEGER NOT NULL,    -- B13 "Costo hora Vale"
    servicio_limpieza        INTEGER NOT NULL,    -- B8 = B13 × 1,4
    servicio_lavanderia      INTEGER NOT NULL,    -- B9
    prestamo_blanqueria      INTEGER NOT NULL,    -- B10
    gestion_operativa        INTEGER NOT NULL,    -- B11
    mantenimiento            INTEGER NOT NULL,    -- B12
    tarifa_base              INTEGER NOT NULL,    -- B15 = 2·limp + 2·lav + 2·gest + mant
    adicional_huesped        INTEGER NOT NULL,    -- B16, por cada par de huéspedes extra
    noches_tramo_1           INTEGER NOT NULL DEFAULT 10,   -- A17
    cargo_tramo_1            INTEGER NOT NULL,              -- B17
    noches_tramo_2           INTEGER NOT NULL DEFAULT 28,   -- A18
    cargo_tramo_2            INTEGER NOT NULL,              -- B18
    cm_fee_usd               INTEGER NOT NULL,    -- centavos USD por depto/mes
    estado                   TEXT    NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
    cerrado_en               TEXT,
    CONSTRAINT uq_periodo_mes UNIQUE (mes),
    CONSTRAINT ck_periodo_fechas CHECK (fecha_inicio < fecha_cierre_reservas)
) STRICT;

-- ------------------------------------------------------------
--  DATOS DE STAYS (se pisan al re-sincronizar; los campos ajuste_* no)
-- ------------------------------------------------------------

CREATE TABLE reserva (
    id                          INTEGER PRIMARY KEY,
    codigo                      TEXT    NOT NULL,   -- "Reserva" en Stays (PI08J)
    stays_id                    TEXT,               -- _idreserve de los pagos
    depto_id                    INTEGER NOT NULL,
    plataforma_id               INTEGER,            -- NULL = "Carga Agente" sin canal
    codigo_ota                  TEXT,
    llegada                     TEXT    NOT NULL,
    salida                      TEXT    NOT NULL,
    huespedes                   INTEGER NOT NULL DEFAULT 1,
    estado_stays                TEXT,               -- "Estatus de reserva"
    moneda                      TEXT    NOT NULL CHECK (moneda IN ('ARS','USD')),
    total_factura               INTEGER,            -- "Total de factura de hospedaje" (centavos en `moneda`)
    forward_fee_all             INTEGER,            -- "Total Forward Fee All" (Adelanto Tarifario)
    precio_compra               INTEGER,            -- "Precio de compra" = cobro directo propietario
    tasa_propietario_airbnb     INTEGER,            -- "Tasa del propietario: API airbnb"
    cargo_limpieza              INTEGER,            -- "Cargos: Tasa de Limpieza"
    tasa_propietario_limpieza   INTEGER,
    huesped_nombre              TEXT,
    huesped_doc_tipo            TEXT    CHECK (huesped_doc_tipo IN ('DNI','Pasaporte','Otro')),
    huesped_doc_numero          TEXT,
    raw_json                    TEXT    NOT NULL,   -- fila completa de Stays, para no perder columnas
    sincronizada_en             TEXT    NOT NULL,
    -- Ajustes manuales (pestañas 🖊 del Excel). La sync NO los toca.
    ajuste_ars                  INTEGER NOT NULL DEFAULT 0,  -- "Corrección pago ARS"
    ajuste_usd                  INTEGER NOT NULL DEFAULT 0,
    ajuste_comision_ars         INTEGER NOT NULL DEFAULT 0,  -- corrige la comisión OTA calculada
    ajuste_comision_usd         INTEGER NOT NULL DEFAULT 0,
    observacion                 TEXT,
    excluida                    INTEGER NOT NULL DEFAULT 0 CHECK (excluida IN (0,1)),  -- sacar de la liquidación sin borrar
    -- Cancelada en Stays: se ve en la lista pero no liquida ni trae pagos. La pone la sync.
    cancelada                   INTEGER NOT NULL DEFAULT 0 CHECK (cancelada IN (0,1)),
    -- Del detalle de la reserva en Stays; informativos (la liquidación usa las columnas de arriba).
    hora_llegada                TEXT,               -- checkInTime "14:00"
    hora_salida                 TEXT,               -- checkOutTime "10:00"
    desglose_json               TEXT    CHECK (desglose_json IS NULL OR json_valid(desglose_json)),  -- price de Stays
    CONSTRAINT uq_reserva_codigo UNIQUE (codigo),
    CONSTRAINT ck_reserva_fechas CHECK (llegada <= salida),
    CONSTRAINT fk_reserva_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_reserva_plataforma FOREIGN KEY (plataforma_id) REFERENCES plataforma(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_reserva_depto ON reserva(depto_id);
CREATE INDEX ix_reserva_plataforma ON reserva(plataforma_id);
CREATE INDEX ix_reserva_fechas ON reserva(llegada, salida);

-- Pagos de Stays (/booking/reservations/{id}/payments).
CREATE TABLE pago (
    id               INTEGER PRIMARY KEY,
    stays_id         TEXT    NOT NULL,           -- _id
    reserva_id       INTEGER NOT NULL,
    -- NOT NULL: la sync da de alta el medio si no existe (consultando
    -- /finance/payment-providers sin filtrar por activos), así nunca falta la moneda.
    medio_pago_id    INTEGER NOT NULL,
    tipo             TEXT    NOT NULL CHECK (tipo IN ('credit','debit')),
    estado           TEXT    NOT NULL,           -- completed / pending / ...
    descripcion      TEXT,                       -- name ("res. fee API airbnb")
    importe          INTEGER NOT NULL,           -- _f_val, centavos en la moneda del medio
    comision         INTEGER,                    -- _f_tax; NULL en MP/PayPal = falta cargar ("ADD MP TAX")
    fecha_pago       TEXT,
    raw_json         TEXT    NOT NULL,
    CONSTRAINT uq_pago_stays UNIQUE (stays_id),
    CONSTRAINT fk_pago_reserva FOREIGN KEY (reserva_id) REFERENCES reserva(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_pago_medio FOREIGN KEY (medio_pago_id) REFERENCES medio_pago(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_pago_reserva ON pago(reserva_id);
CREATE INDEX ix_pago_medio ON pago(medio_pago_id);

CREATE TABLE sincronizacion (
    id            INTEGER PRIMARY KEY,
    periodo_id    INTEGER NOT NULL,
    iniciada_en   TEXT    NOT NULL,
    terminada_en  TEXT,
    resultado     TEXT    CHECK (resultado IN ('ok','con_avisos','error')),
    reservas      INTEGER,
    pagos         INTEGER,
    avisos_json   TEXT,                          -- medios sin mapear, comisiones faltantes, deptos desconocidos
    CONSTRAINT fk_sync_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE CASCADE ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_sync_periodo ON sincronizacion(periodo_id);

-- Noches en que el depto no se alquila (B24 "No disponible" de la hoja por
-- depto, "Noches no disp" del Checklist). `hasta` es exclusivo, como `salida`.
CREATE TABLE bloqueo (
    id          INTEGER PRIMARY KEY,
    depto_id    INTEGER NOT NULL,
    desde       TEXT    NOT NULL,
    hasta       TEXT    NOT NULL,
    motivo      TEXT,
    estado      TEXT    NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulado')),
    CONSTRAINT ck_bloqueo_fechas CHECK (desde < hasta),
    CONSTRAINT fk_bloqueo_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_bloqueo_depto ON bloqueo(depto_id, desde);

-- ------------------------------------------------------------
--  MOVIMIENTOS (reemplaza CORRIENTE y Cont Interna)
-- ------------------------------------------------------------
-- Un movimiento se imputa a un depto (o a la empresa si depto_id es NULL)
-- y, si mueve plata real, a una cuenta. Las transferencias entre cuentas
-- son dos movimientos con el mismo `transferencia_grupo`.

CREATE TABLE movimiento (
    id                   INTEGER PRIMARY KEY,
    periodo_id           INTEGER NOT NULL,       -- período de liquidación al que se imputa
    fecha                TEXT    NOT NULL,
    depto_id             INTEGER,                -- NULL = empresa (código INT del Excel)
    tipo                 TEXT    NOT NULL CHECK (tipo IN (
                            'gasto',               -- EPE, expensas, ferretería...
                            'ingreso',             -- otros ingresos del depto/empresa
                            'pre_liquidacion',     -- adelanto al propietario
                            'liquidacion',         -- pago del saldo (lo genera "marcar pagado")
                            'pago_directo',        -- cobro directo del propietario por plataforma
                            'saldo_inicial',       -- arrastre al migrar
                            'transferencia',       -- entre cuentas propias
                            'ajuste')),
    concepto_id          INTEGER,
    detalle              TEXT,
    importe_ars          INTEGER NOT NULL DEFAULT 0,
    importe_usd          INTEGER NOT NULL DEFAULT 0,
    cuenta_id            INTEGER,                -- NULL = no mueve caja (ej. pago directo, saldo inicial de depto)
    transferencia_grupo  INTEGER,
    estado               TEXT    NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulado')),
    creado_en            TEXT    NOT NULL,
    origen               TEXT,                   -- fila de un Excel importado (gastos varios): no se vuelve a importar
    CONSTRAINT ck_mov_importe CHECK (importe_ars <> 0 OR importe_usd <> 0),
    CONSTRAINT fk_mov_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_mov_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_mov_concepto FOREIGN KEY (concepto_id) REFERENCES concepto(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_mov_cuenta FOREIGN KEY (cuenta_id) REFERENCES cuenta(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_mov_periodo ON movimiento(periodo_id);
CREATE INDEX ix_mov_depto ON movimiento(depto_id);
CREATE INDEX ix_mov_concepto ON movimiento(concepto_id);
CREATE INDEX ix_mov_cuenta ON movimiento(cuenta_id);
CREATE UNIQUE INDEX uq_mov_origen ON movimiento(origen) WHERE origen IS NOT NULL;

-- Gastos del Excel de gastos varios que no son de Hornera (plan 047): personales de Amancay (CAY) y Lautaro (LAU),
-- compartidos (CAY/LAU), de la Casa del Estudiante (CASEST) y de la casa (CASA). No entran en liquidaciones,
-- cuentas ni en el resultado: por eso van aparte de movimiento.
CREATE TABLE gasto_ajeno (
    id          INTEGER PRIMARY KEY,
    periodo_id  INTEGER NOT NULL,
    fecha       TEXT    NOT NULL CHECK (date(fecha) IS fecha),
    codigo      TEXT    NOT NULL CHECK (codigo IN ('CAY','LAU','CAY/LAU','CASEST','CASA')),
    descripcion TEXT,
    importe     INTEGER NOT NULL CHECK (importe > 0),   -- centavos: lo que se gastó
    estado      TEXT    NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulado')),
    origen      TEXT    UNIQUE,                         -- fila del Excel (como movimiento.origen), NULL = cargado a mano
    creado_en   TEXT    NOT NULL,
    CONSTRAINT fk_ajeno_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_ajeno_periodo ON gasto_ajeno(periodo_id);
CREATE TRIGGER tr_ajeno_periodo_cerrado_upd BEFORE UPDATE ON gasto_ajeno
WHEN (SELECT estado FROM periodo WHERE id = OLD.periodo_id) = 'cerrado'
  OR (SELECT estado FROM periodo WHERE id = NEW.periodo_id) = 'cerrado'
BEGIN
    SELECT RAISE(ABORT, 'periodo cerrado: reabrirlo para modificar gastos ajenos');
END;

-- Limpieza (plan 057): tareas importadas del Google Form "Horas Cargadas" y lo liquidado a la coordinadora.
-- Control interno de la empresa: no tocan las liquidaciones de los deptos.
CREATE TABLE tarea_limpieza (
    id           INTEGER PRIMARY KEY,
    fecha        TEXT    NOT NULL CHECK (date(fecha) IS fecha),
    depto_id     INTEGER REFERENCES depto(id) ON DELETE RESTRICT ON UPDATE CASCADE,  -- NULL = empresa (INT)
    operaria     TEXT    NOT NULL CHECK (operaria <> ''),
    tipo         TEXT    NOT NULL,                      -- Limpieza, Check-In, Check-Out, Cambio Blanqueria, Oficina...
    minutos      INTEGER NOT NULL CHECK (minutos >= 0), -- duración cargada, sin el plus
    fila_excel   INTEGER
) STRICT;
CREATE INDEX ix_tarea_limpieza_fecha ON tarea_limpieza(fecha);

-- Período liquidado: fechas libres, sin pisarse. Las reglas del plus se copian al crearlo.
CREATE TABLE liquidacion_limpieza (
    id             INTEGER PRIMARY KEY,
    desde          TEXT    NOT NULL CHECK (date(desde) IS desde),
    hasta          TEXT    NOT NULL CHECK (date(hasta) IS hasta AND hasta >= desde),
    precio_hora    INTEGER NOT NULL CHECK (precio_hora > 0),        -- centavos
    plus_json      TEXT    NOT NULL CHECK (json_valid(plus_json)),  -- {"Check-Out":{"modo":"horas","valor":30},...}
    ajuste         INTEGER NOT NULL DEFAULT 0,                      -- centavos, con signo: suma al total, no a las chicas
    ajuste_nota    TEXT,
    movimiento_id  INTEGER REFERENCES movimiento(id) ON DELETE SET NULL ON UPDATE CASCADE, -- el pago (NULL = pendiente)
    creado_en      TEXT    NOT NULL
) STRICT;
CREATE INDEX ix_liq_limpieza_mov ON liquidacion_limpieza(movimiento_id);
CREATE TRIGGER tr_liq_limpieza_pisa_ins BEFORE INSERT ON liquidacion_limpieza
WHEN EXISTS (SELECT 1 FROM liquidacion_limpieza WHERE desde <= NEW.hasta AND hasta >= NEW.desde)
BEGIN
    SELECT RAISE(ABORT, 'el periodo se pisa con otro');
END;
CREATE TRIGGER tr_liq_limpieza_pisa_upd BEFORE UPDATE OF desde, hasta ON liquidacion_limpieza
WHEN EXISTS (SELECT 1 FROM liquidacion_limpieza WHERE id <> NEW.id AND desde <= NEW.hasta AND hasta >= NEW.desde)
BEGIN
    SELECT RAISE(ABORT, 'el periodo se pisa con otro');
END;

-- Foto por chica al pagar: lo pagado no cambia aunque después se reimporte el Excel.
CREATE TABLE liquidacion_limpieza_operaria (
    liquidacion_limpieza_id INTEGER NOT NULL REFERENCES liquidacion_limpieza(id) ON DELETE CASCADE ON UPDATE CASCADE,
    operaria   TEXT    NOT NULL,
    tareas     INTEGER NOT NULL,
    minutos    INTEGER NOT NULL,   -- duración + plus en horas
    importe    INTEGER NOT NULL,   -- centavos
    PRIMARY KEY (liquidacion_limpieza_id, operaria)
) STRICT, WITHOUT ROWID;

-- Anular el pago deja la liquidación pendiente otra vez (como tr_mov_anulado_libera_liq).
CREATE TRIGGER tr_mov_anulado_libera_liq_limpieza AFTER UPDATE OF estado ON movimiento
WHEN NEW.estado = 'anulado'
BEGIN
    DELETE FROM liquidacion_limpieza_operaria
     WHERE liquidacion_limpieza_id IN (SELECT id FROM liquidacion_limpieza WHERE movimiento_id = NEW.id);
    UPDATE liquidacion_limpieza SET movimiento_id = NULL WHERE movimiento_id = NEW.id;
END;

-- Período cerrado = congelado. Única excepción: tipo 'liquidacion', porque el
-- pago al propietario se hace después del cierre (fecha_pago) y se imputa al
-- período que liquida. El saldo_anterior del mes siguiente es entonces
-- liquidacion.saldo_final_ars/_usd + los movimientos 'liquidacion' de ese período.
CREATE TRIGGER tr_mov_periodo_cerrado_ins BEFORE INSERT ON movimiento
WHEN NEW.tipo <> 'liquidacion'
 AND (SELECT estado FROM periodo WHERE id = NEW.periodo_id) = 'cerrado'
BEGIN
    SELECT RAISE(ABORT, 'periodo cerrado: reabrirlo para cargar movimientos');
END;

CREATE TRIGGER tr_mov_periodo_cerrado_upd BEFORE UPDATE ON movimiento
WHEN (OLD.tipo <> 'liquidacion' AND (SELECT estado FROM periodo WHERE id = OLD.periodo_id) = 'cerrado')
  OR (NEW.tipo <> 'liquidacion' AND (SELECT estado FROM periodo WHERE id = NEW.periodo_id) = 'cerrado')
BEGIN
    SELECT RAISE(ABORT, 'periodo cerrado: reabrirlo para modificar movimientos');
END;

CREATE TRIGGER tr_mov_periodo_cerrado_del BEFORE DELETE ON movimiento
WHEN (SELECT estado FROM periodo WHERE id = OLD.periodo_id) = 'cerrado'
BEGIN
    SELECT RAISE(ABORT, 'periodo cerrado: los movimientos no se borran');
END;

-- Un movimiento con cuenta solo puede tener importe en la moneda de esa cuenta
-- (si no, v_saldo_cuenta lo ignoraría). Compra/venta de USD = 'transferencia'
-- en dos movimientos: uno sale de la cuenta ARS y otro entra a la cuenta USD.
CREATE TRIGGER tr_mov_moneda_cuenta_ins BEFORE INSERT ON movimiento
WHEN NEW.cuenta_id IS NOT NULL AND (
     ((SELECT moneda FROM cuenta WHERE id = NEW.cuenta_id) = 'ARS' AND NEW.importe_usd <> 0)
  OR ((SELECT moneda FROM cuenta WHERE id = NEW.cuenta_id) = 'USD' AND NEW.importe_ars <> 0))
BEGIN
    SELECT RAISE(ABORT, 'el importe no coincide con la moneda de la cuenta');
END;

CREATE TRIGGER tr_mov_moneda_cuenta_upd BEFORE UPDATE ON movimiento
WHEN NEW.cuenta_id IS NOT NULL AND (
     ((SELECT moneda FROM cuenta WHERE id = NEW.cuenta_id) = 'ARS' AND NEW.importe_usd <> 0)
  OR ((SELECT moneda FROM cuenta WHERE id = NEW.cuenta_id) = 'USD' AND NEW.importe_ars <> 0))
BEGIN
    SELECT RAISE(ABORT, 'el importe no coincide con la moneda de la cuenta');
END;

-- ------------------------------------------------------------
--  LIQUIDACIÓN (snapshot al cerrar el período)
-- ------------------------------------------------------------
-- Con el período abierto, la liquidación se calcula en memoria (servicio TS).
-- Al cerrar se persiste aquí; reabrir borra estas filas y vuelve a calcular.

CREATE TABLE liquidacion (
    id                     INTEGER PRIMARY KEY,
    periodo_id             INTEGER NOT NULL,
    depto_id               INTEGER NOT NULL,
    propietario_id         INTEGER REFERENCES propietario(id),  -- dueño al cerrar; NULL = el actual del depto
    cambio                 REAL    NOT NULL,     -- cotización × (1 − descuento)
    comision_pct           REAL    NOT NULL,
    noches_disponibles     INTEGER NOT NULL,
    noches_no_disponibles  INTEGER NOT NULL DEFAULT 0,
    noches_ocupadas        INTEGER NOT NULL,
    noches_propietario     INTEGER NOT NULL DEFAULT 0,  -- "Ocupado cliente" (reservas NP)
    cant_reservas          INTEGER NOT NULL,
    ingresos_ars           INTEGER NOT NULL,     -- prorrateados al período
    ingresos_usd           INTEGER NOT NULL,
    costos_operativos      INTEGER NOT NULL,     -- tarifa reserva prorrateada (ARS)
    comisiones_ars         INTEGER NOT NULL,
    comisiones_usd         INTEGER NOT NULL,
    bruto                  INTEGER NOT NULL,     -- ARS + USD × cambio
    honorarios             INTEGER NOT NULL,     -- redondeado a centenas, como el Excel
    saldo_anterior_ars     INTEGER NOT NULL,
    saldo_anterior_usd     INTEGER NOT NULL,
    movimientos_ars        INTEGER NOT NULL,
    movimientos_usd        INTEGER NOT NULL,
    conversion_ars         INTEGER NOT NULL,     -- fila "Cambio moneda" [J53]
    conversion_usd         INTEGER NOT NULL,     -- [K53]
    -- Saldo antes del pago, en la moneda de liquidación del propietario (la
    -- otra queda en 0): >0 se le transfiere, <0 debe.
    saldo_final_ars        INTEGER NOT NULL,
    saldo_final_usd        INTEGER NOT NULL,
    movimiento_pago_id     INTEGER,              -- se completa al marcar "pagado"
    pdf_path               TEXT,
    calculada_en           TEXT    NOT NULL,
    moneda                 TEXT    NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')), -- en la que liquidaba el dueño al cerrar
    -- Saldado por fuera del sistema (deudas de antes de la app): cuenta como pagado sin movimiento ni factura.
    saldado_fuera          TEXT    CHECK (saldado_fuera IS NULL OR date(saldado_fuera) IS saldado_fuera),
    saldado_fuera_nota     TEXT,
    CONSTRAINT uq_liq_periodo_depto UNIQUE (periodo_id, depto_id),
    CONSTRAINT fk_liq_periodo FOREIGN KEY (periodo_id) REFERENCES periodo(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_liq_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_liq_mov_pago FOREIGN KEY (movimiento_pago_id) REFERENCES movimiento(id) ON DELETE SET NULL ON UPDATE CASCADE
) STRICT;
CREATE INDEX ix_liq_depto ON liquidacion(depto_id);
CREATE INDEX ix_liq_propietario ON liquidacion(propietario_id);
CREATE INDEX ix_liq_mov_pago ON liquidacion(movimiento_pago_id);

-- Reabrir borra las liquidaciones del período para recalcular. Una ya pagada
-- no se puede borrar: primero se anula su movimiento de pago (eso libera el
-- vínculo, ver trigger siguiente). Evita perder el pago y pagar dos veces.
CREATE TRIGGER tr_liq_pagada_del BEFORE DELETE ON liquidacion
WHEN OLD.movimiento_pago_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'liquidacion pagada: anular el pago antes de recalcular');
END;

CREATE TRIGGER tr_mov_anulado_libera_liq AFTER UPDATE OF estado ON movimiento
WHEN NEW.estado = 'anulado'
BEGIN
    UPDATE liquidacion SET movimiento_pago_id = NULL WHERE movimiento_pago_id = NEW.id;
END;

-- Detalle de reservas del PDF (tabla "Detalle reservas" de la hoja por depto).
CREATE TABLE liquidacion_reserva (
    liquidacion_id         INTEGER NOT NULL,
    reserva_id             INTEGER NOT NULL,
    codigo_interno         TEXT    NOT NULL,     -- 260329OVL1X10NW  DIV
    noches_totales         INTEGER NOT NULL,
    noches_periodo         INTEGER NOT NULL,
    importe_ars            INTEGER NOT NULL,     -- recibido (con ajuste)
    importe_periodo_ars    INTEGER NOT NULL,
    importe_usd            INTEGER NOT NULL,
    importe_periodo_usd    INTEGER NOT NULL,
    tarifa                 INTEGER NOT NULL,
    tarifa_periodo         INTEGER NOT NULL,
    comision_ars           INTEGER NOT NULL,
    comision_usd           INTEGER NOT NULL,
    pago_plataforma_usd    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT pk_liq_reserva PRIMARY KEY (liquidacion_id, reserva_id),
    CONSTRAINT fk_lr_liq FOREIGN KEY (liquidacion_id) REFERENCES liquidacion(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_lr_reserva FOREIGN KEY (reserva_id) REFERENCES reserva(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_lr_reserva ON liquidacion_reserva(reserva_id);

-- ------------------------------------------------------------
--  FACTURACIÓN ARCA (plan 031)
-- ------------------------------------------------------------

-- Quien factura los honorarios (Lautaro, Amancay). La clave privada del certificado
-- NO va acá: se guarda cifrada con safeStorage, como las credenciales de Stays.
CREATE TABLE emisor (
    id                 INTEGER PRIMARY KEY,
    nombre             TEXT    NOT NULL,
    razon_social       TEXT    NOT NULL,
    cuit               TEXT    NOT NULL UNIQUE CHECK (length(cuit) = 11 AND cuit NOT GLOB '*[^0-9]*'),
    condicion_iva      TEXT    NOT NULL CHECK (condicion_iva IN ('monotributista','responsable_inscripto','exento')),
    punto_venta        INTEGER NOT NULL CHECK (punto_venta BETWEEN 1 AND 99999),  -- el de tipo "Web Services"
    domicilio          TEXT,
    ingresos_brutos    TEXT,
    inicio_actividades TEXT    CHECK (inicio_actividades IS NULL OR date(inicio_actividades) IS inicio_actividades),
    ambiente           TEXT    NOT NULL DEFAULT 'homologacion' CHECK (ambiente IN ('homologacion','produccion')),
    cert_pem           TEXT,                       -- público (NULL = falta cargar el certificado)
    activo             INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
) STRICT;

-- Una fila por INTENTO de facturar, aprobado o rechazado (los rechazos quedan para
-- poder contestar "ARCA dijo tal cosa"). Va atada a período + depto y no a
-- liquidacion.id: reabrir un mes borra y recrea sus liquidaciones.
CREATE TABLE comprobante (
    id               INTEGER PRIMARY KEY,
    periodo_id       INTEGER NOT NULL REFERENCES periodo(id),
    depto_id         INTEGER NOT NULL REFERENCES depto(id),
    propietario_id   INTEGER NOT NULL REFERENCES propietario(id),
    movimiento_id    INTEGER NOT NULL REFERENCES movimiento(id),   -- el pago que se factura
    emisor_id        INTEGER NOT NULL REFERENCES emisor(id),
    cbte_tipo        INTEGER NOT NULL CHECK (cbte_tipo IN (1, 3, 6, 8, 11, 13)),  -- Fac/NC A, B, C
    punto_venta      INTEGER NOT NULL,
    numero           INTEGER,                      -- NULL si ARCA rechazó: no consume numeración
    cae              TEXT,
    cae_vencimiento  TEXT,
    fecha            TEXT    NOT NULL CHECK (date(fecha) IS fecha),        -- CbteFch
    serv_desde       TEXT    NOT NULL CHECK (date(serv_desde) IS serv_desde),
    serv_hasta       TEXT    NOT NULL CHECK (date(serv_hasta) IS serv_hasta),
    importe          INTEGER NOT NULL CHECK (importe > 0),               -- centavos ARS, total
    receptor_json    TEXT    NOT NULL CHECK (json_valid(receptor_json)), -- copia congelada al emitir
    estado           TEXT    NOT NULL CHECK (estado IN ('aprobado','rechazado')),
    ambiente         TEXT    NOT NULL CHECK (ambiente IN ('homologacion','produccion')),
    motivo           TEXT,                         -- por qué se rechazó
    observaciones    TEXT,                         -- Obs de ARCA (aprobado con salvedades)
    request_json     TEXT,                         -- sin <Auth>: el token no se guarda
    response_json    TEXT,
    asociado_id      INTEGER REFERENCES comprobante(id),  -- en una NC: la factura que anula
    creado_en        TEXT    NOT NULL,
    CONSTRAINT ck_comprobante_estado CHECK (
        (estado = 'aprobado'  AND numero IS NOT NULL AND cae IS NOT NULL AND cae_vencimiento IS NOT NULL) OR
        (estado = 'rechazado' AND numero IS NULL     AND cae IS NULL     AND cae_vencimiento IS NULL)),
    -- Una NC dice qué factura anula, y una factura no anula nada.
    CONSTRAINT ck_comprobante_nc CHECK ((cbte_tipo IN (3, 8, 13)) = (asociado_id IS NOT NULL))
) STRICT;
CREATE INDEX ix_cbte_periodo_depto ON comprobante(periodo_id, depto_id);
CREATE INDEX ix_cbte_movimiento ON comprobante(movimiento_id);
CREATE INDEX ix_cbte_asociado ON comprobante(asociado_id);
CREATE UNIQUE INDEX uq_cbte_numero ON comprobante(emisor_id, ambiente, cbte_tipo, punto_venta, numero) WHERE numero IS NOT NULL;

-- Lo emitido en ARCA por cualquier medio (Mis Comprobantes → Emitidos, CSV importado a mano; plan 036).
-- Incluye lo de Comprobantes en Línea, que Hornera no emite: sirve para no facturar dos veces.
CREATE TABLE comprobante_arca (
    id             INTEGER PRIMARY KEY,
    emisor_id      INTEGER NOT NULL REFERENCES emisor(id),
    fecha          TEXT    NOT NULL CHECK (date(fecha) IS fecha),
    cbte_tipo      INTEGER NOT NULL,                     -- código de ARCA (11 Factura C, 13 NC C...)
    punto_venta    INTEGER NOT NULL,
    numero         INTEGER NOT NULL,                     -- Número Desde
    numero_hasta   INTEGER NOT NULL,
    cae            TEXT,
    doc_tipo       INTEGER,                              -- 80 CUIT, 96 DNI, 99 consumidor final...
    doc_nro        TEXT,
    receptor       TEXT,
    importe        INTEGER NOT NULL,                     -- centavos ARS (Imp. Total)
    movimiento_id  INTEGER REFERENCES movimiento(id),    -- pago al que se vinculó a mano (factura hecha por fuera)
    importado_en   TEXT    NOT NULL,
    CONSTRAINT uq_cbte_arca UNIQUE (emisor_id, cbte_tipo, punto_venta, numero)
) STRICT;
CREATE INDEX ix_cbte_arca_movimiento ON comprobante_arca(movimiento_id);

-- Histórico previo al sistema (hojas OCUPACION y Resumen, 12/2021 en adelante).
-- Desde el primer cierre en el sistema, el histórico sale de `liquidacion`.
CREATE TABLE historico_mensual (
    depto_id          INTEGER NOT NULL,
    mes               TEXT    NOT NULL CHECK (mes GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    noches_ocupadas   INTEGER,
    bruto             INTEGER,
    honorarios        INTEGER,
    saldo             INTEGER,
    CONSTRAINT pk_historico PRIMARY KEY (depto_id, mes),
    CONSTRAINT fk_hist_depto FOREIGN KEY (depto_id) REFERENCES depto(id) ON DELETE RESTRICT ON UPDATE CASCADE
) STRICT, WITHOUT ROWID;

-- ------------------------------------------------------------
--  AUDITORÍA Y CONFIGURACIÓN
-- ------------------------------------------------------------

CREATE TABLE auditoria (
    id          INTEGER PRIMARY KEY,
    fecha       TEXT    NOT NULL,
    pc          TEXT    NOT NULL,                -- sin login: la PC es el usuario (nombre de Terminales o de la terminal)
    tabla       TEXT    NOT NULL,
    registro_id INTEGER,
    accion      TEXT    NOT NULL CHECK (accion IN ('alta','modificacion','anulacion','cierre','reapertura','importacion')),
    antes_json  TEXT,
    despues_json TEXT,
    con_ia      INTEGER NOT NULL DEFAULT 0 CHECK (con_ia IN (0,1)) -- confirmado desde el asistente (plan 068)
) STRICT;
CREATE INDEX ix_auditoria_registro ON auditoria(tabla, registro_id);

-- PCs de la red emparejadas con este servidor (fase 5d). Se guarda el hash del token, no el token.
CREATE TABLE terminal (
    id          INTEGER PRIMARY KEY,
    nombre      TEXT    NOT NULL,
    token_hash  TEXT    NOT NULL UNIQUE,
    creada_en   TEXT    NOT NULL,
    revocada_en TEXT
) STRICT;

-- Clave/valor: carpeta de backup, URL de Stays, ticket de acceso de ARCA (12 h), etc.
-- Las credenciales de Stays y las claves de ARCA NO van aquí: safeStorage de Electron.
CREATE TABLE configuracion (
    clave  TEXT PRIMARY KEY,
    valor  TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- Conversaciones con el asistente (plan 061), una lista por PC. mensajes_json es el historial tal cual se
-- manda a la API (bloques completos, incluidos los de thinking): solo se agrega al final, nunca se edita.
CREATE TABLE conversacion_ia (
    id             INTEGER PRIMARY KEY,
    pc             TEXT    NOT NULL,                 -- como auditoria.pc: la PC es el usuario
    titulo         TEXT    NOT NULL,                 -- primeras palabras de la primera pregunta
    mensajes_json  TEXT    NOT NULL CHECK (json_valid(mensajes_json)),
    creada_en      TEXT    NOT NULL,
    actualizada_en TEXT    NOT NULL
) STRICT;
CREATE INDEX ix_conversacion_ia_pc ON conversacion_ia(pc, actualizada_en);

-- Una fila por respuesta: qué modelo contestó y cuánto costó, para mostrarlo y comparar modelos.
CREATE TABLE respuesta_ia (
    id                INTEGER PRIMARY KEY,
    conversacion_id   INTEGER NOT NULL REFERENCES conversacion_ia(id) ON DELETE CASCADE,
    modelo            TEXT    NOT NULL,               -- response.model (el que contestó de verdad)
    esfuerzo          TEXT    NOT NULL,
    tokens_entrada    INTEGER NOT NULL,               -- suma de las vueltas del bucle de herramientas
    tokens_cache      INTEGER NOT NULL,               -- cache_read_input_tokens
    tokens_salida     INTEGER NOT NULL,
    herramientas_json TEXT    NOT NULL CHECK (json_valid(herramientas_json)), -- [{nombre, entrada, filas}]
    creada_en         TEXT    NOT NULL
) STRICT;
CREATE INDEX ix_respuesta_ia_conversacion ON respuesta_ia(conversacion_id);

-- Lo que el asistente propone hacer (plan 068): no se guarda nada hasta que la persona lo confirma.
CREATE TABLE propuesta_ia (
    id              INTEGER PRIMARY KEY,
    conversacion_id INTEGER NOT NULL REFERENCES conversacion_ia(id) ON DELETE CASCADE,
    tipo            TEXT    NOT NULL CHECK (tipo IN ('movimiento','gasto_personal','ficha','mes')),
    accion          TEXT    NOT NULL,                 -- alta, edicion, anulacion, borrado, traer_stays, cotizacion
    datos_json      TEXT    NOT NULL CHECK (json_valid(datos_json)),   -- lo propuesto
    antes_json      TEXT    CHECK (antes_json IS NULL OR json_valid(antes_json)), -- el registro al proponer (edición/anulación)
    estado          TEXT    NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmada','editada','descartada','fallida')),
    resultado       TEXT,                             -- id creado o motivo del fallo
    creada_en       TEXT    NOT NULL,
    resuelta_en     TEXT
) STRICT;
CREATE INDEX ix_propuesta_ia_conversacion ON propuesta_ia(conversacion_id);

-- Comprobantes (foto o PDF) de un movimiento. Sin movimiento: subido al asistente y todavía sin confirmar.
CREATE TABLE adjunto (
    id            INTEGER PRIMARY KEY,
    nombre        TEXT    NOT NULL,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('image/jpeg','image/png','image/webp','application/pdf')),
    datos         BLOB    NOT NULL,
    bytes         INTEGER NOT NULL,
    movimiento_id INTEGER REFERENCES movimiento(id) ON DELETE SET NULL,
    creado_en     TEXT    NOT NULL
) STRICT;
CREATE INDEX ix_adjunto_movimiento ON adjunto(movimiento_id);

-- ------------------------------------------------------------
--  VISTAS
-- ------------------------------------------------------------

-- El saldo arranca en la fecha del "Saldo inicial" de la cuenta (saldo_desde), si tiene:
-- lo cobrado o movido antes ya está incluido en ese saldo. Sin saldo inicial suma todo.
CREATE VIEW v_saldo_cuenta AS
SELECT c.id AS cuenta_id, c.nombre, c.moneda, c.activo, d.desde AS saldo_desde,
       -- Movimientos cargados en la app (gastos, transferencias, saldo inicial...)
       COALESCE((SELECT SUM(CASE c.moneda WHEN 'ARS' THEN m.importe_ars ELSE m.importe_usd END)
                 FROM movimiento m WHERE m.cuenta_id = c.id AND m.estado = 'vigente'
                   AND (d.desde IS NULL OR m.fecha >= d.desde)), 0)
       -- + lo que entró por los medios de pago de Stays asociados a la cuenta (neto de comisión)
     + COALESCE((SELECT SUM(CASE p.tipo WHEN 'debit' THEN -p.importe ELSE p.importe - COALESCE(p.comision, 0) END)
                 FROM pago p JOIN medio_pago mp ON mp.id = p.medio_pago_id
                 WHERE mp.cuenta_id = c.id AND mp.moneda = c.moneda AND p.estado = 'completed'
                   AND (d.desde IS NULL OR p.fecha_pago IS NULL OR p.fecha_pago >= d.desde)), 0) AS saldo
FROM cuenta c
LEFT JOIN (SELECT cuenta_id, MIN(fecha) AS desde FROM movimiento
           WHERE tipo = 'saldo_inicial' AND estado = 'vigente' AND cuenta_id IS NOT NULL
           GROUP BY cuenta_id) d ON d.cuenta_id = c.id;

-- Pagos de Stays que entran en la liquidación (mismas reglas que el script 3):
-- sin débitos, sin pendientes, sin "res. fee" / "Res. Security Deposit".
CREATE VIEW v_pago_liquidable AS
SELECT p.*, mp.moneda,
       CASE WHEN mp.descuenta_comision = 1 THEN p.importe - COALESCE(p.comision, 0) ELSE p.importe END AS importe_neto,
       (mp.descuenta_comision = 1 AND COALESCE(p.comision, 0) = 0) AS falta_comision
FROM pago p
JOIN medio_pago mp ON mp.id = p.medio_pago_id
WHERE p.tipo <> 'debit'
  AND p.estado <> 'pending'
  AND NOT (lower(COALESCE(p.descripcion, '')) LIKE 'res. fee%'
        OR lower(COALESCE(p.descripcion, '')) LIKE '%res. security deposit%');
