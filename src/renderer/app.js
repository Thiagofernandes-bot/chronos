'use strict';

const api = window.chronos;

/* ------------------------------------------------------------- utilidades */

const PAGES = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'apps', label: 'Aplicativos' },
  { id: 'sites', label: 'Navegador' },
  { id: 'hist', label: 'Histórico' },
  { id: 'sug', label: 'Sugestões' },
  { id: 'set', label: 'Ajustes' }
];

const ICONS = {
  hoje: '<circle cx="10" cy="10" r="7"/><path d="M10 6.2V10l2.7 1.7"/>',
  apps: '<rect x="3" y="3" width="6" height="6" rx="1.6"/><rect x="11" y="3" width="6" height="6" rx="1.6"/><rect x="3" y="11" width="6" height="6" rx="1.6"/><rect x="11" y="11" width="6" height="6" rx="1.6"/>',
  sites: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c1.9 2 2.9 4.4 2.9 7s-1 5-2.9 7c-1.9-2-2.9-4.4-2.9-7S8.1 5 10 3z"/>',
  hist: '<path d="M3 17h14"/><rect x="4.5" y="9" width="3" height="5" rx="1"/><rect x="9" y="5" width="3" height="9" rx="1"/><rect x="13.5" y="11" width="3" height="3" rx="1"/>',
  sug: '<path d="M16.5 11.8c0 1.3-1.1 2.4-2.4 2.4H8.3L4.5 17v-2.8H5.9c-1.3 0-2.4-1.1-2.4-2.4V5.9c0-1.3 1.1-2.4 2.4-2.4h8.2c1.3 0 2.4 1.1 2.4 2.4z"/>',
  set: '<path d="M3 6h7M14 6h3M3 14h3M10 14h7"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="14" r="2"/>'
};

const RANGES = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' }
];

const S = {
  page: 'hoje',
  range: 'hoje',
  stats: null,
  settings: null,
  live: null,
  update: null,
  anterior: null,
  ultimaPagina: null,
  open: {},
  confirmClear: false
};

const UPDATE_TXT = {
  dev: 'modo desenvolvimento — atualização automática desligada',
  idle: 'ainda não verifiquei',
  checking: 'procurando atualizações…',
  latest: 'você está na versão mais recente',
  error: 'não consegui verificar agora'
};

function updateLine() {
  const u = S.update;
  if (!u) return '';
  if (u.status === 'downloading') {
    return 'baixando a versão ' + (u.version || '') + '… ' + (u.percent || 0) + '%';
  }
  if (u.status === 'ready') return 'versão ' + (u.version || '') + ' pronta — reinicie para aplicar';
  if (u.status === 'error') return UPDATE_TXT.error + (u.error ? ': ' + u.error : '');
  return UPDATE_TXT[u.status] || '';
}

function updateBanner() {
  const u = S.update;
  if (!u || u.status !== 'ready') return '';
  return '<div class="banner ok"><b>Chronos ' + esc(u.version) + ' pronto para instalar</b>'
    + '<button class="btn primary" data-act="update-install">Reiniciar e atualizar</button></div>';
}

const $ = (sel) => document.querySelector(sel);

/* ---------------------------------------------------- icones dos programas */

// exe -> data URL do icone (ou null quando o Windows nao devolve nenhum).
const ICON_CACHE = {};
// dominio -> favicon (so quando o usuario liga a busca na internet).
let SITE_ICON_CACHE = {};

async function ensureIcons(exes) {
  const missing = [];
  for (const e of exes || []) {
    const k = (e || '').toLowerCase();
    if (k && !(k in ICON_CACHE) && missing.indexOf(k) < 0) missing.push(k);
  }
  if (!missing.length) return;
  let got = {};
  try { got = await api.icons(missing); } catch (e) { /* segue com as iniciais */ }
  for (const k of missing) ICON_CACHE[k] = got[k] || null;
}

async function ensureSiteIcons(doms) {
  if (!S.settings.siteIcons) return;
  const missing = [];
  for (const d of doms || []) {
    const k = (d || '').toLowerCase();
    if (k && !(k in SITE_ICON_CACHE) && missing.indexOf(k) < 0) missing.push(k);
  }
  if (!missing.length) return false;
  let got = {};
  try { got = await api.siteIcons(missing); } catch (e) { /* segue com as iniciais */ }
  for (const k of missing) SITE_ICON_CACHE[k] = got[k] || null;
  return Object.keys(got).length > 0;
}

