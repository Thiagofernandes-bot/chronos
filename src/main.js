'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, powerMonitor, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');

const { autoUpdater } = require('electron-updater');

const { Store, dateKey } = require('./store');
const { Tracker } = require('./tracker');

const RES_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'probe')
  : path.join(__dirname, '..', 'resources');
const PROBE = path.join(RES_DIR, 'chronos-probe.exe');

// Modo portatil / demonstracao: guarda tudo numa pasta escolhida por fora.
if (process.env.CHRONOS_DATA) {
  try { app.setPath('userData', process.env.CHRONOS_DATA); } catch (e) { /* ignora */ }
}

let store = null;
let tracker = null;
let win = null;
let tray = null;
let probe = null;
let probeRetry = null;
let quitting = false;
let systemPaused = false;
let probeError = null;
let liveCache = { at: 0, activeMs: 0, productiveMs: 0, idleMs: 0 };

/* ------------------------------------------------------------------ probe */

function startProbe() {
  if (quitting || probe) return;
  if (!fs.existsSync(PROBE)) {
    probeError = 'Não encontrei o chronos-probe.exe em ' + RES_DIR;
    pushLive();
    return;
  }
  try {
    probe = spawn(PROBE, ['--interval', String(store.settings.interval), '--parent', String(process.pid)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    probeError = 'Falha ao iniciar o rastreador: ' + e.message;
    pushLive();
    return;
  }
  probeError = null;

  const rl = readline.createInterface({ input: probe.stdout });
  rl.on('line', (line) => {
    if (!line) return;
    let sample;
    try { sample = JSON.parse(line); } catch (e) { return; }
    if (sample.error) { probeError = sample.error; return; }
    store.rememberApp(sample.exe, sample.path);
    tracker.feed(sample);
    pushLive();
  });

  probe.stderr.on('data', (d) => console.error('[probe]', String(d).trim()));
  probe.on('exit', (code) => {
    probe = null;
    if (quitting) return;
    tracker.flush();
    probeError = 'O rastreador parou (código ' + code + '). Reiniciando…';
    probeRetry = setTimeout(startProbe, 3000);
  });
}

function stopProbe() {
  if (probeRetry) { clearTimeout(probeRetry); probeRetry = null; }
  if (probe) { try { probe.kill(); } catch (e) { /* ignora */ } probe = null; }
}

function restartProbe() {
  stopProbe();
  startProbe();
}

/* ------------------------------------------------------------- pausa/live */

function applyPause() {
  const paused = systemPaused || !!store.settings.paused;
  if (paused) tracker.pause(); else tracker.resume();
  refreshTray();
}

function todayTotals() {
  const now = Date.now();
  if (now - liveCache.at < 4000) return liveCache;
  const key = dateKey(now);
  const agg = store.aggregate(key, key);
  liveCache = { at: now, activeMs: agg.activeMs, productiveMs: agg.productiveMs, idleMs: agg.idleMs };
  return liveCache;
}

function liveState() {
  const t = todayTotals();
  return {
    current: tracker.snapshot(),
    activeMs: t.activeMs,
    productiveMs: t.productiveMs,
    idleMs: t.idleMs,
    focusGoalMin: store.settings.focusGoalMin,
    paused: systemPaused || !!store.settings.paused,
    systemPaused,
    error: probeError
  };
}

function pushLive() {
  if (win && !win.isDestroyed()) win.webContents.send('live', liveState());
}

/* ------------------------------------------------------------------ icones */

// Icone real de cada programa, extraido do proprio executavel pelo Windows.
// Fica em memoria porque a extracao e barata e o caminho pode mudar.
const iconCache = {};

async function iconFor(exe) {
  const key = (exe || '').toLowerCase();
  if (!key) return null;
  if (key in iconCache) return iconCache[key];

  const exePath = store.apps[key];
  if (!exePath || !fs.existsSync(exePath)) { iconCache[key] = null; return null; }
  try {
    const img = await app.getFileIcon(exePath, { size: 'large' });
    iconCache[key] = img && !img.isEmpty() ? img.toDataURL() : null;
  } catch (e) {
    iconCache[key] = null;
  }
  return iconCache[key];
}

async function iconsFor(list) {
  const out = {};
  for (const exe of list || []) {
    const data = await iconFor(exe);
    if (data) out[String(exe).toLowerCase()] = data;
  }
  return out;
}

// Icone dos sites. Diferente dos programas, este e o unico ponto do Chronos
// que fala com a internet — por isso so funciona se o usuario ligar.
let favicons = null;

function faviconPath() { return path.join(store.dir, 'favicons.json'); }

function loadFavicons() {
  if (favicons) return favicons;
  try { favicons = JSON.parse(fs.readFileSync(faviconPath(), 'utf8')); } catch (e) { favicons = {}; }
  return favicons;
}

let faviconSaveTimer = null;
function saveFaviconsSoon() {
  if (faviconSaveTimer) return;
  faviconSaveTimer = setTimeout(() => {
    faviconSaveTimer = null;
    try { fs.writeFileSync(faviconPath(), JSON.stringify(favicons), 'utf8'); } catch (e) { /* ignora */ }
  }, 2000);
}

async function faviconFor(dom) {
  const cache = loadFavicons();
  if (dom in cache) return cache[dom] || null;
  try {
    const res = await net.fetch('https://icons.duckduckgo.com/ip3/' + encodeURIComponent(dom) + '.ico');
    if (!res.ok) throw new Error('http ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || 'image/x-icon';
    cache[dom] = buf.length > 70 && buf.length < 400000
      ? 'data:' + type + ';base64,' + buf.toString('base64')
      : 0;
  } catch (e) {
    cache[dom] = 0;
  }
  saveFaviconsSoon();
  return cache[dom] || null;
}

async function siteIconsFor(list) {
  if (!store.settings.siteIcons) return {};
  const out = {};
  for (const dom of (list || []).slice(0, 60)) {
    const data = await faviconFor(String(dom).toLowerCase());
    if (data) out[String(dom).toLowerCase()] = data;
  }
  return out;
}

/* ---------------------------------------------------------------- formato */

function fmt(ms) {
  const total = Math.round(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return h + 'h ' + m + 'min';
  if (h) return h + 'h';
  return m + 'min';
}

/* -------------------------------------------------------------- bandeja */

function trayIcon() {
  for (const name of ['tray.png', 'icon.png']) {
    const p = path.join(RES_DIR, name);
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
  }
  return nativeImage.createEmpty();
}

function refreshTray() {
  if (!tray) return;
  const t = todayTotals();
  const paused = systemPaused || !!store.settings.paused;
  tray.setToolTip('Chronos — ' + fmt(t.activeMs) + ' hoje' + (paused ? ' (pausado)' : ''));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Chronos — ' + fmt(t.activeMs) + ' hoje', enabled: false },
    { type: 'separator' },
    { label: 'Abrir painel', click: showWindow },
    {
      label: paused ? 'Retomar rastreio' : 'Pausar rastreio',
      click: () => { store.saveSettings({ paused: !store.settings.paused }); applyPause(); pushLive(); }
    },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', () => {
    if (win && win.isVisible() && !win.isMinimized()) win.hide();
    else showWindow();
  });
  refreshTray();
  setInterval(refreshTray, 30000);
}

/* --------------------------------------------------------------- janela */

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function overlayColors() {
  const dark = store.settings.theme !== 'light';
  return {
    color: dark ? '#080b0a' : '#ffffff',
    symbolColor: dark ? '#ffffff' : '#040605',
    height: 44
  };
}

function createWindow() {
  const b = store.settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1260,
    height: b.height || 840,
    x: b.x,
    y: b.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: store.settings.theme === 'light' ? '#f1f4f2' : '#040605',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.env.CHRONOS_SHOT) {
    win.webContents.on('console-message', (event) => console.log('[renderer]', event.message));
  }

  win.once('ready-to-show', () => {
    if (!app.commandLine.hasSwitch('hidden') && !process.argv.includes('--hidden')) win.show();
    if (process.env.CHRONOS_SHOT) screenshotRun(process.env.CHRONOS_SHOT);
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    store.saveSettings({ bounds: win.getBounds() });
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);

  win.on('close', (e) => {
    if (!quitting && store.settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------ atualizacao */

// Busca a versão nova no GitHub Releases, baixa em segundo plano e instala
// quando o app fecha. Só funciona empacotado: em desenvolvimento fica quieto.
const updateState = { status: 'idle', version: null, percent: 0, error: null };

function updateInfo() {
  return {
    status: updateState.status,
    version: updateState.version,
    percent: updateState.percent,
    error: updateState.error,
    current: app.getVersion()
  };
}

function pushUpdate(status) {
  if (status) updateState.status = status;
  if (win && !win.isDestroyed()) win.webContents.send('update', updateInfo());
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  updateState.error = null;
  autoUpdater.checkForUpdates().catch((e) => {
    updateState.error = e && e.message ? e.message : String(e);
    pushUpdate('error');
  });
}

function setupUpdater() {
  if (!app.isPackaged) { updateState.status = 'dev'; return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => pushUpdate('checking'));
  autoUpdater.on('update-available', (i) => { updateState.version = i.version; pushUpdate('downloading'); });
  autoUpdater.on('update-not-available', () => pushUpdate('latest'));
  autoUpdater.on('download-progress', (p) => {
    updateState.percent = Math.round(p.percent || 0);
    pushUpdate('downloading');
  });
  autoUpdater.on('update-downloaded', (i) => { updateState.version = i.version; pushUpdate('ready'); });
  autoUpdater.on('error', (err) => {
    updateState.error = err && err.message ? err.message : String(err);
    pushUpdate('error');
  });

  setTimeout(checkForUpdates, 8000);
  setInterval(checkForUpdates, 6 * 3600 * 1000);
}

/* ------------------------------------------------- captura para revisao */

// Usado so em desenvolvimento (CHRONOS_SHOT=pasta): percorre as telas e
// salva um PNG de cada uma para conferir o visual.
async function screenshotRun(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    fs.mkdirSync(dir, { recursive: true });
    await wait(2200);
    const run = (js) => win.webContents.executeJavaScript(js);
    const shot = async (name) => {
      const now = await run('document.querySelector("#now").innerHTML.length');
      console.log('[shot]', name, 'cartao agora:', now, 'chars');
      fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    const go = async (page) => {
      await run('document.querySelector(\'[data-page="' + page + '"]\').click()');
      await wait(900);
    };

    for (const page of ['hoje', 'apps', 'sites', 'cats', 'hist', 'set']) {
      await go(page);
      await shot(page);
    }

    await go('hoje');
    await run('document.querySelector("#view").scrollTop = 99999');
    await wait(500);
    await shot('hoje-fim');

    await go('apps');
    await run('document.querySelector(".row").click()');
    await wait(600);
    console.log('[shot] linhas abertas:', await run('document.querySelectorAll(".detail").length'));
    await shot('apps-aberto');

    await go('set');
    await run('var s=document.querySelector(\'[data-set="theme"]\');s.value="light";'
      + 's.dispatchEvent(new Event("change",{bubbles:true}))');
    await wait(1200);
    await go('hoje');
    await shot('hoje-claro');
    await run('var s=document.querySelector(\'[data-page="set"]\')&&0;');
  } catch (e) {
    console.error('[shot]', e.message);
  }
  quitting = true;
  app.quit();
}

/* ------------------------------------------------------------------- ipc */

function registerIpc() {
  ipcMain.handle('stats', (e, from, to) => store.aggregate(from, to));
  ipcMain.handle('live', () => liveState());
  ipcMain.handle('days', () => store.availableDays());
  ipcMain.handle('icons', (e, list) => iconsFor(list));
  ipcMain.handle('site-icons', (e, list) => siteIconsFor(list));
  ipcMain.handle('settings:get', () => store.settings);

  ipcMain.handle('settings:set', (e, patch) => {
    const before = store.settings;
    const intervalChanged = patch.interval && patch.interval !== before.interval;
    store.saveSettings(patch);

    if (patch.idleAfter || patch.interval) {
      tracker.setConfig({ interval: store.settings.interval, idleAfter: store.settings.idleAfter });
    }
    if ('paused' in patch) applyPause();
    if ('autostart' in patch) {
      app.setLoginItemSettings({ openAtLogin: !!patch.autostart, args: ['--hidden'] });
    }
    if ('theme' in patch && win && !win.isDestroyed()) {
      try { win.setTitleBarOverlay(overlayColors()); } catch (err) { /* ignora */ }
    }
    if (intervalChanged) restartProbe();
    if ('categories' in patch) { store.cache.clear(); liveCache.at = 0; }
    return store.settings;
  });

  ipcMain.handle('export', async (e, from, to) => {
    const csv = store.exportCsv(from, to);
    const res = await dialog.showSaveDialog(win, {
      title: 'Exportar tempos',
      defaultPath: 'chronos-' + from + '_a_' + to + '.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false };
    // BOM para o Excel abrir com acentos corretos
    fs.writeFileSync(res.filePath, '﻿' + csv, 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('open-data', () => shell.openPath(store.dataDir));

  ipcMain.handle('clear', () => {
    tracker.flush();
    store.clearAll();
    liveCache.at = 0;
    return true;
  });

  ipcMain.handle('update:state', () => updateInfo());
  ipcMain.handle('update:check', () => { checkForUpdates(); return updateInfo(); });
  ipcMain.handle('update:install', () => {
    if (updateState.status !== 'ready') return false;
    quitting = true;
    stopProbe();
    tracker.flush();
    store.flush();
    autoUpdater.quitAndInstall();
    return true;
  });

  ipcMain.handle('win', (e, action) => {
    if (!win) return;
    if (action === 'hide') win.hide();
    if (action === 'minimize') win.minimize();
  });

  ipcMain.handle('quit', () => { quitting = true; app.quit(); });
}

/* ------------------------------------------------------------------ boot */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    tracker = new Tracker({
      interval: store.settings.interval,
      idleAfter: store.settings.idleAfter
    });

    tracker.on('segment', (seg) => { store.add(seg); liveCache.at = 0; });
    tracker.on('change', () => { refreshTray(); });

    registerIpc();
    createWindow();
    createTray();
    startProbe();
    applyPause();
    setupUpdater();

    setInterval(() => {
      tracker.checkpoint(5 * 60 * 1000);
      store.flush();
    }, 15000);

    powerMonitor.on('lock-screen', () => { systemPaused = true; applyPause(); });
    powerMonitor.on('unlock-screen', () => { systemPaused = false; applyPause(); });
    powerMonitor.on('suspend', () => { systemPaused = true; applyPause(); store.flush(); });
    powerMonitor.on('resume', () => { systemPaused = false; applyPause(); });
    powerMonitor.on('shutdown', () => { quitting = true; tracker.flush(); store.flush(); app.quit(); });
  });

  app.on('before-quit', () => {
    quitting = true;
    stopProbe();
    if (tracker) tracker.flush();
    if (store) store.flush();
  });

  app.on('window-all-closed', (e) => { /* vive na bandeja */ });
}
