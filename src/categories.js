'use strict';

// Categorias padrao. Cada regra casa por dominio (quando a amostra veio de um
// navegador), por app/executavel ou por pedaco do titulo da janela.
const DEFAULT_CATEGORIES = [
  {
    id: 'jogos',
    name: 'Jogos',
    color: '#E8605D',
    apps: ['steam', 'epic games', 'riot client', 'league of legends', 'valorant', 'counter-strike',
      'cs2', 'dota', 'battle.net', 'minecraft', 'fortnite', 'rocket league', 'gta', 'roblox',
      'xbox', 'ubisoft connect', 'gog galaxy', 'ea app', 'playnite', 'emulator'],
    domains: ['steampowered.com', 'steamcommunity.com', 'epicgames.com', 'riotgames.com',
      'battle.net', 'xbox.com', 'roblox.com'],
    titles: []
  },
  {
    id: 'trabalho',
    name: 'Trabalho',
    color: '#55D396',
    apps: ['figma', 'photoshop', 'illustrator', 'indesign', 'premiere', 'after effects',
      'lightroom', 'blender', 'canva', 'visual studio code', 'cursor', 'claude', 'windsurf',
      'sublime text', 'webstorm', 'android studio', 'davinci resolve', 'capcut', 'obs studio',
      'excel', 'word', 'powerpoint', 'acrobat'],
    domains: ['figma.com', 'clickup.com', 'notion.so', 'drive.google.com', 'docs.google.com',
      'sheets.google.com', 'slides.google.com', 'canva.com', 'claude.ai', 'chatgpt.com',
      'openai.com', 'github.com', 'gitlab.com', 'vercel.com', 'supabase.com', 'trello.com',
      'asana.com', 'monday.com', 'behance.net', 'dribbble.com', 'linear.app', 'hotmart.com',
      'kiwify.com', 'stripe.com', 'mercadopago.com'],
    titles: []
  },
  {
    id: 'comunicacao',
    name: 'Comunicação',
    color: '#45B8E6',
    apps: ['whatsapp', 'discord', 'slack', 'microsoft teams', 'telegram', 'zoom', 'skype',
      'outlook', 'thunderbird'],
    domains: ['web.whatsapp.com', 'mail.google.com', 'gmail.com', 'outlook.com', 'outlook.live.com',
      'outlook.office.com', 'discord.com', 'slack.com', 'teams.microsoft.com', 'meet.google.com',
      'zoom.us', 'web.telegram.org'],
    titles: []
  },
  {
    id: 'estudo',
    name: 'Estudo',
    color: '#169A50',
    apps: ['kindle', 'anki', 'obsidian'],
    domains: ['udemy.com', 'coursera.org', 'alura.com.br', 'khanacademy.org', 'duolingo.com',
      'edx.org', 'rocketseat.com.br', 'dio.me', 'skillshare.com', 'domestika.org'],
    titles: []
  },
  {
    id: 'social',
    name: 'Redes sociais',
    color: '#E87BB0',
    apps: [],
    domains: ['instagram.com', 'facebook.com', 'tiktok.com', 'x.com', 'twitter.com',
      'linkedin.com', 'reddit.com', 'threads.net', 'threads.com', 'pinterest.com',
      'snapchat.com', 'bsky.app', 'kwai.com'],
    titles: []
  },
  {
    id: 'entretenimento',
    name: 'Entretenimento',
    color: '#E8B23A',
    apps: ['spotify', 'netflix', 'vlc', 'media player', 'twitch', 'prime video', 'disney'],
    domains: ['youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'spotify.com',
      'primevideo.com', 'disneyplus.com', 'globoplay.globo.com', 'max.com', 'hbomax.com',
      'crunchyroll.com', 'soundcloud.com', 'deezer.com', 'ge.globo.com', '9gag.com'],
    titles: []
  },
  {
    id: 'sistema',
    name: 'Sistema',
    color: '#78857F',
    apps: ['explorador de arquivos', 'windows explorer', 'file explorer', 'configurações',
      'settings', 'painel de controle', 'control panel', 'gerenciador de tarefas',
      'task manager', 'terminal', 'powershell', 'prompt de comando', 'command prompt',
      'instalador', 'installer', 'setup', 'área de trabalho', 'desktop window manager',
      'shell experience', 'pesquisar', 'search'],
    domains: [],
    titles: []
  }
];

const OTHER = { id: 'outros', name: 'Outros', color: '#5E6B66' };

// Cores da primeira versão: quando a categoria salva ainda está com uma
// delas, a troca para a paleta nova é automática.
const LEGACY_COLORS = {
  jogos: '#FF5C5C',
  trabalho: '#6D5BFF',
  comunicacao: '#3BA9FF',
  estudo: '#28D6A8',
  social: '#FF7AC8',
  entretenimento: '#FFB020',
  sistema: '#8A8FA0'
};

function norm(s) {
  return (s || '').toString().toLowerCase();
}

function hasPart(list, value) {
  if (!value) return false;
  const v = norm(value);
  for (const item of list) {
    if (v.includes(norm(item))) return true;
  }
  return false;
}

// Dominio casa do fim para o inicio, para que "youtube.com" pegue
// "music.youtube.com" sem pegar "naoyoutube.com".
function domainMatches(list, domain) {
  if (!domain) return false;
  const d = norm(domain);
  for (const item of list) {
    const r = norm(item);
    if (d === r || d.endsWith('.' + r)) return true;
  }
  return false;
}

/**
 * Descobre a categoria de um segmento.
 * Segmentos de navegador sao classificados pelo site, nunca pelo nome do
 * navegador: duas horas de YouTube nao sao duas horas de "Chrome".
 */
function classify(seg, categories) {
  const cats = categories && categories.length ? categories : DEFAULT_CATEGORIES;

  if (seg.dom) {
    for (const c of cats) if (domainMatches(c.domains || [], seg.dom)) return c.id;
  } else if (!seg.browser) {
    for (const c of cats) {
      if (hasPart(c.apps || [], seg.app) || hasPart(c.apps || [], seg.exe)) return c.id;
    }
  }
  for (const c of cats) if (hasPart(c.titles || [], seg.title)) return c.id;
  return OTHER.id;
}

function categoryMap(categories) {
  const map = {};
  for (const c of (categories && categories.length ? categories : DEFAULT_CATEGORIES)) {
    map[c.id] = { id: c.id, name: c.name, color: c.color };
  }
  map[OTHER.id] = OTHER;
  return map;
}

module.exports = { DEFAULT_CATEGORIES, OTHER, LEGACY_COLORS, classify, categoryMap };