function tile(name, color, exe, dom) {
  const icon = ICON_CACHE[(exe || '').toLowerCase()] || SITE_ICON_CACHE[(dom || '').toLowerCase()];
  if (icon) return '<div class="tile tile-img"><img src="' + icon + '" alt="" /></div>';
  return '<div class="tile" style="background:' + color + '">' + esc(initials(name)) + '</div>';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function keyOf(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function fmt(ms) {
  const v = ms || 0;
  if (!v) return '0min';
  if (v < 60000) return Math.round(v / 1000) + 's';
  const min = Math.round(v / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return h + 'h ' + m + 'min';
  if (h) return h + 'h';
  return m + 'min';
}

function fmtBig(ms) {
  const min = Math.round((ms || 0) / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h) return h + '<i>h</i>' + pad(m) + '<i>min</i>';
  return m + '<i>min</i>';
}

function clock(ms) {
  const d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function pct(n) { return (n * 100).toFixed(n >= 0.1 ? 0 : 1) + '%'; }

function initials(name) {
  const clean = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function dayLabel(key, long) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (long) return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') + ' ' + d;
}

function doKey(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Mesmo tamanho de período, imediatamente antes: é com ele que a tela Hoje
// se compara.
function periodoAnterior(r) {
  const dias = r.days || 1;
  const fim = new Date(doKey(r.from).getTime() - 864e5);
  const ini = new Date(fim.getTime() - (dias - 1) * 864e5);
  return { from: keyOf(ini), to: keyOf(fim) };
}

function currentRange() {
  const today = new Date();
  if (S.range === 'hoje') { const k = keyOf(today); return { from: k, to: k, single: true }; }
  if (S.range === 'ontem') {
    const y = new Date(today.getTime() - 864e5);
    const k = keyOf(y);
    return { from: k, to: k, single: true };
  }
  const n = S.range === '7' ? 7 : 30;
  return { from: keyOf(new Date(today.getTime() - (n - 1) * 864e5)), to: keyOf(today), single: false, days: n };
}

function rangeLabel() {
  const r = currentRange();
  if (r.single) return dayLabel(r.from, true);
  return 'de ' + dayLabel(r.from) + ' até ' + dayLabel(r.to);
}

/* ---------------------------------------------------------------- graficos */

function stackedCol(porApp, total, max, cores) {
  if (!total) return '<div class="empty"></div>';
  const entries = Object.entries(porApp).sort((a, b) => b[1] - a[1]);
  const hFrac = max ? total / max : 0;
  let html = '';
  for (const [nome, ms] of entries) {
    const cor = (cores && cores[nome]) || '#5E6B66';
    const h = (ms / total) * hFrac * 100;
    html += '<div class="seg" style="height:' + h.toFixed(2) + '%;background:' + cor + '"></div>';
  }
  return html;
}

function hoursChart(hours, cores) {
  const max = Math.max.apply(null, hours.map((h) => h.total).concat([1]));
  let bars = '';
  for (const h of hours) {
    const tip = h.total
      ? pad(h.h) + 'h — ' + fmt(h.total)
      : pad(h.h) + 'h — sem registro';
    bars += '<div class="h" data-tip="' + esc(tip) + '">' + stackedCol(h.porApp, h.total, max, cores) + '</div>';
  }
  let labels = '';
  for (let i = 0; i < 24; i++) labels += '<span>' + (i % 3 === 0 ? pad(i) : '') + '</span>';
  return '<div class="hours">' + bars + '</div><div class="hours-x">' + labels + '</div>';
}

function timelineChart(tl) {
  if (!tl.length) return '<div class="empty-state">Sem atividade registrada ainda.</div>';
  const first = tl[0].s;
  const last = tl[tl.length - 1].e;
  const d0 = new Date(first);
  let start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), d0.getHours()).getTime();
  const d1 = new Date(last);
  let end = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), d1.getHours() + 1).getTime();
  if (end - start < 4 * 3600e3) end = start + 4 * 3600e3;
  const span = end - start;

  let blocks = '';
  for (const b of tl) {
    const left = ((b.s - start) / span) * 100;
    const w = ((b.e - b.s) / span) * 100;
    const where = b.dom ? b.dom : b.app;
    blocks += '<div class="tl-b" style="left:' + left.toFixed(3) + '%;width:' + Math.max(w, 0.12).toFixed(3)
      + '%;background:' + b.color + '" data-tip="' + esc(where + ' — ' + fmt(b.e - b.s))
      + '" data-tip2="' + esc(clock(b.s) + ' às ' + clock(b.e) + (b.title ? ' · ' + b.title : '')) + '"></div>';
  }

  const hoursCount = Math.round(span / 3600e3);
  let grid = '';
  let xs = '';
  for (let i = 0; i <= hoursCount; i++) {
    const p = (i / hoursCount) * 100;
    if (i > 0 && i < hoursCount) grid += '<i style="left:' + p.toFixed(2) + '%"></i>';
    if (hoursCount <= 14 || i % 2 === 0) {
      xs += '<span style="position:absolute;left:' + p.toFixed(2) + '%;transform:translateX(-50%)">'
        + pad(new Date(start + i * 3600e3).getHours()) + 'h</span>';
    }
  }
  return '<div class="tl">' + blocks + '<div class="tl-grid">' + grid + '</div></div>'
    + '<div class="tl-x" style="position:relative;height:14px">' + xs + '</div>';
}

/* --------------------------------------------------------------- rankings */

function rankRows(items, kind) {
  const top = items[0] ? items[0].ms : 0;
  const total = items.reduce((a, b) => a + b.ms, 0);
  let html = '<div class="rank">';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = kind === 'site' ? it.dom : it.app;
    const key = kind + ':' + name;
    const open = !!S.open[key];
    const list = kind === 'site' ? it.tabs : it.top;
    const sub = it.sub ? it.sub
      : kind === 'site' ? (list.length + (list.length === 1 ? ' aba' : ' abas'))
        : (it.browser ? 'navegador · ' + list.length + ' sites'
          : (list.length + (list.length === 1 ? ' janela' : ' janelas')));
    html += '<button class="row' + (open ? ' open' : '') + '" data-expand="' + esc(key) + '">'
      + tile(name, it.color, it.exe, it.dom || (kind === 'site' ? name : null))
      + '<div style="min-width:0">'
      + '<div class="row-name">' + esc(name) + '</div>'
      + '<div class="row-sub">' + esc(sub) + '</div>'
      + '<div class="bar"><i style="width:' + (top ? (it.ms / top) * 100 : 0).toFixed(1) + '%;background:' + it.color + '"></i></div>'
      + '</div>'
      + '<div class="row-time"><b class="num">' + fmt(it.ms) + '</b>'
      + '<span class="num">' + pct(total ? it.ms / total : 0) + '</span></div>'
      + '</button>';
    if (open && list.length) {
      const dtop = list[0].ms;
      html += '<div class="detail">';
      for (const t of list) {
        html += '<div class="d-row"><span>' + esc(t.title) + '</span>'
          + '<div class="d-bar"><i style="width:' + (dtop ? (t.ms / dtop) * 100 : 0).toFixed(1) + '%;background:' + it.color + '"></i></div>'
          + '<b class="num">' + fmt(t.ms) + '</b></div>';
      }
      html += '</div>';
    }
  }
  return html + '</div>';
}

