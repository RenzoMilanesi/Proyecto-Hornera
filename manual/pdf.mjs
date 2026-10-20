// manual.html → "Manual de usuario Hornera.pdf". Uso: npx electron manual/pdf.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

app.setName('hornera-manual');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadFile(join(import.meta.dirname, 'manual.html'));
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  const pdf = await w.webContents.printToPDF({
    pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;color:#6B5D52;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>Hornera · Manual de usuario</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  writeFileSync(join(import.meta.dirname, 'Manual de usuario Hornera.pdf'), pdf);
  console.log('PDF listo');
  app.quit();
});
