'use strict';

// O que separa "uso" de "ruído".
//
// O Windows deixa em primeiro plano um monte de janela que não é aplicativo
// nenhum: o Alt+Tab, o estouro da bandeja, a área de trabalho, o assistente
// de encaixe. E vários processos auxiliares (webview de app, helper do Steam)
// aparecem por 2 segundos sem que ninguém os tenha usado. Nada disso deveria
// virar linha no relatório.

// Processos que são peça da interface do Windows ou motor interno de outro
// app — nunca contam como tempo de uso.
const EXES_IGNORADOS = new Set([
  'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'searchapp',
  'searchui', 'textinputhost', 'lockapp', 'applicationframehost', 'dwm',
  'sihost', 'peopleexperiencehost', 'windowsinternal.composableshell.experiences.textinput.inputapp',
  'msedgewebview2', 'steamwebhelper', 'crashpad_handler', 'widgets', 'widgetboard',
  // processo nulo do Windows: aparece quando a janela em foco não tem dono
  'idle', 'system', '?'
]);

// Títulos que o shell usa nas próprias janelas invisíveis.
const TITULOS_IGNORADOS = [
  'alternância de tarefas', 'task switching',
  'janela de estouro da bandeja do sistema', 'system tray overflow window',
  'program manager', 'área de trabalho', 'desktop',
  'assistente de ajuste', 'snap assist',
  'configurações rápidas', 'quick settings',
  'central de notificações', 'notification center',
  'pesquisar', 'search', 'início', 'start',
  'nova notificação', 'new notification'
];

// FileDescription que vários executáveis do Windows compartilham: não diz
// nada sobre qual programa é.
const NOMES_GENERICOS = [
  'microsoft® windows® operating system',
  'microsoft windows operating system',
  'sistema operacional microsoft® windows®',
  'host de aplicativo', 'application host'
];

// Nome decente para os processos cujo próprio arquivo não traz um.
const NOMES_CONHECIDOS = {
  taskmgr: 'Gerenciador de Tarefas',
  explorer: 'Windows Explorer',
  cmd: 'Prompt de Comando',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  windowsterminal: 'Terminal do Windows',
  rundll32: 'Windows',
  systemsettings: 'Configurações',
  chronos: 'Chronos'
};

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

/** Essa amostra é uma janela de verdade ou peça do shell? */
function ehRuido(exe, title) {
  const e = norm(exe);
  if (!e) return true;
  if (EXES_IGNORADOS.has(e)) return true;

  const t = norm(title);
  if (TITULOS_IGNORADOS.indexOf(t) >= 0) return true;

  // Explorer sem título é a área de trabalho, não uma pasta aberta.
  if (e === 'explorer' && !t) return true;

  return false;
}

// Jogo de loja guarda o nome bonito na pasta (steamapps\common\THE FINALS),
// enquanto o executável costuma ter nome interno — "Discovery.exe", no caso.
const PASTAS_DE_JOGO = [
  /\\steamapps\\common\\([^\\]+)\\/i,
  /\\Epic Games\\([^\\]+)\\/i,
  /\\GOG Games\\([^\\]+)\\/i,
  /\\Riot Games\\([^\\]+)\\/i,
  /\\Origin Games\\([^\\]+)\\/i
];

function nomeDePastaDeJogo(caminho) {
  if (!caminho) return null;
  for (const padrao of PASTAS_DE_JOGO) {
    const achou = String(caminho).match(padrao);
    if (achou) {
      const nome = achou[1].trim();
      if (nome.length > 1 && norm(nome) !== 'bin') return nome;
    }
  }
  return null;
}

/** Nome de exibição do aplicativo, já sem lixo de fabricante. */
function nomeApp(app, exe, caminho) {
  const doJogo = nomeDePastaDeJogo(caminho);
  if (doJogo) return doJogo;

  const e = norm(exe);
  if (NOMES_CONHECIDOS[e]) return NOMES_CONHECIDOS[e];

  let nome = String(app || exe || '?').trim();
  const baixo = norm(nome);

  // Descrição genérica ou frase inteira no lugar do nome (alguns instaladores
  // põem a descrição do produto ali) — o nome do executável diz mais.
  const ehFrase = nome.length > 42 || nome.indexOf(':') >= 0;
  if (NOMES_GENERICOS.indexOf(baixo) >= 0 || ehFrase) {
    nome = exe ? exe.replace(/[._-]+/g, ' ').trim() : nome;
  }

  nome = nome.replace(/\.(root|app|desktop|client)$/i, '');
  nome = nome.replace(/\s*\((32|64)[- ]?bits?\)$/i, '');
  return nome.trim() || String(exe || '?');
}

// Caracteres invisíveis que alguns jogos espalham no título da janela para
// atrapalhar leitura automática. Sem tirar, cada leitura vira um título
// diferente e o tempo nunca soma.
const INVISIVEIS = /[​-‏‪-‮⁠﻿­]/g;

function semInvisiveis(texto) {
  return String(texto || '').replace(INVISIVEIS, '').replace(/\s{2,}/g, ' ').trim();
}

/** Título da janela sem o sufixo do próprio programa. */
function tituloLimpo(title, app, exe) {
  let t = semInvisiveis(title);
  if (!t) return '';

  const sufixos = [app, exe, NOMES_CONHECIDOS[norm(exe)]].filter(Boolean);
  for (const s of sufixos) {
    const escapado = String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp('\\s*[-–—]\\s*' + escapado + '\\s*$', 'i'), '');
  }
  return t.trim();
}

module.exports = {
  ehRuido, nomeApp, tituloLimpo, semInvisiveis, nomeDePastaDeJogo, NOMES_CONHECIDOS
};