// Nada é apagado em silêncio: o que ficou de fora do relatório é dito.
function notaOcultos(st) {
  const o = st.ocultos;
  if (!o || (!o.apps && !o.sites)) return '';
  const partes = [];
  if (o.apps) partes.push(o.apps + (o.apps === 1 ? ' aplicativo' : ' aplicativos'));
  if (o.sites) partes.push(o.sites + (o.sites === 1 ? ' site' : ' sites'));
  return '<p class="cap">' + partes.join(' e ') + ' de passagem (menos de '
    + o.minSegundos + 's, ' + fmt(o.ms) + ' no total) ficaram de fora. '
    + 'O limite está em Ajustes.</p>';
}

function emptyState(msg) {
  return '<div class="card"><div class="empty-state"><b>Nada por aqui ainda</b>' + esc(msg) + '</div></div>';
}

/* ------------------------------------------------------------------ paginas */

function viewHoje() {
  const st = S.stats;
  const r = currentRange();
  const first = st.timeline.length ? st.timeline[0].s : null;
  const lastSeen = st.timeline.length ? st.timeline[st.timeline.length - 1].e : null;

  let html = '';
  if (S.live && S.live.error) html += '<div class="banner">⚠ ' + esc(S.live.error) + '</div>';
  if (!st.activeMs) {
    return html + emptyState(r.single
      ? 'Deixe o Chronos aberto: em poucos minutos o seu dia aparece aqui.'
      : 'Nenhum tempo registrado neste período.');
  }

  // Abertura: o número manda na tela, a frase explica, os detalhes ficam
  // numa linha de apoio — sem caixa nenhuma em volta.
  html += '<div class="lead">'
    + '<div class="lead-num num" data-ms="' + st.activeMs + '">' + fmtBig(st.activeMs) + '</div>'
    + summaryLine(st, r)
    + '<div class="facts">'
    + fact('Ausente', fmt(st.idleMs))
    + fact('Aplicativos', String(st.apps.length))
    + fact('Sites', String(st.sites.length))
    + (first ? fact(r.single ? 'Começou' : 'Primeiro registro', clock(first)) : '')
    + (lastSeen && r.single ? fact('Última atividade', clock(lastSeen)) : '')
    + '</div></div>';

  html += spectrum(st);

  html += '<div class="sec"><div class="sec-h"><h2>Linha do tempo</h2>'
    + '<span>' + (r.single ? 'cada bloco é um período seguido no mesmo app' : 'disponível para um dia só') + '</span></div>'
    + (r.single ? timelineChart(st.timeline)
      : '<div class="empty-state">Escolha “Hoje” ou “Ontem” para ver a linha do tempo.</div>')
    + '</div>';

  html += '<div class="sec"><div class="grid g-hero">'
    + '<div><div class="sec-h" style="margin-top:0"><h2>Por hora</h2>'
    + '<span>cada cor é um app ou site</span></div>'
    + hoursChart(st.hours, st.cores) + '</div>'
    + comparacao(st, r)
    + '</div></div>';

  html += '<div class="sec"><div class="sec-h"><h2>Mais usados</h2>'
    + '<span>apps e sites na mesma lista</span></div>'
    + rankRows(mixTop(st), 'app') + notaMidia(st) + notaOcultos(st) + '</div>';

  return html;
}

