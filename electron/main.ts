// Proceso principal. La PC es servidor (abre la base, levanta la API en la red, hace backups y
// muestra la ventana) o terminal (solo una ventana con la app de otra PC servidor, fase 5d).
// En desarrollo, Vite corre como middleware del mismo Express (un solo puerto, con HMR).
import { app, BrowserWindow, dialog, safeStorage, session, shell } from 'electron';
import express from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { abrirDb } from '../server/db.ts';
import { crearApp, type AlmacenCredenciales, type GeneradorPdf } from '../server/app.ts';
import type { AlmacenClaves } from '../server/emisores.ts';
import { respaldar } from '../server/backup.ts';

const PUERTO = 4310;
// Escucha en la red para las terminales; desde otra PC la API exige emparejar (server/terminales.ts).
const HOST = '0.0.0.0';
const ORIGEN_LOCAL = `http://127.0.0.1:${PUERTO}`;
const RAIZ = join(import.meta.dirname, '..');
const BACKUP_CADA_MS = 6 * 60 * 60 * 1000;

// ---- Rol de la PC, en rol.json (userData). Una terminal guarda además la dirección del servidor.
interface Rol { rol: 'servidor' | 'terminal'; servidor?: string }
const rutaRol = () => join(app.getPath('userData'), 'rol.json');
const guardarRol = (r: Rol) => writeFileSync(rutaRol(), JSON.stringify(r));

async function rolDeEstaPc(): Promise<Rol> {
  try {
    return JSON.parse(readFileSync(rutaRol(), 'utf8'));
  } catch { /* primera vez */ }
  // Una instalación que ya tiene la base es el servidor (las de antes de la fase 5d): no se pregunta.
  let rol: Rol = { rol: 'servidor' };
  if (!existsSync(join(app.getPath('userData'), 'hornera.db'))) {
    const { response } = await dialog.showMessageBox({
      type: 'question', title: 'Hornera', message: '¿Qué es esta PC?',
      detail: 'El servidor guarda los datos. Una terminal usa los datos de otra PC servidor de la red local.',
      buttons: ['Servidor (los datos están acá)', 'Terminal (se conecta a otra PC)'], defaultId: 0, cancelId: 0,
    });
    if (response === 1) rol = { rol: 'terminal' };
  }
  guardarRol(rol);
  return rol;
}

// Manual de usuario: viaja dentro del instalador (extraResources). Cada PC abre su copia, también una terminal.
const MANUAL = app.isPackaged ? join(process.resourcesPath, 'manual.pdf') : join(RAIZ, 'manual', 'Manual de usuario Hornera.pdf');

// La ventana solo muestra la app: sin ventanas nuevas, sin permisos. Navegar fuera, lo decide cada rol.
// Única excepción: el link /manual.pdf abre el manual con el visor de PDF de Windows.
function crearVentana() {
  const ventana = new BrowserWindow({ width: 1280, height: 800, title: 'Hornera', autoHideMenuBar: true });
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    // openPath no tira: devuelve el error como texto ('' si abrió).
    if (URL.canParse(url) && new URL(url).pathname === '/manual.pdf') {
      shell.openPath(MANUAL).then((error) => {
        if (error) dialog.showErrorBox('Manual de usuario', `No se pudo abrir el manual (${MANUAL}): ${error}`);
      });
    }
    return { action: 'deny' };
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permiso, responder) => responder(false));
  ventana.maximize();
  return ventana;
}

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

// Clave privada del certificado de ARCA de cada emisor, cifrada igual que la de Stays: un archivo
// por CUIT, fuera de la base y de los backups. Sin cifrado disponible no se guarda (nunca en claro).
function almacenClaves(): AlmacenClaves {
  const ruta = (cuit: string) => join(app.getPath('userData'), `arca-${cuit.replace(/\D/g, '')}.key`);
  return {
    leer(cuit) {
      if (!existsSync(ruta(cuit))) return null;
      try {
        return safeStorage.decryptString(readFileSync(ruta(cuit)));
      } catch (e) {
        console.error('No se pudo leer la clave de ARCA:', e);
        return null;
      }
    },
    guardar(cuit, keyPem) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no permite cifrar la clave en esta PC.');
      writeFileSync(ruta(cuit), safeStorage.encryptString(keyPem));
    },
  };
}

