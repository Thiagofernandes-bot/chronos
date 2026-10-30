'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, powerMonitor, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

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
let liveCache = { at: 0, activeMs: 0, idleMs: 0 };

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
  liveCache = { at: now, activeMs: agg.activeMs, idleMs: agg.idleMs };
  return liveCache;
}

function liveState() {
  const t = todayTotals();
  return {
    current: tracker.snapshot(),
    activeMs: t.activeMs,
    idleMs: t.idleMs,
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

// Quando o Windows não consegue ler o ícone de um .exe ele devolve o ícone
// genérico em vez de falhar. Guardamos como ele é (pedindo o ícone de um
// arquivo que não existe) para reconhecer e procurar o logo em outro lugar.
let iconeGenerico = null;

async function assinaturaDoIconeGenerico() {
  if (iconeGenerico !== null) return iconeGenerico;
  try {
    const falso = path.join(app.getPath('temp'), '__chronos_sem_icone__.exe');
    const img = await app.getFileIcon(falso, { size: 'large' });
    iconeGenerico = img && !img.isEmpty() ? img.toDataURL() : '';
  } catch (e) {
    iconeGenerico = '';
  }
  return iconeGenerico;
}

// App da Microsoft Store: o ícone de verdade é um PNG dentro do pacote.
function iconeDePacoteDaStore(exePath) {
  if (!/\\WindowsApps\\/i.test(exePath)) return null;
  const raiz = (exePath.match(/^(.*\\WindowsApps\\[^\\]+)\\/i) || [])[1];
  const pastaExe = path.dirname(exePath);
  const procurar = [raiz, raiz && path.join(raiz, 'Assets'), raiz && path.join(raiz, 'images'),
    pastaExe, path.join(pastaExe, 'Assets'), path.join(pastaExe, 'images')].filter(Boolean);

  const achados = [];
  for (const dir of procurar) {
    let arquivos = [];
    try { arquivos = fs.readdirSync(dir); } catch (e) { continue; }
    for (const nome of arquivos) {
      if (!/\.png$/i.test(nome) || /contrast/i.test(nome)) continue;
      if (!/(square44x44logo|square71x71logo|square150x150logo|storelogo)/i.test(nome)) continue;
      const alvo = path.join(dir, nome);
      try {
        achados.push({
          alvo,
          tamanho: fs.statSync(alvo).size,
          preferido: /square44x44/i.test(nome) ? 0 : 1
        });
      } catch (e) { /* ignora */ }
    }
  }
  if (!achados.length) return null;

  achados.sort((a, b) => a.preferido - b.preferido || b.tamanho - a.tamanho);
  try {
    const img = nativeImage.createFromPath(achados[0].alvo);
    if (img && !img.isEmpty()) return img.resize({ width: 48, height: 48 }).toDataURL();
  } catch (e) { /* ignora */ }
  return null;
}

// Terceira fonte de ícone: os atalhos do menu iniciar. É assim que jogo de
// Steam se resolve — o executável não tem ícone embutido ("Discovery.exe"),
// mas o atalho aponta para o .ico que o Steam baixou.
let atalhos = null;

function mapaDeAtalhos() {
  if (atalhos) return atalhos;
  atalhos = {};

  const raizes = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.PROGRAMDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];

  const varrer = (dir, nivel) => {
    if (nivel > 2) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const item of itens) {
      const alvo = path.join(dir, item.name);
      if (item.isDirectory()) { varrer(alvo, nivel + 1); continue; }
      if (!/\.url$/i.test(item.name)) continue;
      try {
        const conteudo = fs.readFileSync(alvo, 'utf8');
        const achou = conteudo.match(/^IconFile=(.+)$/im);
        if (!achou) continue;
        const ico = achou[1].trim();
        if (ico) atalhos[chaveDeNome(item.name.replace(/\.url$/i, ''))] = ico;
      } catch (e) { /* atalho ilegível, segue */ }
    }
  };

  for (const raiz of raizes) varrer(raiz, 0);
  return atalhos;
}