// Explica, quando for o caso, que há tempo contado fora da tela.
function notaMidia(st) {
  const m = st.midia;
  if (!m || !m.extraMs) return '';
  return '<p class="cap">inclui ' + fmt(m.extraMs)
    + ' que estavam tocando com a janela atrás de outra ou na segunda tela — '
    + 'rodando conta como uso.</p>';
}

function fact(label, value) {
  return '<div><span>' + esc(label) + '</span><b class="num">' + esc(value) + '</b></div>';
}

// Uma faixa só com a divisão do tempo entre os apps e sites do período.
function spectrum(st) {
  const itens = mixTop(st);
  if (!itens.length) return '';
  const total = itens.reduce((soma, i) => soma + i.ms, 0);
  if (!total) return '';

  const barras = itens.map((i) =>
    '<i style="width:' + Math.max((i.ms / total) * 100, 0.6).toFixed(2) + '%;background:' + i.color + '"'
    + ' data-tip="' + esc(i.app) + '" data-tip2="' + esc(fmt(i.ms) + ' · ' + pct(i.ms / total)) + '"></i>').join('');
  const legenda = itens.slice(0, 7).map((i) =>
    '<span><em style="background:' + i.color + '"></em>' + esc(i.app)
    + ' <b class="num">' + fmt(i.ms) + '</b></span>').join('');

  return '<div class="spec"><div class="spec-bar">' + barras + '</div>'
    + '<div class="spec-legend">' + legenda + '</div></div>';
}

// No lugar da meta de foco: comparação com o período anterior, que não exige
// você definir nada para significar alguma coisa.
function comparacao(st, r) {
  const antes = S.anterior;
  const titulo = r.single ? (S.range === 'ontem' ? 'Comparado a anteontem' : 'Comparado a ontem')
    : 'Comparado ao período anterior';

  let corpo;
  if (!antes || !antes.activeMs) {
    corpo = '<div class="goal-txt"><b class="num">—</b>'
      + '<span>sem registro para comparar</span></div>';
  } else {
    const dif = st.activeMs - antes.activeMs;
    const sinal = dif >= 0 ? '+' : '−';
    const prop = Math.min(Math.abs(st.activeMs) / Math.max(antes.activeMs, 1), 1.6) / 1.6;
    corpo = '<div class="goal-bar"><i style="width:' + (prop * 100).toFixed(1) + '%"></i></div>'
      + '<div class="goal-txt"><b class="num">' + sinal + fmt(Math.abs(dif)) + '</b>'
      + '<span class="num">' + fmt(antes.activeMs) + ' antes</span></div>'
      + '<p class="cap">' + (dif >= 0 ? 'mais' : 'menos') + ' tempo de tela que no período anterior</p>';
  }

  return '<div><div class="sec-h" style="margin-top:0"><h2>' + titulo + '</h2></div>' + corpo + '</div>';
}

// Uma frase em portugues claro explicando o numero grande logo acima.
function summaryLine(st, r) {
  const itens = mixTop(st);
  const topApp = itens[0];
  const segundo = itens[1];
  const quando = r.single ? (S.range === 'ontem' ? 'ontem' : 'hoje') : 'neste período';
  let txt = 'Você usou o computador por <b>' + fmt(st.activeMs) + '</b> ' + quando + '.';
  if (topApp) {
    txt += ' O que mais tomou tempo foi <b style="color:' + topApp.color + '">' + esc(topApp.app)
      + '</b>, com ' + fmt(topApp.ms);
    txt += segundo ? ', seguido de <b>' + esc(segundo.app) + '</b> com ' + fmt(segundo.ms) + '.' : '.';
  }
  return '<p class="lead-txt">' + txt + '</p>';
}

// No resumo do dia, o navegador aparece quebrado por site: "Chrome" sozinho
// nao diz nada.
function mixTop(st) {
  const out = [];
  for (const a of st.apps) {
    if (a.browser) continue;
    out.push(a);
  }
  for (const s of st.sites) {
    out.push({
      app: s.dom, exe: null, dom: s.dom, ms: s.ms, cat: s.cat, color: s.color, browser: false, top: s.tabs,
      sub: 'no navegador · ' + s.tabs.length + (s.tabs.length === 1 ? ' aba' : ' abas')
    });
  }
  return out.sort((a, b) => b.ms - a.ms).slice(0, 8);
}

