// Capturas del manual: npx electron capturar.mjs <carpeta de salida> [solo]
// Necesita Hornera corriendo en 127.0.0.1:4310 con la base de demo (seed.ts).
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SALIDA = process.argv[2];
const SOLO = process.argv[3];
const URL = 'http://127.0.0.1:4310';
mkdirSync(SALIDA, { recursive: true });
app.setName('hornera-capturas');

let w;
const js = (code) => w.webContents.executeJavaScript(code);
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const tam = async (ancho, alto) => { w.setContentSize(ancho, alto); await esperar(400); };

// Click en el último elemento visible (botón, link, menú, opción) cuyo texto sea exactamente `texto` (o lo contenga con ~).
async function click(texto, selector = 'button, a, .ant-menu-item, .ant-select-item-option, .ant-tabs-tab, [role=button], label, span') {
  const ok = await js(`(() => {
    const t = ${JSON.stringify(texto)}; const parcial = t.startsWith('~'); const q = parcial ? t.slice(1) : t;
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.offsetParent !== null || e.getClientRects().length);
    const m = els.filter((e) => { const x = e.innerText?.trim(); return parcial ? x?.includes(q) : x === q; });
    const e = m[m.length - 1]; if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true;
  })()`);
  if (!ok) throw new Error(`No encontré "${texto}"`);
  await esperar(700);
}
// Abre el n-ésimo Select visible y elige la opción.
async function elegir(n, opcion) {
  // Con un modal abierto, los Select del modal (los de la pantalla de atrás no cuentan).
  await js(`(() => { const raiz = [...document.querySelectorAll('.ant-modal-wrap')].find((m) => m.getClientRects().length) ?? document;
    const s = [...raiz.querySelectorAll('.ant-select')].filter((e) => e.offsetParent)[${n}];
    s.scrollIntoView({ block: 'center' }); s.querySelector('.ant-select-selector, .ant-select-content, input')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()`);
  await esperar(500);
  await click(opcion, '.ant-select-item-option');
}
const ir = async (seccion) => { await js('window.scrollTo(0, 0)'); await click(seccion, '.ant-menu-item'); await esperar(900); };

