import { useState } from 'react';
import { Alert, Descriptions, Typography, Upload } from 'antd';
import { subirArchivo } from './api.ts';

interface Reporte {
  mes: string; propietarios: number; deptos: number; plataformas: number; cuentas: number;
  movimientos: number; liquidaciones: number; historico: number; avisos: string[];
}

export function Importar() {
  const [cargando, setCargando] = useState(false);
  const [reporte, setReporte] = useState<Reporte>();
  const [error, setError] = useState<string>();

  const importar = async (archivo: File) => {
    setCargando(true);
    setError(undefined);
    setReporte(undefined);
    try {
      setReporte(await subirArchivo<Reporte>('importar/excel', archivo));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <Typography.Paragraph type="secondary">
        Exportá el Google Sheet del mes como .xlsx (Archivo → Descargar → Microsoft Excel) y soltalo acá.
        El mes queda cerrado con los saldos de su liquidación; los propietarios y deptos se actualizan.
      </Typography.Paragraph>
      <Upload.Dragger
        accept=".xlsx"
        showUploadList={false}
        disabled={cargando}
        beforeUpload={(archivo) => { importar(archivo); return false; }}
      >
        <p style={{ fontSize: 16 }}>{cargando ? 'Importando…' : 'Soltá el .xlsx o hacé clic para elegirlo'}</p>
      </Upload.Dragger>

      {error && <Alert style={{ marginTop: 16 }} type="error" showIcon title={error} />}
      {reporte && (
        <>
          <Alert style={{ marginTop: 16 }} type="success" showIcon title={`Período ${reporte.mes} importado`} />
          <Descriptions style={{ marginTop: 16 }} size="small" bordered column={2} items={[
            { label: 'Propietarios', children: reporte.propietarios },
            { label: 'Deptos', children: reporte.deptos },
            { label: 'Plataformas', children: reporte.plataformas },
            { label: 'Cuentas', children: reporte.cuentas },
            { label: 'Movimientos', children: reporte.movimientos },
            { label: 'Liquidaciones', children: reporte.liquidaciones },
            { label: 'Histórico (depto × mes)', children: reporte.historico },
          ]} />
          {reporte.avisos.length > 0 && (
            <Alert style={{ marginTop: 16 }} type="warning" showIcon title={`Avisos (${reporte.avisos.length})`}
              description={<ul style={{ margin: 0, paddingLeft: 20 }}>{reporte.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>} />
          )}
        </>
      )}
    </>
  );
}