function viewApps() {
  const st = S.stats;
  if (!st.apps.length) return emptyState('Nenhum aplicativo registrado neste período.');
  return '<div class="sec-h"><h2>Aplicativos</h2>'
    + '<span>' + st.apps.length + ' no período · clique para ver as janelas</span></div>'
    + rankRows(st.apps, 'app')
    + notaOcultos(st);
}

function viewSites() {
  const st = S.stats;
  if (!st.sites.length) {
    return emptyState('Nenhum site registrado. Navegue no Chrome/Edge com o Chronos rodando.');
  }
  const totalBrowser = st.sites.reduce((a, b) => a + b.ms, 0);
  const tabs = st.sites.reduce((a, b) => a + b.tabs.length, 0);
  return '<div class="lead">'
    + '<div class="lead-num num" data-ms="' + totalBrowser + '">' + fmtBig(totalBrowser) + '</div>'
    + '<p class="lead-txt">Tempo dentro do navegador, repartido entre <b>' + st.sites.length
    + ' sites</b> e <b>' + tabs + ' abas</b> diferentes.</p>'
    + '</div>'
    + '<div class="sec"><div class="sec-h"><h2>Tempo por site</h2>'
    + '<span>clique para ver as abas e os canais</span></div>'
    + rankRows(st.sites, 'site') + notaMidia(st) + notaOcultos(st) + '</div>';
}

function viewHist() {
  const st = S.stats;
  const days = st.byDay;
  const max = Math.max.apply(null, days.map((d) => d.ms).concat([1]));
  const active = days.filter((d) => d.ms > 0);
  const avg = active.length ? days.reduce((a, b) => a + b.ms, 0) / active.length : 0;
  const best = days.slice().sort((a, b) => b.ms - a.ms)[0];

  let bars = '';
  let labels = '';
  for (const d of days) {
    bars += '<div class="d" data-tip="' + esc(dayLabel(d.date, true)) + '" data-tip2="' + esc(fmt(d.ms)) + '">'
      + stackedCol(d.porApp, d.ms, max, st.cores) + '</div>';
    labels += '<span>' + esc(days.length > 14 ? d.date.slice(8) : dayLabel(d.date)) + '</span>';
  }

  return '<div class="lead">'
    + '<div class="lead-num num" data-ms="' + st.activeMs + '">' + fmtBig(st.activeMs) + '</div>'
    + '<p class="lead-txt">Total dos últimos 30 dias, com média de <b>' + fmt(avg)
    + '</b> por dia usado. O dia mais cheio foi <b>'
    + esc(best && best.ms ? dayLabel(best.date, true) : '—') + '</b>, com ' + fmt(best ? best.ms : 0) + '.</p>'
    + '</div>'
    + '<div class="sec"><div class="sec-h"><h2>Por dia</h2><span>a cor mostra a categoria</span></div>'
    + '<div class="days">' + bars + '</div><div class="days-x">' + labels + '</div></div>'
    + '<div class="sec"><div class="grid g-2">'
    + '<div><div class="sec-h" style="margin-top:0"><h2>Aplicativos</h2></div>' + rankRows(st.apps.slice(0, 10), 'app') + '</div>'
    + '<div><div class="sec-h" style="margin-top:0"><h2>Sites</h2></div>'
    + (st.sites.length ? rankRows(st.sites.slice(0, 10), 'site') : '<div class="empty-state">Sem navegação registrada.</div>')
    + '</div></div></div>';
}

function viewSug() {
  const enviadas = (S.settings.sugestoesEnviadas || []).slice().reverse();

  let html = '<p class="lead-txt" style="margin-top:0">'
    + 'Falta alguma coisa no Chronos? Escreva aqui. Vai direto para quem cuida do app.</p>'
    + '<div class="sug">'
    + '<textarea id="sugTexto" rows="5" maxlength="2000"'
    + ' placeholder="Ex.: queria um resumo da semana toda segunda de manhã."></textarea>'
    + '<div class="sug-linha">'
    + '<input type="text" id="sugNome" maxlength="80" placeholder="Seu nome (opcional)" />'
    + '<button class="btn primary" data-act="sug-enviar">Enviar sugestão</button>'
    + '</div>'
    + '<p class="cap">Sai daqui só o que você escrever, o nome se você preencher, a versão do app'
    + ' e um código aleatório desta instalação. Nenhum dado de uso: nem app, nem site, nem tempo.</p>'
    + '</div>';

  if (enviadas.length) {
    html += '<div class="sec"><div class="sec-h"><h2>O que você já mandou</h2>'
      + '<span>' + enviadas.length + (enviadas.length === 1 ? ' sugestão' : ' sugestões') + '</span></div>';
    for (const s of enviadas) {
      html += '<div class="sug-item"><p>' + esc(s.texto) + '</p>'
        + '<span>' + esc(new Date(s.em).toLocaleString('pt-BR')) + '</span></div>';
    }
    html += '</div>';
  }
  return html;
}

