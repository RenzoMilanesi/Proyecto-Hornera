// La paleta de la interfaz, en un solo lugar. Lo que es token de antd se lee con theme.useToken() o Typography type;
// `colores` son los que no tienen token. index.html (CSS global) usa los mismos valores.
import type { ThemeConfig } from 'antd';

// Tema "Ladrillo": terracota sobre fondo cálido, menú oscuro. Fuente local (la app anda sin internet).
const marron = '#2A211B';
export const tema: ThemeConfig = {
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
    Menu: { darkItemBg: marron, darkItemColor: '#E9E1D8', darkItemSelectedBg: '#A8461F', darkItemHoverBg: '#3A2E26', darkGroupTitleColor: '#E8B48F',
      darkSubMenuItemBg: '#221A15' }, // desplegable (Propiedades): un marrón apenas más oscuro, no el negro azulado de antd
    Table: { headerBg: '#FBF8F4' },
    Modal: { titleFontSize: 18 },
  },
};

// Colores sin token de antd: textos del menú lateral, avisos de la campanita y el gráfico de Liquidación.
export const colores = {
  menuTitulo: '#fff', menuLink: '#E8C9A8', menuVersion: '#B3A698',
  avisoNaranja: '#d46b08', avisoInfo: '#8c8c8c',
  costos: '#B4B2A9', hornera: '#F0997B', gastos: '#EF9F27', propietario: '#1D9E75', deuda: '#E24B4A', deudaRaya: '#F7C1C1',
};
