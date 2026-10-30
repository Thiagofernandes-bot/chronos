'use strict';

const fs = require('fs');
const path = require('path');
const { corDe, NEUTRA } = require('./cores');
const { ehRuido, nomeApp, tituloLimpo, semInvisiveis } = require('./ruido');
const { duracao, subtrair, juntar } = require('./intervalos');

const DEFAULT_SETTINGS = {
  interval: 2000,          // ms entre amostras
  idleAfter: 300,          // segundos sem teclado/mouse para marcar ausencia
  paused: false,
  autostart: false,
  startMinimized: true,
  closeToTray: true,
  theme: 'dark',
  minSegundos: 30,         // esconde do relatorio o que somou menos que isso
  siteIcons: false,        // buscar favicon dos sites (unico acesso a internet)
  bounds: null
};

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function dateKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function dayStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function nextDay(key) {
  return dateKey(dayStart(key) + 36 * 3600 * 1000);
}

function rangeKeys(fromKey, toKey) {
  const out = [];
  let k = fromKey;
  let guard = 0;
  while (k <= toKey && guard++ < 800) { out.push(k); k = nextDay(k); }
  return out;
}

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.dataDir = path.join(userDataDir, 'dados');
    this.settingsPath = path.join(userDataDir, 'config.json');
    this.appsPath = path.join(userDataDir, 'apps.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.migrated = false;
    this.settings = this.loadSettings();
    if (this.migrated) this.saveSettings();
    this.pending = [];
    this.cache = new Map();
    // exe -> caminho do executavel, para conseguir extrair o icone depois
    this.apps = this.loadApps();
    this.appsDirty = false;
  }

  loadApps() {
    try { return JSON.parse(fs.readFileSync(this.appsPath, 'utf8')); } catch (e) { return {}; }
  }

  rememberApp(exe, exePath) {
    if (!exe || !exePath) return;
    const key = exe.toLowerCase();
    if (this.apps[key] === exePath) return;
    this.apps[key] = exePath;
    this.appsDirty = true;
  }

  saveApps() {
    if (!this.appsDirty) return;
    this.appsDirty = false;
    try { fs.writeFileSync(this.appsPath, JSON.stringify(this.apps, null, 2), 'utf8'); } catch (e) { /* ignora */ }
  }

  // ---------- configuracao ----------

  loadSettings() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      const merged = Object.assign({}, DEFAULT_SETTINGS, raw);
      // Restos da versão com categorias: saem na primeira leitura.
      for (const velho of ['categories', 'atribuicoes', 'productive', 'focusGoalMin']) {
        if (velho in merged) { delete merged[velho]; this.migrated = true; }
      }
      return merged;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  saveSettings(patch) {
    if (patch) Object.assign(this.settings, patch);
    const tmp = this.settingsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    fs.renameSync(tmp, this.settingsPath);
    return this.settings;
  }

  // ---------- gravacao ----------

  filePath(key) { return path.join(this.dataDir, key + '.jsonl'); }

  add(seg) {
    // Segmento que atravessa a meia-noite entra partido, para que cada dia
    // tenha somente o tempo que aconteceu nele.
    let s = seg.s;
    while (true) {
      const key = dateKey(s);
      const limit = dayStart(nextDay(key));
      if (seg.e <= limit) {
        this.pending.push([key, Object.assign({}, seg, { s })]);
        break;
      }
      this.pending.push([key, Object.assign({}, seg, { s, e: limit })]);
      s = limit;
    }
    if (this.pending.length >= 40) this.flush();
  }

  flush() {
    this.saveApps();
    if (!this.pending.length) return;
    const byDay = new Map();
    for (const [key, seg] of this.pending) {
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(seg);
    }
    this.pending = [];
    for (const [key, segs] of byDay) {
      const lines = segs.map((s) => JSON.stringify(s)).join('\n') + '\n';
      try {
        fs.appendFileSync(this.filePath(key), lines, 'utf8');
        const cached = this.cache.get(key);
        if (cached) cached.push(...segs);
      } catch (e) {
        console.error('[chronos] falha ao gravar', key, e.message);
      }
    }
  }

  readDay(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    let segs = [];
    try {
      const raw = fs.readFileSync(this.filePath(key), 'utf8');
      for (const line of raw.split('\n')) {
        if (!line) continue;
        try { segs.push(JSON.parse(line)); } catch (e) { /* linha truncada */ }
      }
    } catch (e) { segs = []; }
    if (this.cache.size > 45) this.cache.clear();
    this.cache.set(key, segs);
    return segs;
  }

  readRange(fromKey, toKey) {
    const out = [];
    for (const key of rangeKeys(fromKey, toKey)) out.push(...this.readDay(key));
    for (const [key, seg] of this.pending) {
      if (key >= fromKey && key <= toKey) out.push(seg);
    }
    return out;
  }

  availableDays() {
    try {
      return fs.readdirSync(this.dataDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''))
        .sort();
    } catch (e) { return []; }
  }

  // ---------- agregacao ----------

  aggregate(fromKey, toKey) {
    const segs = this.readRange(fromKey, toKey);
    const keys = rangeKeys(fromKey, toKey);
    const single = keys.length === 1;

    let activeMs = 0;
    let idleMs = 0;
    let midiaMs = 0;
    // Períodos por alvo, para somar mídia sem contar o mesmo minuto duas
    // vezes quando o vídeo também estava na frente.
    const frentePorAlvo = new Map();
    const midiaPorAlvo = new Map();
    const midiaRotulos = new Map();
    const byApp = new Map();
    const bySite = new Map();
    const byDay = new Map();
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push({ h, total: 0, porApp: {} });
    for (const k of keys) byDay.set(k, { date: k, ms: 0, porApp: {} });

    const bump = (obj, key, ms) => { obj[key] = (obj[key] || 0) + ms; };

    for (const seg of segs) {
      const ms = Math.max(0, seg.e - seg.s);
      if (!ms) continue;

      // Mídia corre em paralelo ao primeiro plano: tem conta própria, não
      // entra no tempo ativo (senão o dia passaria de 24h).
      if (seg.midia) {
        midiaMs += ms;
        const alvo = seg.dom ? 'site:' + seg.dom : 'app:' + (seg.app || '?');
        juntar(midiaPorAlvo, alvo, seg.s, seg.e);

        let rotulos = midiaRotulos.get(alvo);
        if (!rotulos) {
          rotulos = { dom: seg.dom || null, app: seg.app || '?', titulos: new Map() };
          midiaRotulos.set(alvo, rotulos);
        }
        // No YouTube o "artista" é o canal: é ele que vale como rótulo.
        const rotulo = (seg.artista || '').trim() || (seg.titulo || '').trim();
        if (rotulo) rotulos.titulos.set(rotulo, (rotulos.titulos.get(rotulo) || 0) + ms);
        continue;
      }

      if (seg.idle) { idleMs += ms; continue; }
      // Registro antigo de janela do shell: some na leitura, do mesmo jeito
      // que hoje ele nem chega a ser gravado.
      if (ehRuido(seg.exe, seg.title)) continue;
      activeMs += ms;

      // o caminho aprendido ajuda a dar nome a jogo com executável críptico
      const app = nomeApp(seg.app, seg.exe, this.apps[String(seg.exe || '').toLowerCase()]);
      const title = seg.browser ? semInvisiveis(seg.title) : tituloLimpo(seg.title, app, seg.exe);
      // Nos gráficos empilhados, a divisão é por app — no navegador, por site,
      // que é o que de fato estava em uso.
      const fatia = seg.dom || app;

      const dk = dateKey(seg.s);
      const day = byDay.get(dk);
      if (day) { day.ms += ms; bump(day.porApp, fatia, ms); }

      // Espalha o segmento pelas horas que ele ocupa.
      let cur = seg.s;
      while (cur < seg.e) {
        const d = new Date(cur);
        const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
        const slice = Math.min(seg.e, hourEnd) - cur;
        const bucket = hours[d.getHours()];
        bucket.total += slice;
        bump(bucket.porApp, fatia, slice);
        cur += slice;
      }

      const appKey = app + '\u0001' + (seg.exe || '');
      juntar(frentePorAlvo, 'app:' + appKey, seg.s, seg.e);
      if (seg.dom) juntar(frentePorAlvo, 'site:' + seg.dom, seg.s, seg.e);
      let appAgg = byApp.get(appKey);
      if (!appAgg) {
        appAgg = { app, exe: seg.exe, ms: 0, browser: !!seg.browser, titles: new Map() };
        byApp.set(appKey, appAgg);
      }
      appAgg.ms += ms;
      if (seg.browser) appAgg.browser = true;
      const label = seg.dom ? seg.dom + (title ? ' · ' + title : '') : (title || '(sem título)');
      appAgg.titles.set(label, (appAgg.titles.get(label) || 0) + ms);

      if (seg.dom) {
        let site = bySite.get(seg.dom);
        if (!site) {
          site = { dom: seg.dom, ms: 0, tabs: new Map() };
          bySite.set(seg.dom, site);
        }
        site.ms += ms;
        const tab = title || seg.url || seg.dom;
        site.tabs.set(tab, (site.tabs.get(tab) || 0) + ms);
      }
    }

    // Mídia tocando é uso: o tempo entra na conta do próprio site (ou app),
    // descontado o período em que aquilo já estava na frente — assistir
    // olhando para a tela não pode contar duas vezes.
    let midiaExtraMs = 0;
    for (const [alvo, periodos] of midiaPorAlvo) {
      const extra = duracao(subtrair(periodos, frentePorAlvo.get(alvo) || []));
      if (extra <= 0) continue;
      midiaExtraMs += extra;
      const rotulos = midiaRotulos.get(alvo) || { titulos: new Map() };

      if (alvo.indexOf('site:') === 0) {
        const dom = alvo.slice(5);
        let site = bySite.get(dom);
        if (!site) { site = { dom, ms: 0, tabs: new Map() }; bySite.set(dom, site); }
        site.ms += extra;
        for (const [t, tms] of rotulos.titulos) site.tabs.set(t, (site.tabs.get(t) || 0) + tms);
      } else {
        const nome = alvo.slice(4);
        let chave = null;
        for (const [k, v] of byApp) {
          if (String(v.app).toLowerCase() === nome.toLowerCase()) { chave = k; break; }
        }
        if (!chave) {
          chave = nome + '\u0001';
          byApp.set(chave, { app: nome, exe: null, ms: 0, browser: false, titles: new Map() });
        }
        const alvoApp = byApp.get(chave);
        alvoApp.ms += extra;
        for (const [t, tms] of rotulos.titulos) alvoApp.titles.set(t, (alvoApp.titles.get(t) || 0) + tms);
      }
    }

    // Piso de duração: o que somou poucos segundos no período é ruído de
    // passagem (diálogo aberto por engano, janela que piscou) e não ajuda a
    // medir nada. O tempo continua no total do dia; só não vira linha.
    const minMs = Math.max(0, (this.settings.minSegundos || 0) * 1000);

    const topList = (map, limit) => Array.from(map.entries())
      .map(([title, ms]) => ({ title, ms }))
      .filter((t) => t.ms >= minMs)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit);

    const appsTodos = Array.from(byApp.values())
      .map((a) => ({
        app: a.app, exe: a.exe, ms: a.ms, browser: a.browser,
        // O navegador fica neutro: o tempo dele se divide entre os sites.
        color: a.browser ? NEUTRA : corDe(a.app),
        top: topList(a.titles, 14)
      }))
      .sort((a, b) => b.ms - a.ms);

    const sitesTodos = Array.from(bySite.values())
      .map((s) => ({
        dom: s.dom, ms: s.ms, color: corDe(s.dom), tabs: topList(s.tabs, 14)
      }))
      .sort((a, b) => b.ms - a.ms);

    const apps = appsTodos.filter((a) => a.ms >= minMs);
    const sites = sitesTodos.filter((s) => s.ms >= minMs);

    // totalMs: tudo que tocou. extraMs: a parte que aconteceu fora da tela e
    // por isso somou ao tempo dos sites e apps.
    const midia = { totalMs: midiaMs, extraMs: midiaExtraMs };

    const ocultos = {
      minSegundos: Math.round(minMs / 1000),
      apps: appsTodos.length - apps.length,
      sites: sitesTodos.length - sites.length,
      ms: appsTodos.filter((a) => a.ms < minMs).reduce((t, a) => t + a.ms, 0)
    };

    // Cor de cada fatia dos gráficos empilhados (app ou site).
    const cores = {};
    for (const a of appsTodos) cores[a.app] = a.color;
    for (const s of sitesTodos) cores[s.dom] = s.color;

    return {
      from: fromKey, to: toKey, days: keys.length,
      activeMs, idleMs,
      apps, sites, hours, ocultos, midia, cores,
      byDay: Array.from(byDay.values()),
      timeline: single ? this.buildTimeline(segs) : []
    };
  }

  // Junta segmentos vizinhos do mesmo app numa faixa unica, para a linha do
  // tempo nao virar mil tracinhos de um pixel.
  buildTimeline(segs) {
    const sorted = segs
      .filter((s) => !s.idle && !s.midia && !ehRuido(s.exe, s.title))
      .sort((a, b) => a.s - b.s);
    const out = [];
    for (const seg of sorted) {
      const nome = nomeApp(seg.app, seg.exe, this.apps[String(seg.exe || '').toLowerCase()]);
      const last = out[out.length - 1];
      if (last && last.app === nome && seg.s - last.e < 60000) {
        last.e = Math.max(last.e, seg.e);
        if (seg.dom && !last.dom) last.dom = seg.dom;
        continue;
      }
      out.push({
        s: seg.s, e: seg.e,
        app: nome,
        dom: seg.dom || null,
        title: seg.browser ? (seg.title || '') : tituloLimpo(seg.title, nome, seg.exe),
        color: corDe(seg.dom || nome)
      });
    }
    return out.length > 1200 ? out.slice(-1200) : out;
  }

  exportCsv(fromKey, toKey) {
    const segs = this.readRange(fromKey, toKey).sort((a, b) => a.s - b.s);
    const rows = ['inicio;fim;minutos;tipo;app;executavel;site;titulo'];
    for (const s of segs) {
      const min = ((s.e - s.s) / 60000).toFixed(2).replace('.', ',');
      const tipo = s.idle ? 'ausente' : (s.midia ? 'tocando' : 'tela');
      rows.push([
        new Date(s.s).toLocaleString('pt-BR'),
        new Date(s.e).toLocaleString('pt-BR'),
        min, tipo, s.idle ? 'Ausente' : nomeApp(s.app, s.exe), s.exe || '', s.dom || '',
        (s.title || '').replace(/[;\r\n]/g, ' ')
      ].join(';'));
    }
    return rows.join('\r\n');
  }

  clearAll() {
    this.pending = [];
    this.cache.clear();
    for (const f of this.availableDays()) {
      try { fs.unlinkSync(this.filePath(f)); } catch (e) { /* ignora */ }
    }
  }
}

module.exports = { Store, dateKey, dayStart, nextDay, rangeKeys, DEFAULT_SETTINGS };
