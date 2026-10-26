// El diseño de la interfaz, en un solo lugar. Reglas para toda pantalla de src/ (las controla src/estilos.test.ts):
// 1. Colores: nunca un color escrito en una pantalla (#hex, rgb(), hsl()). Texto de apoyo: Typography type="secondary";
//    error: type="danger"; el resto, el token de antd con theme.useToken() (token.colorPrimary, colorError, colorFillTertiary…).
//    Lo que no tiene token va en `colores` de acá. Los Tag usan los colores con nombre de antd (green, red, blue…).
// 2. Contraste: texto sobre fondo claro con 4,5:1 o más (el gris del tema, #6E6259, da 5,9:1). Un gris más claro, no.
// 3. Letra: solo los tamaños de `LETRA`. Mejor todavía, el componente que ya lo trae (Typography.Title, Statistic).
// 4. Modales y ventanas: skill `modales`. Plata y fechas: pesos, entradaPlata, fecha, fechaHora y hoy de src/api.ts.
// Excepción: Imprimir.tsx (hoja del PDF, sin antd). index.html (CSS global) usa los mismos valores que este archivo.
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

// Tamaños de letra permitidos en las pantallas (px). La base de antd es 14; 12 para lo chico, 16-20 para destacar.
export const LETRA = [12, 13, 14, 16, 18, 20];

// Colores sin token de antd: textos del menú lateral, avisos de la campanita y el gráfico de Liquidación.
export const colores = {
  menuTitulo: '#fff', menuLink: '#E8C9A8', menuVersion: '#B3A698',
  avisoNaranja: '#d46b08', avisoInfo: '#8c8c8c',
  costos: '#B4B2A9', hornera: '#F0997B', gastos: '#EF9F27', propietario: '#1D9E75', deuda: '#E24B4A', deudaRaya: '#F7C1C1',
};