// PDF de la hoja de un depto: la vista imprimible de la app en una ventana oculta + printToPDF.
// La vista marca document.body.dataset.listo ('1' o el mensaje de error) cuando terminó de cargar.
function generadorPdf(origen: string): GeneradorPdf {
  return {
    async generar(ruta) {
      const ventana = new BrowserWindow({ show: false, width: 900, height: 1200 });
      try {
        await ventana.loadURL(origen + ruta);
        let estado: string | undefined;
        for (let i = 0; i < 150 && !estado; i++) {
          estado = await ventana.webContents.executeJavaScript('document.body.dataset.listo');
          if (!estado) await new Promise((ok) => setTimeout(ok, 100));
        }
        if (estado !== '1') throw new Error(`No se pudo armar la hoja: ${estado ?? 'tardó demasiado'}`);
        return await ventana.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
      } finally {
        ventana.destroy();
      }
    },
    carpeta: (mes) => join(app.getPath('documents'), 'Hornera', 'Liquidaciones', mes),
    abrir: (ruta) => { shell.openPath(ruta); },
  };
}

async function iniciarServidor() {
  const db = abrirDb(join(app.getPath('userData'), 'hornera.db'));
  const carpetaBackups = join(app.getPath('userData'), 'backups');
  const api = crearApp(db, app.getVersion(), { credenciales: almacenCredenciales(), claves: almacenClaves(), pdf: generadorPdf(ORIGEN_LOCAL), desarrollo: !app.isPackaged, carpetaBackups });
  const http = createServer(api);

  if (app.isPackaged) {
    api.use(express.static(join(RAIZ, 'dist')));
  } else {
    const { createServer: crearVite } = await import('vite');
    // allowedHosts: el Host ya lo filtra la API (crearApp); así una terminal también anda en desarrollo.
    const vite = await crearVite({ root: RAIZ, server: { middlewareMode: true, hmr: { server: http }, allowedHosts: true }, appType: 'spa' });
    api.use(vite.middlewares);
  }
  await new Promise<void>((ok, error) => http.once('error', error).listen(PUERTO, HOST, ok));

  const backup = (avisar: boolean) => {
    try {
      respaldar(db, carpetaBackups);
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

  const ventana = crearVentana();
  ventana.on('session-end', () => cerrar(false)); // evento de ventana, solo Windows
  ventana.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== ORIGEN_LOCAL) e.preventDefault(); });
  await ventana.loadURL(ORIGEN_LOCAL);
}

// "PC-OFICINA", "192.168.0.10:4310" o "http://pc-oficina" → "http://pc-oficina:4310".
function origenServidor(texto: string) {
  const u = new URL(/^https?:\/\//.test(texto) ? texto : `http://${texto}`);
  if (!u.port) u.port = String(PUERTO);
  return u.origin;
}

// Terminal: la ventana abre la app del servidor (la interfaz y la API son las suyas, así que la
// versión de esta PC no importa). Sin servidor o si no responde, muestra terminal.html para elegirlo.
function iniciarTerminal(rol: Rol) {
  const ventana = crearVentana();
  const pantalla = join(import.meta.dirname, 'terminal.html');
  const configurar = (error?: string) => ventana.loadFile(pantalla, { query: { ...(error && { error }), ...(rol.servidor && { servidor: rol.servidor }) } });

  ventana.webContents.on('will-navigate', (e, url) => {
    const u = new URL(url);
    if (u.protocol !== 'file:') {
      if (u.origin !== rol.servidor) e.preventDefault();
      return;
    }
    e.preventDefault(); // el formulario de terminal.html: se resuelve acá
    if (u.searchParams.get('rol') === 'servidor') {
      guardarRol({ rol: 'servidor' });
      app.relaunch();
      app.quit();
      return;
    }
    try {
      rol.servidor = origenServidor(u.searchParams.get('conectar')?.trim() ?? '');
    } catch {
      configurar('Esa dirección no es válida.');
      return;
    }
    guardarRol(rol);
    ventana.loadURL(rol.servidor);
  });
  ventana.webContents.on('did-fail-load', (_e, codigo, descripcion, url, principal) => {
    // -3: navegación reemplazada por otra, no es una falla.
    if (principal && codigo !== -3 && url.startsWith('http')) configurar(`No se pudo conectar con ${rol.servidor} (${descripcion}). ¿Está abierta Hornera en el servidor?`);
  });

  // Algo responde en esa dirección pero con error (p. ej. 403 por un nombre que el servidor no
  // reconoce): sin esto la ventana queda mostrando el error, sin forma de volver a terminal.html.
  ventana.webContents.on('did-navigate', (_e, url, codigo) => {
    if (url.startsWith('http') && codigo >= 400) configurar(`El servidor ${rol.servidor} respondió con error ${codigo}. Revisá la dirección (usá el nombre que muestra Terminales en el servidor).`);
  });

  if (rol.servidor) ventana.loadURL(rol.servidor);
  else configurar();
}

async function iniciar() {
  const rol = await rolDeEstaPc();
  if (rol.rol === 'terminal') iniciarTerminal(rol);
  else await iniciarServidor();
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