function chaveDeNome(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function iconeDeAtalho(nome) {
  const caminho = mapaDeAtalhos()[chaveDeNome(nome)];
  if (!caminho || !fs.existsSync(caminho)) return null;
  try {
    const img = nativeImage.createFromPath(caminho);
    if (img && !img.isEmpty()) return img.resize({ width: 48, height: 48 }).toDataURL();
  } catch (e) { /* ignora */ }
  return null;
}

async function iconFor(exe, nome) {
  const key = (exe || '').toLowerCase();
  if (!key) return null;
  if (key in iconCache) return iconCache[key];

  const exePath = store.apps[key];
  if (!exePath || !fs.existsSync(exePath)) {
    const deAtalho = nome ? iconeDeAtalho(nome) : null;
    iconCache[key] = deAtalho;
    return deAtalho;
  }

  let data = null;
  try {
    const img = await app.getFileIcon(exePath, { size: 'large' });
    data = img && !img.isEmpty() ? img.toDataURL() : null;
  } catch (e) {
    data = null;
  }

  const generico = await assinaturaDoIconeGenerico();
  if (data && generico && data === generico) data = null;
  if (!data) data = iconeDePacoteDaStore(exePath);
  if (!data && nome) data = iconeDeAtalho(nome);

  iconCache[key] = data;
  return data;
}

async function iconsFor(list) {
  const out = {};
  for (const item of list || []) {
    // aceita tanto "chrome" quanto { exe: 'chrome', nome: 'Google Chrome' }
    const exe = typeof item === 'string' ? item : (item && item.exe);
    const nome = typeof item === 'string' ? null : (item && item.nome);
    if (!exe) continue;
    const data = await iconFor(exe, nome);
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

/* -------------------------------------------------------------- sugestoes */

// Único ponto do app que envia alguma coisa para fora, e só quando a pessoa
// escreve e clica. A chave abaixo é publicável de propósito: a tabela tem RLS
// que aceita inserir e proíbe ler, então ninguém enxerga a sugestão de outro.
const SUGESTOES_URL = 'https://dnjitxyewyhiomodicqz.supabase.co/rest/v1/chronos_sugestoes';
const SUGESTOES_CHAVE = 'sb_publishable_YvQD5-sAz9wSmOW6ZUifAw_0FhdzcYI';

let ultimoEnvio = 0;

async function enviarSugestao(texto, nome) {
  const limpo = String(texto || '').trim();
  if (limpo.length < 3) return { ok: false, erro: 'Escreva um pouco mais.' };
  if (limpo.length > 2000) return { ok: false, erro: 'Passou de 2000 caracteres.' };
  if (Date.now() - ultimoEnvio < 15000) {
    return { ok: false, erro: 'Espere alguns segundos antes de enviar outra.' };
  }

  if (!store.settings.instalacao) store.saveSettings({ instalacao: randomUUID() });

  try {
    const res = await net.fetch(SUGESTOES_URL, {
      method: 'POST',
      headers: {
        apikey: SUGESTOES_CHAVE,
        Authorization: 'Bearer ' + SUGESTOES_CHAVE,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        texto: limpo,
        nome: (String(nome || '').trim().slice(0, 80)) || null,
        versao: app.getVersion(),
        instalacao: store.settings.instalacao
      })
    });

    if (!res.ok) {
      return { ok: false, erro: 'O servidor recusou o envio (código ' + res.status + ').' };
    }

    ultimoEnvio = Date.now();
    const enviadas = (store.settings.sugestoesEnviadas || []).concat([{ texto: limpo, em: Date.now() }]);
    store.saveSettings({ sugestoesEnviadas: enviadas.slice(-30) });
    return { ok: true, enviadas: store.settings.sugestoesEnviadas };
  } catch (e) {
    return { ok: false, erro: 'Não consegui falar com o servidor. Sem internet?' };
  }
}

/* ------------------------------------------------------------ atualizacao */

// Busca a versão nova no GitHub Releases, baixa em segundo plano e instala
// quando o app fecha. Só funciona empacotado: em desenvolvimento fica quieto.
const updateState = { status: 'idle', version: null, percent: 0, error: null, notas: '' };

function updateInfo() {
  return {
    status: updateState.status,
    version: updateState.version,
    percent: updateState.percent,
    error: updateState.error,
    notas: updateState.notas,
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
  autoUpdater.on('update-downloaded', (i) => {
    updateState.version = i.version;
    // as notas vêm do texto da release no GitHub
    const notas = typeof i.releaseNotes === 'string' ? i.releaseNotes : '';
    updateState.notas = notas
      .replace(/<[^>]+>/g, ' ')        // a GitHub às vezes devolve HTML
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 400);
    pushUpdate('ready');
  });
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

    // flagra da abertura, enquanto a marca ainda está girando
    await wait(420);
    fs.writeFileSync(path.join(dir, 'abertura.png'), (await win.webContents.capturePage()).toPNG());
    await wait(1800);
    const run = (js) => win.webContents.executeJavaScript(js);
    const shot = async (name) => {
      // Janela atrás das outras não gera quadros novos: força o redesenho
      // para não fotografar a tela anterior.
      win.webContents.invalidate();
      await wait(400);
      const tela = await run('document.querySelector("#pageTitle").textContent');
      // A primeira captura costuma vir do quadro antigo; a segunda já é a atual.
      await win.webContents.capturePage();
      await wait(300);
      console.log('[shot]', name, '->', tela);
      fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    // Espera a tela realmente trocar (o item do menu fica ativo) em vez de
    // chutar um tempo fixo, e mede quanto demorou.
    const go = async (page) => {
      const t0 = Date.now();
      await run('document.querySelector(\'[data-page="' + page + '"]\').click()');
      for (let i = 0; i < 60; i++) {
        const pronto = await run(
          'document.querySelector(\'[data-page="' + page + '"]\').classList.contains("on")');
        if (pronto) break;
        await wait(100);
      }
      await wait(250);
      console.log('[shot] troca para ' + page + ': ' + (Date.now() - t0) + ' ms');
    };

    for (const page of ['hoje', 'apps', 'sites', 'hist', 'sug', 'set']) {
      await go(page);
      await shot(page);
    }

    if (process.env.CHRONOS_TESTA_SUGESTAO) {
      await go('sug');
      await run('document.querySelector("#sugTexto").value = '
        + JSON.stringify(process.env.CHRONOS_TESTA_SUGESTAO) + ';'
        + 'document.querySelector("#sugNome").value = "teste automatico"');
      await run('document.querySelector(\'[data-act="sug-enviar"]\').click()');
      await wait(3000);
      await shot('sug-enviada');
    }

    // simula uma versão nova chegando, só para conferir o cartão
    await go('hoje');
    await run('S.update = { status: "ready", version: "1.6.0", current: "1.5.0",'
      + ' notas: "Call do Discord agora conta como uso. Jogos da Steam aparecem com nome e ícone certos." };'
      + ' renderView()');
    await wait(600);
    await shot('novidade');

    await go('hoje');
    await run('S.update = null; renderView()');
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
    if ('minSegundos' in patch) liveCache.at = 0;
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

  ipcMain.handle('sugestao', (e, texto, nome) => enviarSugestao(texto, nome));

  ipcMain.handle('update:state', () => updateInfo());
  ipcMain.handle('update:check', () => { checkForUpdates(); return updateInfo(); });
  ipcMain.handle('update:install', () => {
    if (updateState.status !== 'ready') return false;
    quitting = true;
    stopProbe();
    tracker.flush();
    store.flush();
    // (silencioso, reabre depois): sem isso o instalador aparece na tela e o
    // app fica fechado no fim.
    autoUpdater.quitAndInstall(true, true);
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
