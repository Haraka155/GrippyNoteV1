const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, screen, globalShortcut, dialog, shell
} = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const os     = require('os');

const isMac = process.platform === 'darwin';

// ─── Paths ────────────────────────────────────────────────────────────────────
const dataDir    = path.join(app.getPath('userData'), 'notes');
const notesFile  = path.join(dataDir, 'notes.enc');
const legacyFile = path.join(dataDir, 'notes.json');

let mainWindow  = null;
let tray        = null;
let isPinned    = false;
app.isQuitting  = false;

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ─── Encryption ───────────────────────────────────────────────────────────────
function getKey() {
  return crypto.createHash('sha256')
    .update(`grippynote-${os.hostname()}-${app.getPath('userData')}`)
    .digest();
}
function encryptNotes(text) {
  const key = getKey(), iv = crypto.randomBytes(16);
  const c   = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decryptNotes(b64) {
  const key = getKey(), buf = Buffer.from(b64, 'base64');
  const d   = crypto.createDecipheriv('aes-256-gcm', key, buf.slice(0, 16));
  d.setAuthTag(buf.slice(16, 32));
  return d.update(buf.slice(32), undefined, 'utf8') + d.final('utf8');
}

// ─── Notes I/O ────────────────────────────────────────────────────────────────
function loadNotes() {
  if (fs.existsSync(notesFile)) {
    try { return JSON.parse(decryptNotes(fs.readFileSync(notesFile, 'utf-8'))); } catch {}
  }
  if (fs.existsSync(legacyFile)) {
    try {
      const notes = JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
      saveNotes(notes);
      fs.renameSync(legacyFile, legacyFile + '.migrated');
      return notes;
    } catch {}
  }
  return [];
}
function saveNotes(notes) {
  fs.writeFileSync(notesFile, encryptNotes(JSON.stringify(notes, null, 2)), 'utf-8');
}

// ─── Icon ─────────────────────────────────────────────────────────────────────
function getIconPath() {
  if (isMac) {
    const icns = path.join(__dirname, 'grippynote.icns');
    if (fs.existsSync(icns)) return icns;
    const png = path.join(__dirname, 'grippynote_512.png');
    if (fs.existsSync(png)) return png;
  }
  const ico = path.join(__dirname, 'grippynote.ico');
  if (fs.existsSync(ico)) return ico;
  return path.join(__dirname, 'grippynote_icon_final.svg');
}

// ─── Main window ──────────────────────────────────────────────────────────────
function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 390, height: 600,
    x: width - 430, y: isMac ? 80 : 60,
    frame: false, transparent: true,
    alwaysOnTop: false, skipTaskbar: false,
    resizable: true, minWidth: 320, minHeight: 440,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    icon: getIconPath(),
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });

  // macOS: clicking the red X hides to tray — it does not quit
  if (isMac) {
    mainWindow.on('close', (e) => {
      if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
    });
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Show GrippyNote',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
      },
    },
    { type: 'separator' },
    {
      label:   isMac ? 'Launch at Login' : 'Start with Windows',
      type:    'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click:   (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    {
      label: 'Quit GrippyNote',
      accelerator: isMac ? 'Cmd+Q' : undefined,
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);
}

function createTray() {
  const iconPath = getIconPath();
  let icon = nativeImage.createFromPath(iconPath);
  if (isMac) {
    // macOS menu bar icons should be Template images (black with transparency)
    // Resize to 18x18 for menu bar
    icon = icon.resize({ width: 18, height: 18 });
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.setToolTip('GrippyNote  [Cmd+Shift+G]');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
    } else { createWindow(); }
  });
}

// ─── macOS native app menu (required for Cmd+Q, copy/paste etc.) ─────────────
function setAppMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'GrippyNote',
      submenu: [
        { role: 'about', label: 'About GrippyNote' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit GrippyNote', accelerator: 'Cmd+Q',
          click: () => { app.isQuitting = true; app.quit(); } },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        { type: 'separator' }, { role: 'front' },
      ],
    },
  ]));
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  setAppMenu();
  createWindow();
  createTray();

  // Cmd+Shift+G on Mac, Ctrl+Shift+G on Windows — toggle from anywhere
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
    } else { createWindow(); }
  });
});

// macOS: re-open window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else { mainWindow?.show(); mainWindow?.focus(); }
});

