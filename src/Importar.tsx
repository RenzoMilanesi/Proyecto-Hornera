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
        <div style={{ padding: '24px 0' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={{ opacity: 0.6 }}>
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p style={{ fontSize: 16, margin: '8px 0 4px' }}>{cargando ? 'Importando…' : 'Soltá el .xlsx o hacé clic para elegirlo'}</p>
          <Typography.Text type="secondary">Solo archivos .xlsx exportados del Google Sheet</Typography.Text>
        </div>
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
