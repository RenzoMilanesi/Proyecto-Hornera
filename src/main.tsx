import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import esES from 'antd/locale/es_ES';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={esES}>
      <App />
    </ConfigProvider>
  </StrictMode>,
);