function viewSet() {
  const s = S.settings;
  const sw = (key, on) => '<span class="sw' + (on ? ' on' : '') + '" data-toggle="' + key + '"></span>';
  const opt = (v, label, cur) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>';

  return '<div class="grid g-2">'
    + '<div class="card"><div class="card-h"><h2>Rastreio</h2></div><div class="set">'
    + '<div class="set-row"><div><p>Pausar rastreio</p><small>nada é registrado enquanto estiver pausado</small></div>'
    + sw('paused', s.paused) + '</div>'
    + '<div class="set-row"><div><p>Marcar ausência após</p><small>tempo sem teclado nem mouse</small></div>'
    + '<select data-set="idleAfter">' + [60, 120, 300, 600, 900].map((v) =>
      opt(v, (v / 60) + ' min', s.idleAfter)).join('') + '</select></div>'
    + '<div class="set-row"><div><p>Intervalo de amostragem</p><small>menor = mais preciso, consome um pouco mais</small></div>'
    + '<select data-set="interval">' + [1000, 2000, 3000, 5000].map((v) =>
      opt(v, (v / 1000) + ' s', s.interval)).join('') + '</select></div>'
    + '<div class="set-row"><div><p>Esconder o que durou pouco</p>'
    + '<small>janela que somou menos que isso no período não vira linha no relatório</small></div>'
    + '<select data-set="minSegundos">' + [0, 10, 30, 60, 180].map((v) =>
      opt(v, v === 0 ? 'mostrar tudo' : (v < 60 ? v + ' s' : (v / 60) + ' min'), s.minSegundos)).join('')
    + '</select></div>'
    + '</div></div>'

    + '<div class="card"><div class="card-h"><h2>Aplicativo</h2></div><div class="set">'
    + '<div class="set-row"><div><p>Iniciar com o Windows</p><small>abre minimizado na bandeja</small></div>'
    + sw('autostart', s.autostart) + '</div>'
    + '<div class="set-row"><div><p>Fechar para a bandeja</p><small>o X esconde a janela e continua contando</small></div>'
    + sw('closeToTray', s.closeToTray) + '</div>'
    + '<div class="set-row"><div><p>Ícones dos sites</p>'
    + '<small>busca o ícone de cada site na internet (icons.duckduckgo.com) — todo o resto funciona offline</small></div>'
    + sw('siteIcons', s.siteIcons) + '</div>'
    + '<div class="set-row"><div><p>Tema</p><small>escuro ou claro</small></div>'
    + '<select data-set="theme">' + opt('dark', 'Escuro', s.theme) + opt('light', 'Claro', s.theme) + '</select></div>'
    + '<div class="set-row"><div><p>Pasta de dados</p><small>tudo fica em %APPDATA%\\Chronos</small></div>'
    + '<button class="btn" data-act="open-data">Abrir pasta</button></div>'
    + '</div></div></div>'

    + '<div class="card mt"><div class="card-h"><h2>Atualizações</h2>'
    + '<span class="hint">versão instalada: ' + esc((S.update && S.update.current) || '—') + '</span></div>'
    + '<div class="set"><div class="set-row"><div><p>Atualização automática</p>'
    + '<small>' + esc(updateLine()) + '</small></div>'
    + (S.update && S.update.status === 'ready'
      ? '<button class="btn primary" data-act="update-install">Reiniciar e atualizar</button>'
      : '<button class="btn" data-act="update-check">Procurar atualizações</button>')
    + '</div></div></div>'

    + '<div class="card mt"><div class="card-h"><h2>Dados</h2></div><div class="set">'
    + '<div class="set-row"><div><p>Exportar período atual</p><small>planilha CSV com cada janela e cada aba</small></div>'
    + '<button class="btn primary" data-act="export">Exportar CSV</button></div>'
    + '<div class="set-row"><div><p>Apagar tudo</p><small>remove todo o histórico gravado — não tem volta</small></div>'
    + '<button class="btn danger" data-act="clear">' + (S.confirmClear ? 'Confirmar: apagar tudo' : 'Apagar histórico') + '</button></div>'
    + '</div></div>';
}

/* --------------------------------------------------------------- render */

