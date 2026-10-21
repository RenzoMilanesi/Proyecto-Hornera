# Plan 036: Lo facturado en ARCA dentro de Hornera, para no facturar dos veces

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MEDIUM (cambio de esquema; toca la emisión)
- **Depends on**: plan 031 (hecho), plan 035 (hecho)
- **Planned at**: commit `87bc332` (v0.26.0), 2026-10-21. Lo implementa la misma sesión.

## Por qué
Los emisores también facturan por **Comprobantes en Línea** (otro punto de venta, fuera de Hornera). Va a
pasar que se facture por ahí una liquidación que Hornera todavía muestra "pendiente" y después se emita de
nuevo desde Hornera: factura duplicada y una NC para arreglarla.

El webservice (WSFEv1) solo consulta comprobante por comprobante y probablemente no ve el punto de venta de
Comprobantes en Línea. La fuente que tiene **todo** es *Mis Comprobantes → Emitidos* de ARCA, que se exporta a
CSV. Ese CSV se importa.

## Formato del CSV (export real, 2026-10)
- UTF-8, separador `;`, encabezados entre comillas, decimales con coma (`122278,10`), fecha ISO.
- Nombre: `comprobantes_consulta_csv_emitidos_<id>_<CUIT emisor>_<AAAAMMDD-HHMM> (montos expresados en pesos).csv`.
- Columnas usadas: `Fecha de Emisión`, `Tipo de Comprobante` (código ARCA: 11 = Factura C, 13 = NC C…),
  `Punto de Venta`, `Número Desde`, `Número Hasta`, `Cód. Autorización`, `Tipo Doc. Receptor` (80 CUIT, 96 DNI),
  `Nro. Doc. Receptor`, `Denominación Receptor`, `Imp. Total` (en pesos).

## Decisiones
| Tema | Decisión |
|---|---|
| Fuente | CSV de Mis Comprobantes → Emitidos, importado a mano por emisor. Sin certificado. |
| Validación | Encabezados obligatorios; si el nombre trae un CUIT de 11 dígitos distinto del emisor, se rechaza; "recibidos" se rechaza. |
| Reimportar | Idempotente: clave (emisor, tipo, punto de venta, número). Actualiza datos, conserva el vínculo. |
| Propietario | Se reconoce por documento: CUIT o DNI, y el DNI dentro de un CUIT de persona física (`dniDeCuit`). |
| "De Hornera" | Coincide con un `comprobante` aprobado de producción (mismo emisor, tipo, punto de venta, número). |
| Aviso al facturar | Facturas externas (no NC, no de Hornera, sin vincular) al mismo propietario, con fecha entre el 1.º del mes liquidado y el fin del mes siguiente. Emitir con externas pide confirmación explícita (`ignorar_externas`), también en el servidor. |
| Vincular | Desde "Facturar este pago": "Es esta" vincula la externa al pago; el pago queda facturado y no se puede emitir otra. Se desvincula desde la pestaña. |
| Pantalla | Comprobantes → pestaña **"En ARCA"**: importar, lista del mes con estado (de Hornera / vinculada / de un propietario sin vincular / ajena). |
| Borrar emisor | Sus importados se borran con él; si alguno está vinculado a un pago, no se borra. |
| Fuera | NC parcial o de una factura externa (paso siguiente); consulta por webservice. |

## Esquema (versión 11)
```sql
CREATE TABLE comprobante_arca (
    id INTEGER PRIMARY KEY,
    emisor_id INTEGER NOT NULL REFERENCES emisor(id),
    fecha TEXT NOT NULL CHECK (date(fecha) IS fecha),
    cbte_tipo INTEGER NOT NULL, punto_venta INTEGER NOT NULL,
    numero INTEGER NOT NULL, numero_hasta INTEGER NOT NULL,
    cae TEXT, doc_tipo INTEGER, doc_nro TEXT, receptor TEXT,
    importe INTEGER NOT NULL,                       -- centavos ARS (Imp. Total)
    movimiento_id INTEGER REFERENCES movimiento(id), -- pago al que se vinculó
    importado_en TEXT NOT NULL,
    UNIQUE (emisor_id, cbte_tipo, punto_venta, numero)
) STRICT;
```

## Done
- `npm run typecheck` y `npm test` pasan; tests nuevos en `server/misComprobantes.test.ts` (parseo, CUIT ajeno,
  reimportar, aviso, vincular bloquea emitir, borrar emisor).
