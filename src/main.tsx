import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import esES from 'antd/locale/es_ES';
import { App } from './App.tsx';
import { Imprimir } from './Imprimir.tsx';

// /?imprimir=1&mes=…&depto=… es la hoja para el PDF (sin menú ni Ant Design).
const imprimir = new URLSearchParams(location.search).has('imprimir');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {imprimir ? <Imprimir /> : (
      <ConfigProvider locale={esES}>
        <App />
      </ConfigProvider>
    )}
  </StrictMode>,
);
