// Proceso principal: abre la base, levanta la API y muestra la ventana.
// En desarrollo, Vite corre como middleware del mismo Express (un solo puerto, con HMR).
import { app, BrowserWindow, dialog } from 'electron';
import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { abrirDb } from '../server/db.ts';
import { crearApp } from '../server/app.ts';
import { respaldar } from '../server/backup.ts';

const PUERTO = 4310;
// ponytail: solo 127.0.0.1 hasta el modo servidor/terminal (fase 5), que escucha en la LAN con emparejamiento.
const HOST = '127.0.0.1';
const RAIZ = join(import.meta.dirname, '..');

async function iniciar() {
  const db = abrirDb(join(app.getPath('userData'), 'hornera.db'));
  const api = crearApp(db, app.getVersion());
  const http = createServer(api);

  if (app.isPackaged) {
    api.use(express.static(join(RAIZ, 'dist')));
  } else {
    const { createServer: crearVite } = await import('vite');
    const vite = await crearVite({ root: RAIZ, server: { middlewareMode: true, hmr: { server: http } }, appType: 'spa' });
    api.use(vite.middlewares);
  }
  await new Promise<void>((ok, error) => http.once('error', error).listen(PUERTO, HOST, ok));

  // Backup al salir. En Windows, apagar o cerrar sesión con la app abierta no
  // emite before-quit sino session-end; ahí sin diálogo, que trabaría el apagado.
  let cerrado = false;
  const cerrar = (avisar: boolean) => {
    if (cerrado) return;
    cerrado = true;
    try {
      respaldar(db, join(app.getPath('userData'), 'backups'));
    } catch (e) {
      if (avisar) dialog.showErrorBox('Copia de seguridad', String(e instanceof Error ? e.message : e));
      else console.error(e);
    }
    db.close();
  };
  app.on('before-quit', () => cerrar(true));

  const ventana = new BrowserWindow({ width: 1280, height: 800, title: 'Hornera', autoHideMenuBar: true });
  ventana.on('session-end', () => cerrar(false)); // evento de ventana, solo Windows
  ventana.maximize();
  await ventana.loadURL(`http://${HOST}:${PUERTO}`);
}

// Una sola instancia por PC: si ya está abierta, la segunda trae esa ventana al frente y sale.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const ventana = BrowserWindow.getAllWindows()[0];
    if (ventana?.isMinimized()) ventana.restore();
    ventana?.focus();
  });
  app.whenReady().then(iniciar).catch((e) => {
    dialog.showErrorBox('Hornera no pudo iniciar', String(e?.stack ?? e));
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