function renderNav() {
  $('#nav').innerHTML = PAGES.map((p) =>
    '<button data-page="' + p.id + '" class="' + (S.page === p.id ? 'on' : '') + '">'
    + '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"'
    + ' stroke-linecap="round" stroke-linejoin="round">' + ICONS[p.id] + '</svg>'
    + p.label + '</button>').join('');

  const semPeriodo = S.page === 'set' || S.page === 'hist' || S.page === 'sug';
  $('#ranges').innerHTML = semPeriodo ? '' : RANGES.map((r) =>
    '<button data-range="' + r.id + '" class="' + (S.range === r.id ? 'on' : '') + '">' + r.label + '</button>').join('');
  $('#ranges').hidden = !$('#ranges').innerHTML;

  const dark = S.settings.theme !== 'light';
  $('#themeBtn').title = dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
  $('#themeBtn').innerHTML = '<svg viewBox="0 0 20 20" width="17" height="17" fill="none"'
    + ' stroke="currentColor" stroke-width="1.6" stroke-linecap="round">'
    + (dark
      ? '<circle cx="10" cy="10" r="3.6"/><path d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6'
        + 'M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1L4.8 4.8"/>'
      : '<path d="M16.3 11.6A6.9 6.9 0 0 1 8.4 3.7a6.9 6.9 0 1 0 7.9 7.9z"/>')
    + '</svg>';

  const page = PAGES.find((p) => p.id === S.page);
  $('#pageTitle').textContent = page.label;
  $('#pageSub').textContent = S.page === 'set' ? 'como o Chronos trabalha'
    : S.page === 'hist' ? 'últimos 30 dias'
      : S.page === 'sug' ? 'o que você gostaria de ver aqui'
        : rangeLabel();
}

function renderNow() {
  const l = S.live;
  if (!l) return;
  const c = l.current || {};
  const paused = l.paused;
  const off = paused || c.idle || !c.app;
  const label = paused ? 'Pausado' : c.idle ? 'Ausente' : (c.app || 'Sem janela ativa');
  const sub = paused ? 'retome quando quiser'
    : c.idle ? 'sem teclado nem mouse'
      : (c.dom || c.title || '');

  $('#now').innerHTML = '<div class="now-h"><i class="dot' + (off ? ' off' : '') + '"></i>'
    + (paused ? 'Pausado' : 'Agora') + '</div>'
    + '<div class="now-id">'
    + (off ? '' : tile(label, 'var(--accent)', c.exe))
    + '<div style="min-width:0">'
    + '<div class="now-app">' + esc(label) + '</div>'
    + '<div class="now-sub">' + esc(sub.length > 60 ? sub.slice(0, 60) + '…' : sub) + '</div>'
    + '</div></div>'
    + '<div class="now-foot"><div><b class="num">' + fmt(l.activeMs) + '</b><span>ativo hoje</span></div>'
    + '<button class="mini" data-act="pause">' + (paused ? 'Retomar' : 'Pausar') + '</button></div>';
}

