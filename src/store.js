'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_CATEGORIES, OTHER, LEGACY_COLORS, classify, categoryMap } = require('./categories');

const DEFAULT_SETTINGS = {
  interval: 2000,          // ms entre amostras
  idleAfter: 300,          // segundos sem teclado/mouse para marcar ausencia
  paused: false,
  autostart: false,
  startMinimized: true,
  closeToTray: true,
  theme: 'dark',
  siteIcons: false,        // buscar favicon dos sites (unico acesso a internet)
  focusGoalMin: 300,       // meta diaria de tempo produtivo, em minutos
  productive: ['trabalho', 'estudo'],
  categories: DEFAULT_CATEGORIES,
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
      if (!Array.isArray(merged.categories) || !merged.categories.length) {
        merged.categories = DEFAULT_CATEGORIES;
      }
      // Categoria ainda com a cor antiga de fábrica passa para a nova paleta;
      // cor escolhida pelo usuário fica como está.
      for (const c of merged.categories) {
        const legacy = LEGACY_COLORS[c.id];
        if (legacy && String(c.color).toUpperCase() === legacy) {
          const novo = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
          if (novo) { c.color = novo.color; this.migrated = true; }
        }
      }
      return merged;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  saveSettings(patch) {
    if (patch) Object.assign(this.settings, patch);
    // Lista de categorias vazia significa "voltar ao padrao".
    if (!Array.isArray(this.settings.categories) || !this.settings.categories.length) {
      this.settings.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }
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
    const cats = this.settings.categories;
    const catInfo = categoryMap(cats);
    const segs = this.readRange(fromKey, toKey);
    const keys = rangeKeys(fromKey, toKey);
    const single = keys.length === 1;

    let activeMs = 0;
    let idleMs = 0;
    const byCat = new Map();
    const byApp = new Map();
    const bySite = new Map();
    const byDay = new Map();
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push({ h, total: 0, byCat: {} });
    for (const k of keys) byDay.set(k, { date: k, ms: 0, byCat: {} });

    const bump = (obj, key, ms) => { obj[key] = (obj[key] || 0) + ms; };

    for (const seg of segs) {
      const ms = Math.max(0, seg.e - seg.s);
      if (!ms) continue;

      if (seg.idle) { idleMs += ms; continue; }
      activeMs += ms;

      const cat = classify(seg, cats);
      byCat.set(cat, (byCat.get(cat) || 0) + ms);

      const dk = dateKey(seg.s);
      const day = byDay.get(dk);
      if (day) { day.ms += ms; bump(day.byCat, cat, ms); }

      // Espalha o segmento pelas horas que ele ocupa.
      let cur = seg.s;
      while (cur < seg.e) {
        const d = new Date(cur);
        const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
        const slice = Math.min(seg.e, hourEnd) - cur;
        const bucket = hours[d.getHours()];
        bucket.total += slice;
        bump(bucket.byCat, cat, slice);
        cur += slice;
      }

      const appKey = (seg.app || seg.exe || '?') + '\u0001' + (seg.exe || '');
      let app = byApp.get(appKey);
      if (!app) {
        app = { app: seg.app || seg.exe || '?', exe: seg.exe, ms: 0, cat, browser: !!seg.browser, titles: new Map() };
        byApp.set(appKey, app);
      }
      app.ms += ms;
      if (seg.browser) app.browser = true;
      const label = seg.dom ? seg.dom + (seg.title ? ' · ' + seg.title : '') : (seg.title || '(sem título)');
      app.titles.set(label, (app.titles.get(label) || 0) + ms);

      if (seg.dom) {
        let site = bySite.get(seg.dom);
        if (!site) {
          site = { dom: seg.dom, ms: 0, cat, tabs: new Map() };
          bySite.set(seg.dom, site);
        }
        site.ms += ms;
        const tab = seg.title || seg.url || seg.dom;
        site.tabs.set(tab, (site.tabs.get(tab) || 0) + ms);
      }
    }

    const topList = (map, limit) => Array.from(map.entries())
      .map(([title, ms]) => ({ title, ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit);

    const categories = Array.from(byCat.entries())
      .map(([id, ms]) => {
        const info = catInfo[id] || OTHER;
        return { id, name: info.name, color: info.color, ms, pct: activeMs ? ms / activeMs : 0 };
      })
      .sort((a, b) => b.ms - a.ms);

    const apps = Array.from(byApp.values())
      .map((a) => ({
        app: a.app, exe: a.exe, ms: a.ms, cat: a.cat, browser: a.browser,
        // O navegador em si nao tem categoria: o tempo dele se divide entre
        // os sites, entao ele fica neutro na lista.
        color: a.browser ? '#5E6B66' : (catInfo[a.cat] || OTHER).color,
        top: topList(a.titles, 14)
      }))
      .sort((a, b) => b.ms - a.ms);

    const sites = Array.from(bySite.values())
      .map((s) => ({
        dom: s.dom, ms: s.ms, cat: s.cat,
        color: (catInfo[s.cat] || OTHER).color,
        tabs: topList(s.tabs, 14)
      }))
      .sort((a, b) => b.ms - a.ms);

    const productive = new Set(this.settings.productive || []);
    let productiveMs = 0;
    for (const c of categories) if (productive.has(c.id)) productiveMs += c.ms;

    const result = {
      from: fromKey, to: toKey, days: keys.length,
      activeMs, idleMs, productiveMs,
      categories, apps, sites, hours,
      byDay: Array.from(byDay.values()),
      catInfo,
      timeline: single ? this.buildTimeline(segs, cats, catInfo) : []
    };
    return result;
  }

  // Junta segmentos vizinhos do mesmo app numa faixa unica, para a linha do
  // tempo nao virar mil tracinhos de um pixel.
  buildTimeline(segs, cats, catInfo) {
    const sorted = segs.filter((s) => !s.idle).sort((a, b) => a.s - b.s);
    const out = [];
    for (const seg of sorted) {
      const cat = classify(seg, cats);
      const last = out[out.length - 1];
      if (last && last.app === (seg.app || seg.exe) && last.cat === cat && seg.s - last.e < 60000) {
        last.e = Math.max(last.e, seg.e);
        if (seg.dom && !last.dom) last.dom = seg.dom;
        continue;
      }
      out.push({
        s: seg.s, e: seg.e,
        app: seg.app || seg.exe,
        dom: seg.dom || null,
        title: seg.title || '',
        cat,
        color: (catInfo[cat] || OTHER).color
      });
    }
    return out.length > 1200 ? out.slice(-1200) : out;
  }

  exportCsv(fromKey, toKey) {
    const segs = this.readRange(fromKey, toKey).sort((a, b) => a.s - b.s);
    const cats = this.settings.categories;
    const rows = ['inicio;fim;minutos;categoria;app;executavel;site;titulo'];
    for (const s of segs) {
      const min = ((s.e - s.s) / 60000).toFixed(2).replace('.', ',');
      const cat = s.idle ? 'ausente' : classify(s, cats);
      rows.push([
        new Date(s.s).toLocaleString('pt-BR'),
        new Date(s.e).toLocaleString('pt-BR'),
        min, cat, s.idle ? 'Ausente' : (s.app || ''), s.exe || '', s.dom || '',
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
