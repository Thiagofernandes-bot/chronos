'use strict';

const { EventEmitter } = require('events');

const BROWSERS = new Set(['chrome', 'msedge', 'brave', 'firefox', 'opera', 'opera_gx',
  'vivaldi', 'chromium', 'iexplore', 'arc']);

// Sufixos que o navegador prende no fim do titulo da janela.
const BROWSER_SUFFIX = /\s[-–—]\s(Google Chrome|Microsoft.*Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Chromium)$/i;

function cleanTitle(title, isBrowser) {
  let t = (title || '').trim();
  t = t.replace(/^\(\d+\)\s*/, ''); // contador de notificacoes
  if (isBrowser) t = t.replace(BROWSER_SUFFIX, '').trim();
  return t;
}

// Guarda host + caminho, sem query nem hash: identifica a pagina sem anotar
// parametros de busca ou tokens.
function parseUrl(raw) {
  if (!raw) return { dom: null, url: null };
  let s = raw.trim();
  if (!/^[a-z]+:\/\//i.test(s) && !/^about:/i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    if (!u.hostname) return { dom: null, url: null };
    const dom = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return { dom, url: dom + path };
  } catch (e) {
    return { dom: null, url: null };
  }
}

/**
 * Transforma amostras instantaneas (uma por tick) em segmentos de tempo.
 * Um segmento fecha quando a janela ativa muda, quando o usuario fica ocioso
 * ou quando o rastreio e pausado.
 */
class Tracker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.interval = opts.interval || 2000;
    this.idleAfter = (opts.idleAfter || 300) * 1000;
    this.trackIdle = opts.trackIdle !== false;
    this.current = null;
    this.lastTs = 0;
    this.paused = false;
  }

  setConfig({ interval, idleAfter }) {
    if (interval) this.interval = interval;
    if (idleAfter) this.idleAfter = idleAfter * 1000;
  }

  feed(sample) {
    if (this.paused) return;
    const ts = sample.ts || Date.now();

    // Buraco grande entre amostras (suspensao, probe reiniciado): encerra o
    // segmento no ultimo instante visto em vez de inventar tempo.
    if (this.lastTs && ts - this.lastTs > this.interval * 3) this.close(this.lastTs);
    this.lastTs = ts;

    const idle = (sample.idle || 0) * 1000 >= this.idleAfter;
    let seg;

    if (idle || !sample.exe) {
      seg = { idle: true, exe: null, app: 'Ausente', title: '', dom: null, url: null };
    } else {
      const browser = BROWSERS.has((sample.exe || '').toLowerCase());
      const { dom, url } = browser ? parseUrl(sample.url) : { dom: null, url: null };
      seg = {
        idle: false,
        browser,
        exe: sample.exe,
        app: sample.app || sample.exe,
        title: cleanTitle(sample.title, browser),
        dom,
        url
      };
    }

    const key = this.keyOf(seg);
    if (this.current && this.current.key === key) {
      this.current.e = ts;
      return;
    }

    this.close(ts);
    this.current = Object.assign({ key, s: ts, e: ts }, seg);
    this.emit('change', this.snapshot());
  }

  keyOf(seg) {
    if (seg.idle) return 'idle';
    return [seg.exe, seg.app, seg.url || '', seg.title].join('\u0001');
  }

  close(end) {
    const c = this.current;
    this.current = null;
    if (!c) return null;

    // A troca de janela aconteceu entre a ultima amostra e agora, entao o
    // segmento vale ate "stop". Se houve um buraco (suspensao, probe morto),
    // conta so um intervalo depois da ultima amostra de verdade.
    const stop = Math.max(end || c.e, c.e);
    const gap = stop - c.e;
    const e = gap > this.interval * 1.5 ? c.e + this.interval : stop;
    const dur = e - c.s;
    if (dur < 500) return null;

    const seg = {
      s: c.s,
      e: c.s + dur,
      exe: c.exe,
      app: c.app,
      title: c.title,
      dom: c.dom,
      url: c.url
    };
    if (c.idle) seg.idle = 1;
    if (c.browser) seg.browser = 1;
    this.emit('segment', seg);
    return seg;
  }

  flush() {
    const seg = this.close(this.lastTs || Date.now());
    this.lastTs = 0;
    return seg;
  }

  // Fecha e reabre o segmento em aberto quando ele fica longo demais, para
  // que um desligamento abrupto nao leve embora horas de registro. Na hora de
  // somar, os pedacos voltam a virar um bloco so.
  checkpoint(maxMs) {
    const c = this.current;
    if (!c || this.paused) return;
    const now = this.lastTs || Date.now();
    if (now - c.s < maxMs) return;
    const copy = Object.assign({}, c);
    this.close(now);
    this.current = Object.assign(copy, { s: now, e: now });
  }

  pause() {
    if (this.paused) return;
    this.flush();
    this.paused = true;
    this.emit('change', this.snapshot());
  }

  resume() {
    this.paused = false;
    this.lastTs = 0;
    this.emit('change', this.snapshot());
  }

  snapshot() {
    const c = this.current;
    return {
      paused: this.paused,
      since: c ? c.s : null,
      idle: c ? !!c.idle : false,
      app: c ? c.app : null,
      exe: c ? c.exe : null,
      title: c ? c.title : null,
      dom: c ? c.dom : null
    };
  }
}

module.exports = { Tracker, parseUrl, cleanTitle, BROWSERS };