// Os números grandes sobem do zero: dá a sensação de contagem acontecendo,
// que é literalmente o que o app faz.
function animaNumero(el) {
  const alvo = Number(el.dataset.ms || 0);
  if (!alvo || menosMovimento()) { el.innerHTML = fmtBig(alvo); return; }
  const dur = 650;
  const inicio = performance.now();
  const passo = (agora) => {
    const p = Math.min((agora - inicio) / dur, 1);
    const suave = 1 - Math.pow(1 - p, 3);
    el.innerHTML = fmtBig(alvo * suave);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function menosMovimento() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function renderView() {
  if (!S.stats || !S.settings) return;
  const map = {
    hoje: viewHoje, apps: viewApps, sites: viewSites,
    hist: viewHist, sug: viewSug, set: viewSet
  };
  // A entrada só toca quando a tela muda — não a cada atualização de dados.
  const alvo = $('#view');
  const mudou = S.ultimaPagina !== S.page;
  S.ultimaPagina = S.page;
  alvo.className = 'scroll' + (mudou && !menosMovimento() ? ' entra' : '');
  alvo.innerHTML = updateBanner() + map[S.page]();
  for (const n of alvo.querySelectorAll('.lead-num[data-ms]')) animaNumero(n);
}

function render() {
  renderNav();
  renderNow();
  renderView();
}

async function load(keepScroll) {
  const top = keepScroll ? $('#view').scrollTop : 0;
  const r = S.page === 'hist'
    ? { from: keyOf(new Date(Date.now() - 29 * 864e5)), to: keyOf(new Date()) }
    : currentRange();
  const st = await api.stats(r.from, r.to);
  S.stats = st;
  // Ícone de programa é local e instantâneo; favicon vem da internet, então
  // a tela não espera por ele.
  await ensureIcons(st.apps.map((a) => a.exe));
  render();
  $('#view').scrollTop = top;

  ensureSiteIcons(st.sites.map((s) => s.dom)).then((novos) => {
    if (novos && S.stats === st) renderView();
  });

  // A comparação com o período anterior chega depois, sem segurar a tela.
  if (S.page === 'hoje') {
    const ant = periodoAnterior(r);
    api.stats(ant.from, ant.to).then((dados) => {
      if (S.stats !== st) return;
      S.anterior = dados;
      renderView();
    }).catch(() => { /* sem comparação, a seção avisa */ });
  }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------------------------------------------------------- eventos */

document.addEventListener('click', async (ev) => {
  const t = ev.target;
  const close = (sel) => t.closest(sel);

  const nav = close('[data-page]');
  if (nav) { S.page = nav.dataset.page; S.confirmClear = false; await load(); return; }

  const rg = close('[data-range]');
  if (rg) { S.range = rg.dataset.range; await load(); return; }

  const exp = close('[data-expand]');
  if (exp) {
    const key = exp.dataset.expand;
    S.open[key] = !S.open[key];
    renderView();
    return;
  }

  const tog = close('[data-toggle]');
  if (tog) {
    const key = tog.dataset.toggle;
    S.settings = await api.setSettings({ [key]: !S.settings[key] });
    if (key === 'theme') document.documentElement.dataset.theme = S.settings.theme;
    if (key === 'siteIcons') { SITE_ICON_CACHE = {}; await load(true); return; }
    S.live = await api.live();
    render();
    return;
  }

  const act = close('[data-act]');
  if (act) {
    const what = act.dataset.act;
    if (what === 'pause') {
      S.settings = await api.setSettings({ paused: !S.settings.paused });
      S.live = await api.live();
      render();
    }
    if (what === 'sug-enviar') {
      const area = document.querySelector('#sugTexto');
      const nome = document.querySelector('#sugNome');
      if (!area) return;
      act.textContent = 'Enviando…';
      act.disabled = true;
      const res = await api.enviarSugestao(area.value, nome ? nome.value : '');
      if (res && res.ok) {
        S.settings = await api.getSettings();
        renderView();
        toast('Sugestão enviada. Obrigado!');
      } else {
        act.textContent = 'Enviar sugestão';
        act.disabled = false;
        toast((res && res.erro) || 'Não consegui enviar.');
      }
      return;
    }
    if (what === 'theme') {
      const next = S.settings.theme === 'light' ? 'dark' : 'light';
      S.settings = await api.setSettings({ theme: next });
      document.documentElement.dataset.theme = next;
      render();
    }
    if (what === 'update-check') {
      S.update = await api.updateCheck();
      renderView();
      toast('Procurando atualizações…');
    }
    if (what === 'update-install') await api.updateInstall();
    if (what === 'open-data') api.openData();
    if (what === 'export') {
      const r = S.page === 'hist'
        ? { from: keyOf(new Date(Date.now() - 29 * 864e5)), to: keyOf(new Date()) }
        : currentRange();
      const res = await api.exportCsv(r.from, r.to);
      if (res && res.ok) toast('Salvo em ' + res.path);
    }
    if (what === 'clear') {
      if (!S.confirmClear) { S.confirmClear = true; renderView(); return; }
      S.confirmClear = false;
      await api.clearData();
      await load();
      toast('Histórico apagado');
    }
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;

  if (t.dataset.set) {
    const key = t.dataset.set;
    const value = t.type === 'number' ? Number(t.value) : (/^\d+$/.test(t.value) ? Number(t.value) : t.value);
    S.settings = await api.setSettings({ [key]: value });
    if (key === 'theme') document.documentElement.dataset.theme = S.settings.theme;
    await load(true);
    return;
  }

});

/* tooltip */
const tip = $('#tip');
document.addEventListener('mousemove', (ev) => {
  const el = ev.target.closest('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.innerHTML = '<b>' + esc(el.dataset.tip) + '</b>'
    + (el.dataset.tip2 ? '<span>' + esc(el.dataset.tip2) + '</span>' : '');
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14;
  let y = ev.clientY + 16;
  if (x + r.width > window.innerWidth - 10) x = ev.clientX - r.width - 12;
  if (y + r.height > window.innerHeight - 10) y = ev.clientY - r.height - 12;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
});

/* ------------------------------------------------------------------ boot */

(async function init() {
  // tira a abertura do caminho depois que ela sai de cena
  const abertura = document.getElementById("abertura");
  if (abertura) setTimeout(() => abertura.remove(), 1400);

  S.settings = await api.getSettings();
  document.documentElement.dataset.theme = S.settings.theme === 'light' ? 'light' : 'dark';
  S.live = await api.live();
  S.update = await api.updateState();
  await load();

  api.onUpdate((data) => {
    const antes = S.update && S.update.status;
    S.update = data;
    if (data.status !== antes || S.page === 'set') renderView();
  });

  api.onLive((data) => {
    const was = S.live;
    S.live = data;
    const exe = data.current && data.current.exe;
    if (exe && !((exe || '').toLowerCase() in ICON_CACHE)) ensureIcons([exe]).then(renderNow);
    else renderNow();
    // Atualiza os numeros da tela Hoje sem redesenhar tudo a cada tick.
    if (S.page === 'hoje' && was && Math.abs(data.activeMs - was.activeMs) > 50000) load(true);
  });

  setInterval(() => load(true), 60000);
})();
