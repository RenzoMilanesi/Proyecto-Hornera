// Proceso principal: abre la base, levanta la API y muestra la ventana.
// En desarrollo, Vite corre como middleware del mismo Express (un solo puerto, con HMR).
import { app, BrowserWindow, dialog, safeStorage, session } from 'electron';
import express from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { abrirDb } from '../server/db.ts';
import { crearApp, type AlmacenCredenciales } from '../server/app.ts';
import { respaldar } from '../server/backup.ts';

const PUERTO = 4310;
// ponytail: solo 127.0.0.1 hasta el modo servidor/terminal (fase 5), que escucha en la LAN con emparejamiento.
const HOST = '127.0.0.1';
const RAIZ = join(import.meta.dirname, '..');
const BACKUP_CADA_MS = 6 * 60 * 60 * 1000;

// Credenciales de Stays cifradas con DPAPI de Windows: solo las descifra este
// usuario en esta PC. Archivo aparte de la base, así no viajan en los backups.
function almacenCredenciales(): AlmacenCredenciales {
  const ruta = join(app.getPath('userData'), 'stays.cred');
  return {
    leer() {
      if (!existsSync(ruta)) return null;
      try {
        return JSON.parse(safeStorage.decryptString(readFileSync(ruta)));
      } catch (e) {
        // Cifrado por otro usuario u otra PC (carpeta copiada): se vuelve a pedir la clave.
        console.error('No se pudieron leer las credenciales de Stays:', e);
        return null;
      }
    },
    guardar(c) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no permite cifrar la clave en esta PC.');
      writeFileSync(ruta, safeStorage.encryptString(JSON.stringify(c)));
    },
  };
}

async function iniciar() {
  const db = abrirDb(join(app.getPath('userData'), 'hornera.db'));
  const api = crearApp(db, app.getVersion(), { credenciales: almacenCredenciales() });
  const http = createServer(api);

  if (app.isPackaged) {
    api.use(express.static(join(RAIZ, 'dist')));
  } else {
    const { createServer: crearVite } = await import('vite');
    const vite = await crearVite({ root: RAIZ, server: { middlewareMode: true, hmr: { server: http } }, appType: 'spa' });
    api.use(vite.middlewares);
  }
  await new Promise<void>((ok, error) => http.once('error', error).listen(PUERTO, HOST, ok));

  const backup = (avisar: boolean) => {
    try {
      respaldar(db, join(app.getPath('userData'), 'backups'));
    } catch (e) {
      if (avisar) dialog.showErrorBox('Copia de seguridad', String(e instanceof Error ? e.message : e));
      else console.error(e);
    }
  };

  // Backup periódico, por si la PC se corta sin cerrar la app (luz, botón).
  // Sin diálogo: un aviso cada 6 h con la carpeta caída molesta más de lo que ayuda.
  const periodico = setInterval(() => backup(false), BACKUP_CADA_MS);

  // Backup al salir. En Windows, apagar o cerrar sesión con la app abierta no
  // emite before-quit sino session-end; ahí sin diálogo, que trabaría el apagado.
  let cerrado = false;
  const cerrar = (avisar: boolean) => {
    if (cerrado) return;
    cerrado = true;
    clearInterval(periodico);
    backup(avisar);
    db.close();
  };
  app.on('before-quit', () => cerrar(true));

  const ventana = new BrowserWindow({ width: 1280, height: 800, title: 'Hornera', autoHideMenuBar: true });
  ventana.on('session-end', () => cerrar(false)); // evento de ventana, solo Windows
  // La ventana solo muestra la app: sin ventanas nuevas, sin navegar a otros sitios, sin permisos.
  const origen = `http://${HOST}:${PUERTO}`;
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ventana.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origen) e.preventDefault(); });
  session.defaultSession.setPermissionRequestHandler((_wc, _permiso, responder) => responder(false));
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
