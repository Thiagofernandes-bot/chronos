'use strict';

// Gera um historico ficticio para conferir as telas durante o desenvolvimento.
// Uso: node native/seed-demo.js <pasta>   (nunca aponte para os dados reais)

const fs = require('fs');
const path = require('path');

const out = path.join(process.argv[2] || path.join(process.env.TEMP, 'chronos-demo'), 'dados');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const APPS = [
  { app: 'Figma', exe: 'Figma', w: 26, titles: ['Midia Kit — Joni Pet Experience', 'ALUGGO · Stories', 'IDV Lilium Domina'] },
  { app: 'Claude', exe: 'claude', w: 10, titles: ['Chronos — tracker', 'Carrossel CAUP'] },
  { app: 'Visual Studio Code', exe: 'Code', w: 8, titles: ['app.js — chronos', 'styles.css — chronos'] },
  { app: 'WhatsApp', exe: 'WhatsApp.Root', w: 7, titles: ['Renata', 'Equipe Starty'] },
  { app: 'Discord', exe: 'Discord', w: 6, titles: ['Trabalhando | j.'] },
  { app: 'Spotify', exe: 'Spotify', w: 4, titles: ['Tim Maia — Azul da Cor do Mar'] },
  { app: 'Explorador de Arquivos', exe: 'explorer', w: 4, titles: ['Downloads', 'Projetos Claude'] },
  { app: 'Steam', exe: 'steam', w: 5, titles: ['Biblioteca'] },
  { app: 'Adobe Photoshop', exe: 'Photoshop', w: 5, titles: ['capa-reels.psd'] }
];

const SITES = [
  { dom: 'figma.com', w: 14, titles: ['Midia Kit — Joni Pet Experience', 'ALUGGO — Figma'] },
  { dom: 'youtube.com', w: 13, titles: ['Como criar carrosséis que vendem', 'Lo-fi para focar', 'Review do novo iPhone'] },
  { dom: 'app.clickup.com', w: 9, titles: ['LILIUM DOMINA | CARROSSEL', 'Minhas tarefas'] },
  { dom: 'instagram.com', w: 8, titles: ['Feed', 'Direct', '@onovomercado'] },
  { dom: 'drive.google.com', w: 6, titles: ['Meu Drive — Projetos'] },
  { dom: 'mail.google.com', w: 5, titles: ['Caixa de entrada (3)'] },
  { dom: 'chatgpt.com', w: 4, titles: ['Ideias de pauta'] },
  { dom: 'web.whatsapp.com', w: 4, titles: ['Clientes'] },
  { dom: 'netflix.com', w: 3, titles: ['Senna — Episódio 2'] },
  { dom: 'linkedin.com', w: 3, titles: ['Feed'] },
  { dom: 'globo.com', w: 2, titles: ['Notícias'] }
];

function pick(list) {
  const total = list.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * total;
  for (const it of list) { r -= it.w; if (r <= 0) return it; }
  return list[0];
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

const now = new Date();
for (let back = 29; back >= 0; back--) {
  const day = new Date(now.getTime() - back * 864e5);
  const dow = day.getDay();
  const lines = [];

  const startHour = dow === 0 || dow === 6 ? 11 : 9;
  const endHour = back === 0 ? now.getHours() + now.getMinutes() / 60 : (dow === 0 || dow === 6 ? 19 : 22.5);
  let t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour, Math.floor(Math.random() * 40)).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() + endHour * 3600e3;

  while (t < end) {
    // blocos de 4 a 40 minutos, com pausas e ausencias
    const roll = Math.random();
    if (roll < 0.12) {
      const idle = (8 + Math.random() * 45) * 60000;
      lines.push(JSON.stringify({ s: t, e: t + idle, exe: null, app: 'Ausente', title: '', dom: null, url: null, idle: 1 }));
      t += idle;
      continue;
    }
    const dur = (3 + Math.random() * 32) * 60000;
    const inBrowser = Math.random() < 0.46;
    if (inBrowser) {
      const site = pick(SITES);
      const title = site.titles[Math.floor(Math.random() * site.titles.length)];
      lines.push(JSON.stringify({
        s: t, e: t + dur, exe: 'chrome', app: 'Google Chrome', title,
        dom: site.dom, url: site.dom + '/', browser: 1
      }));
    } else {
      const a = pick(APPS);
      const title = a.titles[Math.floor(Math.random() * a.titles.length)];
      lines.push(JSON.stringify({ s: t, e: t + dur, exe: a.exe, app: a.app, title, dom: null, url: null }));
    }
    t += dur;
  }

  fs.writeFileSync(path.join(out, key(day) + '.jsonl'), lines.join('\n') + '\n');
}

console.log('dados de exemplo em ' + out);
