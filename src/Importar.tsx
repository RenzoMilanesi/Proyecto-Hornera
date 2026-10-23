import { useState } from 'react';
import { Alert, Descriptions, Divider, Typography, Upload } from 'antd';
import { pesos, subirArchivo } from './api.ts';

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

      <Divider />
      <GastosVarios />
    </>
  );
}

interface ReporteGastos {
  importados: number; repetidos: number; ajenos: number; anulados: number; anteriores: number; cuenta: Record<string, number>;
  codigosDesconocidos: Record<string, number>; avisos: string[];
}

// Qué es cada código del Excel (lo aclararon Lautaro y Amancay); los ajenos a Hornera van a Gastos personales.
const GRUPOS: Record<string, string> = {
  DEPTOS: 'Deptos (a los propietarios)', INT: 'INT · Hornera operativos', CAY: 'CAY · personales de Amancay',
  LAU: 'LAU · personales de Lautaro', 'CAY/LAU': 'CAY/LAU · compartidos', CASEST: 'CASEST · Casa del Estudiante', CASA: 'CASA · la casa',
};

// Excel de gastos varios ("Comprobantes Hornera"): plans/037-importar-gastos-varios.md.
function GastosVarios() {
  const [cargando, setCargando] = useState(false);
  const [reporte, setReporte] = useState<ReporteGastos>();
  const [error, setError] = useState<string>();

  const importar = async (archivo: File) => {
    setCargando(true);
    setError(undefined);
    setReporte(undefined);
    try {
      setReporte(await subirArchivo<ReporteGastos>('importar/gastos', archivo));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };
  const desconocidos = Object.entries(reporte?.codigosDesconocidos ?? {});

  return (
    <>
      <Typography.Title level={5}>Gastos varios</Typography.Title>
      <Typography.Paragraph type="secondary">
        El Excel de comprobantes de gastos. Entran los del mes abierto como movimientos: con depto se le descuentan
        al propietario; INT y los códigos que no son deptos, a Hornera. CAY, LAU, CAY/LAU, CASEST y CASA no son de Hornera:
        se guardan en Hornera → Gastos personales. Se puede volver a importar:
        lo que ya está no se duplica.
      </Typography.Paragraph>
      <Upload.Dragger accept=".xlsx" showUploadList={false} disabled={cargando}
        beforeUpload={(archivo) => { importar(archivo); return false; }}>
        <p style={{ fontSize: 16, margin: '8px 0' }}>{cargando ? 'Importando…' : 'Soltá el Excel de gastos o hacé clic para elegirlo'}</p>
      </Upload.Dragger>

      {error && <Alert style={{ marginTop: 16 }} type="error" showIcon title={error} />}
      {reporte && (
        <>
          <Alert style={{ marginTop: 16 }} type="success" showIcon title={`${reporte.importados} gastos importados`} />
          <Descriptions style={{ marginTop: 16 }} size="small" bordered column={2} items={[
            { label: 'Gastos personales guardados', children: reporte.ajenos },
            { label: 'Ya estaban', children: reporte.repetidos },
            { label: 'Ajenos ya cargados (anulados)', children: reporte.anulados },
            { label: 'De meses anteriores (salteados)', children: reporte.anteriores },
          ]} />
          <Descriptions style={{ marginTop: 16 }} size="small" bordered column={1} title="Cuenta del mes por código"
            items={Object.entries(reporte.cuenta).map(([c, centavos]) => ({ label: GRUPOS[c] ?? c, children: pesos(centavos) }))} />
          {desconocidos.length > 0 && (
            <Alert style={{ marginTop: 16 }} type="info" showIcon title="Códigos que no son deptos (cargados a Hornera, con el código en el detalle)"
              description={desconocidos.map(([c, n]) => `${c}: ${n}`).join(' · ')} />
          )}
          {reporte.avisos.length > 0 && (
            <Alert style={{ marginTop: 16 }} type="warning" showIcon title={`Avisos (${reporte.avisos.length})`}
              description={<ul style={{ margin: 0, paddingLeft: 20 }}>{reporte.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>} />
          )}
        </>
      )}
    </>
  );
}
