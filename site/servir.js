// Servidor estático só para conferir a página antes de publicar.
const http = require('http');
const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const porta = Number(process.argv[2] || 4321);

const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
};

http.createServer((req, res) => {
  let caminho = decodeURIComponent(req.url.split('?')[0]);
  if (caminho === '/' ) caminho = '/index.html';

  // mesma regra do vercel.json, para o botão funcionar no teste
  if (caminho === '/baixar') {
    res.writeHead(302, {
      Location: 'https://github.com/Thiagofernandes-bot/chronos/releases/latest/download/Chronos-instalador.exe'
    });
    return res.end();
  }

  const alvo = path.join(raiz, caminho);
  if (!alvo.startsWith(raiz)) { res.writeHead(403); return res.end('fora da pasta'); }

  fs.readFile(alvo, (erro, dados) => {
    if (erro) { res.writeHead(404); return res.end('nao encontrado'); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(alvo)] || 'application/octet-stream' });
    res.end(dados);
  });
}).listen(porta, () => console.log('site em http://localhost:' + porta));
