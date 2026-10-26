import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import esES from 'antd/locale/es_ES';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import { App } from './App.tsx';
import { Imprimir } from './Imprimir.tsx';
import { tema } from './tema.ts';

// /?imprimir=1&mes=…&depto=… es la hoja para el PDF (sin menú ni Ant Design).
const imprimir = new URLSearchParams(location.search).has('imprimir');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {imprimir ? <Imprimir /> : (
      <ConfigProvider locale={esES} theme={tema}>
        <App />
      </ConfigProvider>
    )}
  </StrictMode>,
);
