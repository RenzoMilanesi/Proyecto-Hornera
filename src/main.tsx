import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import type { ThemeConfig } from 'antd';
import esES from 'antd/locale/es_ES';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import { App } from './App.tsx';
import { Imprimir } from './Imprimir.tsx';

// /?imprimir=1&mes=…&depto=… es la hoja para el PDF (sin menú ni Ant Design).
const imprimir = new URLSearchParams(location.search).has('imprimir');

// Tema "Ladrillo": terracota sobre fondo cálido, menú oscuro. Fuente local (la app anda sin internet).
const marron = '#2A211B';
const tema: ThemeConfig = {
  token: {
    colorPrimary: '#A8461F',
    colorLink: '#A8461F',
    colorError: '#B42318',
    colorText: marron,
    colorTextSecondary: '#6E6259',
    colorBgLayout: '#F6F2EC',
    colorBorder: '#D9CFC2',
    colorBorderSecondary: '#E6DED3',
    borderRadius: 6,
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  },
  components: {
    Layout: { siderBg: marron },
    Menu: { darkItemBg: marron, darkItemColor: '#E9E1D8', darkItemSelectedBg: '#A8461F', darkItemHoverBg: '#3A2E26', darkGroupTitleColor: '#E8B48F' },
    Table: { headerBg: '#FBF8F4' },
    Modal: { titleFontSize: 18 },
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {imprimir ? <Imprimir /> : (
      <ConfigProvider locale={esES} theme={tema}>
        <App />
      </ConfigProvider>
    )}
  </StrictMode>,
);