// Keep alive in tray on both platforms
app.on('window-all-closed', () => { /* do not quit */ });
app.on('will-quit',         () => globalShortcut.unregisterAll());
app.on('before-quit',       () => { app.isQuitting = true; tray?.destroy(); });

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('load-notes',      ()         => loadNotes());
ipcMain.handle('save-notes',      (_, notes) => { saveNotes(notes); return true; });
ipcMain.handle('get-platform',    ()         => process.platform);

ipcMain.handle('toggle-pin', () => {
  isPinned = !isPinned;
  mainWindow?.setAlwaysOnTop(isPinned, 'screen-saver');
  return isPinned;
});
ipcMain.handle('get-pin-state',   () => isPinned);
ipcMain.handle('minimize-window', () => mainWindow?.minimize());
ipcMain.handle('close-window',    () => mainWindow?.hide());
ipcMain.handle('set-opacity',     (_, v) => { mainWindow?.setOpacity(v); return v; });

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-autostart', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  tray?.setContextMenu(buildTrayMenu());
  return enabled;
});

ipcMain.on('window-move', (_, { x, y }) => {
  mainWindow?.setPosition(Math.round(x), Math.round(y));
});

// ─── PDF Export ───────────────────────────────────────────────────────────────
ipcMain.handle('export-pdf', async (_, { notes, mode }) => {
  const CM = { yellow:'#fef9c3', blue:'#dbeafe', green:'#dcfce7', pink:'#fce7f3', purple:'#ede9fe', orange:'#ffedd5' };
  const BM = { yellow:'#ca8a04', blue:'#2563eb', green:'#16a34a', pink:'#db2777', purple:'#7c3aed', orange:'#ea580c' };

  const fmt = t => t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/__(.*?)__/g,'<u>$1</u>').replace(/_(.*?)_/g,'<em>$1</em>')
    .replace(/^• (.+)$/gm,'<li>$1</li>').replace(/^(\d+)\. (.+)$/gm,'<li>$2</li>')
    .replace(/\n/g,'<br>');

  const card = n => `<div class="card" style="background:${CM[n.color]||CM.yellow};border-left:4px solid ${BM[n.color]||BM.yellow}">
    <div class="card-title">${n.title||'Untitled'}</div>
    <div class="card-date">${new Date(n.updatedAt||n.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</div>
    <div class="card-body">${fmt(n.content)}</div>
  </div>`;

  const label   = mode==='single' ? (notes[0].title||'GrippyNote') : 'GrippyNote_All_Notes';
  const ptitle  = mode==='single' ? (notes[0].title||'GrippyNote') : 'GrippyNote — All Notes';
  const html    = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Helvetica Neue',Arial,sans-serif;padding:32px;background:#fff;color:#111}
    .header{display:flex;align-items:center;gap:12px;margin-bottom:28px;border-bottom:2px solid #e5e7eb;padding-bottom:16px}
    .header h1{font-size:20px;font-weight:700;color:#1e1e3e}.header span{font-size:12px;color:#888;margin-left:auto}
    .card{border-radius:10px;padding:18px 20px;margin-bottom:20px;page-break-inside:avoid}
    .card-title{font-size:15px;font-weight:700;margin-bottom:4px;color:#1a1a2e}
    .card-date{font-size:10px;color:#666;margin-bottom:10px}
    .card-body{font-size:13px;line-height:1.7;color:#333}.card-body li{margin-left:18px;margin-bottom:2px}
  </style></head><body>
    <div class="header"><h1>📌 ${ptitle}</h1><span>Exported ${new Date().toLocaleDateString(undefined,{dateStyle:'long'})}</span></div>
    ${notes.map(card).join('')}
  </body></html>`;

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title:       'Export as PDF',
    defaultPath: path.join(app.getPath('documents'), `${label.replace(/[/\\?%*:|"<>]/g,'-')}.pdf`),
    filters:     [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false };

  const tmp = path.join(app.getPath('temp'), `gn_${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf-8');
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  try {
    await win.loadFile(tmp);
    await new Promise(r => setTimeout(r, 500));
    const buf = await win.webContents.printToPDF({ pageSize:'A4', printBackground:true, margins:{ marginType:'minimum' } });
    fs.writeFileSync(filePath, buf);
    shell.openPath(filePath);
    return { ok: true };
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmp); } catch {}
  }
});