// Foto de la ventana entera, o del recorte de un selector (con margen).
async function foto(nombre, selector, margen = selector?.includes('modal') ? 0 : 12) {
  await esperar(500);
  let rect;
  if (selector) {
    rect = await js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((x) => x.offsetParent || x.getClientRects().length).pop();
      if (!e) return null; const r = e.getBoundingClientRect();
      return { x: Math.max(0, Math.floor(r.x) - ${margen}), y: Math.max(0, Math.floor(r.y) - ${margen}), width: Math.ceil(r.width) + ${2 * margen}, height: Math.ceil(r.height) + ${2 * margen} }; })()`);
    if (!rect) throw new Error(`No encontré ${selector} para ${nombre}`);
    const [ancho, alto] = w.getContentSize();
    rect.width = Math.min(rect.width, ancho - rect.x);
    rect.height = Math.min(rect.height, alto - rect.y);
  }
  else {
    // Ventana entera, cortada donde termina el contenido (sin el vacío de abajo).
    const [ancho, alto] = w.getContentSize();
    const fin = await js(`(() => { const c = document.querySelector('.ant-layout-content'); if (!c) return 0;
      return Math.max(...[...c.querySelectorAll('*')].map((e) => e.getBoundingClientRect().bottom)) + 24; })()`);
    rect = { x: 0, y: 0, width: ancho, height: Math.min(alto, Math.max(400, Math.ceil(fin) || alto)) };
  }
  const img = await w.webContents.capturePage(rect);
  writeFileSync(join(SALIDA, `${nombre}.png`), img.toPNG());
  console.log('foto', nombre);
}
const cerrarModal = async () => { await js(`document.querySelectorAll('.ant-modal-close').forEach((b) => b.offsetParent && b.click())`); await esperar(600); };
const desplegar = async (fila) => { await js(`document.querySelectorAll('.ant-table-row-expand-icon')[${fila}].click()`); await esperar(600); };

const pasos = {
  async resumen() {
    await tam(1440, 1500); await ir('Resumen'); await foto('resumen');
  },
  async liquidacion() {
    await tam(1440, 900); await ir('Liquidación'); await esperar(800); await foto('liquidacion');
    await desplegar(0); await tam(1440, 1100); await foto('liquidacion-detalle');
    await tam(1440, 900); await click('Variables del mes'); await tam(1440, 1500); await foto('variables-mes', '.ant-modal-container'); await cerrarModal();
    await tam(1440, 900); await click('Cerrar mes'); await foto('cerrar-mes', '.ant-popover', 30); await click('No');
    await elegir(0, '2026-09 · cerrado'); await esperar(800); await foto('liquidacion-cerrado', '.ant-card');
  },
  async transferencias() {
    await tam(1440, 1000); await ir('Transferencias'); await esperar(800); await foto('transferencias');
    await desplegar(0); await foto('transferencias-pagos'); await desplegar(0);
    await click('Marcar pagado'); await foto('marcar-pagado', '.ant-modal-container'); await cerrarModal();
  },
  async historial() {
    await tam(1440, 1000); await ir('Historial'); await elegir(0, 'Pérez, Ana'); await esperar(800); await foto('historial');
  },
  async movimientos() {
    await tam(1440, 1000); await ir('Movimientos'); await esperar(800); await foto('movimientos');
    await click('Nuevo movimiento'); await foto('nuevo-movimiento', '.ant-modal-container'); await cerrarModal();
    await click('Transferencia entre cuentas'); await foto('transferencia-cuentas', '.ant-modal-container'); await cerrarModal();
  },
  async deptos() {
    await tam(1440, 900); await ir('Deptos'); await foto('deptos');
    await click('Variables'); await foto('variables-depto', '.ant-modal-container'); await cerrarModal();
  },
  async propietarios() {
    await tam(1440, 900); await ir('Propietarios'); await foto('propietarios');
    await click('Datos fiscales'); await tam(1440, 1100); await foto('datos-fiscales', '.ant-modal-container'); await cerrarModal();
  },
  async cuentas() {
    await tam(1440, 1000); await ir('Cuentas'); await foto('cuentas');
  },
  async emisores() {
    await tam(1440, 800); await ir('Emisores'); await foto('emisores');
    await click('Nuevo emisor'); await tam(1440, 1200); await foto('nuevo-emisor', '.ant-modal-container'); await cerrarModal();
    await tam(1440, 900); await click('Certificado'); await foto('certificado', '.ant-modal-container'); await cerrarModal();
  },
  async stays() {
    await tam(1440, 1100); await ir('Stays'); await esperar(800); await foto('stays');
    await click('Ajustes'); await foto('ajustes-reserva', '.ant-modal-container'); await cerrarModal();
  },
  async importar() {
    await tam(1440, 800); await ir('Importar Excel'); await foto('importar');
  },
  async terminales() {
    await tam(1440, 800); await ir('Terminales'); await click('Generar código');
    // El nombre real de esta PC no va al manual.
    await js(`(() => { const t = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = t.nextNode())) n.nodeValue = n.nodeValue.replace(/motomila/gi, 'PC-OFICINA'); })()`);
    await foto('terminales');
  },
  // Último de los de la app: registra un pago (cambia los datos de demo).
  async facturar() {
    await tam(1440, 1000); await ir('Transferencias'); await esperar(800);
    // El primero (BOS, de Pérez, Ana): tiene los datos fiscales completos.
    await js(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Marcar pagado').click()`); await esperar(800);
    await elegir(0, 'Banco Ejemplo'); await click('Marcar pagado', '.ant-modal-footer button');
    await esperar(1500); await foto('facturar-pago', '.ant-modal-container');
  },
  async pdf() {
    await tam(900, 1270); await w.loadURL(`${URL}/?imprimir=1&mes=2026-09&depto=ALM`); await esperar(2500); await foto('pdf-liquidacion');
    await tam(900, 380); await w.loadURL(`${URL}/?imprimir=1&comprobante=1`); await esperar(2500); await foto('pdf-factura');
  },
  async terminal() {
    await tam(1000, 700); await w.loadFile(join(import.meta.dirname, '..', 'electron', 'terminal.html')); await esperar(800); await foto('terminal-conectar');
  },
};

app.whenReady().then(async () => {
  w = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  w.webContents.setFrameRate(30);
  await w.loadURL(URL);
  await esperar(2500);
  for (const [nombre, paso] of Object.entries(pasos)) {
    if (SOLO && !SOLO.split(',').includes(nombre)) continue;
    try { await paso(); } catch (e) { console.error('FALLO', nombre, e.message); }
    if (nombre !== 'pdf' && nombre !== 'terminal') { await cerrarModal(); }
  }
  app.quit();
});
