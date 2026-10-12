"""Extrae de un export del Google Sheet (p. ej. 2026-04.xlsx) los datos que necesita
el test de regresión del motor de liquidación, sin datos personales.

Uso:  py -I scripts/extraer_fixture_excel.py "Archivos Originales/2026-04.xlsx" tests/fixtures/2026-04.json

Solo stdlib (no hace falta pip). La salida va a tests/fixtures/, que está en .gitignore:
son montos reales del negocio.
"""
import json, sys, zipfile, datetime, xml.etree.ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def leer_libro(path):
    z = zipfile.ZipFile(path)
    ss = [''.join(t.text or '' for t in si.iter(M + 't'))
          for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(M + 'si')]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    hojas = {}
    for s in ET.fromstring(z.read('xl/workbook.xml')).find(M + 'sheets'):
        tgt = rels[s.get(R + 'id')].lstrip('/')
        tgt = tgt if tgt.startswith('xl/') else 'xl/' + tgt
        celdas = {}
        for c in ET.fromstring(z.read(tgt)).iter(M + 'c'):
            v, f = c.find(M + 'v'), c.find(M + 'f')
            val = v.text if v is not None else None
            if val is not None and c.get('t') == 's':
                val = ss[int(val)]
            elif val is not None and c.get('t') not in ('str', 'inlineStr', 'e', 'b'):
                val = float(val)
            celdas[c.get('r')] = (val, f.text if f is not None else None)
        hojas[s.get('name')] = celdas
    return hojas


def num(hoja, ref):
    v = hoja.get(ref, (None, None))[0]
    return v if isinstance(v, float) else 0.0


def fecha(serial):
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(serial))).isoformat()


def main(xlsx, salida):
    h = leer_libro(xlsx)
    db, res = h['Datos balance'], h['RESERVAS']
    deptos_con_hoja = [n for n in h if len(n) <= 4 and 'C11' in h[n] and h[n]['C11'][0] == n]

    periodo = {
        'inicio': fecha(num(db, 'B1')), 'cierre': fecha(num(db, 'B2')),
        'cotizacionUsd': num(db, 'B5'), 'descuentoUsdPct': num(db, 'A6'),
        'tarifaBase': num(db, 'B15'), 'adicionalHuesped': num(db, 'B9'),
        'nochesTramo1': int(num(db, 'A17')), 'cargoTramo1': num(db, 'B17'),
        'nochesTramo2': int(num(db, 'A18')), 'cargoTramo2': num(db, 'B18'),
    }

    reservas = {}
    fila = 3  # la fila 2 es "NO TOCAR FILA"
    while f'B{fila}' in res or f'D{fila}' in res:
        depto = res.get(f'B{fila}', (None,))[0]
        if depto in deptos_con_hoja and isinstance(res.get(f'D{fila}', (None,))[0], float):
            reservas.setdefault(depto, []).append({
                'llegada': fecha(num(res, f'D{fila}')), 'salida': fecha(num(res, f'E{fila}')),
                'huespedes': int(num(res, f'G{fila}')), 'canal': res.get(f'X{fila}', ('',))[0] or '',
                'ars': num(res, f'N{fila}'), 'ajusteArs': num(res, f'O{fila}'),
                'usd': num(res, f'R{fila}'), 'ajusteUsd': num(res, f'S{fila}'),
                'pagoPlataformaUsd': num(res, f'Y{fila}'),
            })
        fila += 1

    deptos = {}
    for d in deptos_con_hoja:
        s = h[d]
        movimientos, pagos = [], []
        for r in range(36, 53):
            concepto = s.get(f'B{r}', (None,))[0]
            if concepto is None:
                continue
            linea = {'concepto': concepto, 'ars': num(s, f'J{r}'), 'usd': num(s, f'K{r}')}
            (pagos if concepto == 'Liquidacion periodo' else movimientos).append(linea)
        # JUY: C21 = cierre − 9 a mano → equivale a 9 noches no disponibles.
        dias_periodo = (datetime.date.fromisoformat(periodo['cierre']) - datetime.date.fromisoformat(periodo['inicio'])).days
        no_disponibles = int(num(s, 'B24')) + dias_periodo - int(num(s, 'B22'))
        # Valores tipeados a mano en la columna de tarifa (Z), fuera del QUERY.
        costos_manuales = sum(v for (ref, (v, f)) in s.items()
                              if ref[0] == 'Z' and ref[1:].isdigit() and 6 <= int(ref[1:]) <= 56
                              and f is None and isinstance(v, float))
        f53 = (s.get('J53', (None, ''))[1] or '').upper()
        k53 = s.get('K53', (None, ''))[1] or ''
        a_usd = f53.startswith('-SUM(J')
        deptos[d] = {
            'config': {
                'comisionPct': num(s, 'I15'), 'noDisponibles': no_disponibles,
                'monedaLiquidacion': 'USD' if a_usd else 'ARS',
                # R64: K53 = -J53/(I13/96*100) → recargo del 4 % al pasar a USD
                'comisionCobroUsdPct': 0.04 if a_usd and '96' in k53 else 0.0,
            },
            'comisiones': {'ars': -num(s, 'J33'), 'usd': -num(s, 'K33')},
            # Hoja con los costos editados a mano: valores tipeados en Z o J32 ≠ -Z57 (AND).
            'costosEditados': costos_manuales != 0 or (s.get('J32', (None, ''))[1] or '').replace(' ', '') != '-Z57',
            'movimientos': movimientos,
            'pagos': pagos,
            'reservas': reservas.get(d, []),
            'esperado': {
                'bruto': num(s, 'F18'), 'gastosDirectos': num(s, 'F19'), 'honorarios': num(s, 'J34'),
                'saldoParcial': num(s, 'F22'), 'ingresosArs': num(s, 'J31'), 'ingresosUsd': num(s, 'K31'),
                'costosOperativos': -num(s, 'J32'), 'conversionArs': num(s, 'J53'),
                'conversionUsd': num(s, 'K53'), 'saldoArs': num(s, 'J55'), 'saldoUsd': num(s, 'K55'),
                'nochesOcupadas': num(s, 'B26'), 'nochesDisponibles': num(s, 'B23'),
            },
        }

    with open(salida, 'w', encoding='utf-8') as f:
        json.dump({'periodo': periodo, 'deptos': deptos}, f, ensure_ascii=False, indent=1)
    print(f'{len(deptos)} deptos, {sum(len(v["reservas"]) for v in deptos.values())} reservas -> {salida}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
