'use strict';

// Cada app e cada site ganha uma cor fixa, tirada do próprio nome.
//
// Antes a cor vinha da categoria — e categoria exigia que o usuário
// classificasse tudo na mão. Assim o gráfico continua legível e ninguém
// precisa configurar nada: o mesmo nome dá sempre a mesma cor.

const PALETA = [
  '#55D396', // verde da marca
  '#45B8E6', // azul
  '#E8B23A', // âmbar
  '#E87BB0', // rosa
  '#8B7BE8', // lilás
  '#3FC8C0', // turquesa
  '#E8605D', // coral
  '#169A50', // verde escuro
  '#C9A227', // mostarda
  '#6E9BE8'  // azul claro
];

const NEUTRA = '#5E6B66';

function corDe(nome) {
  const texto = String(nome || '').trim().toLowerCase();
  if (!texto) return NEUTRA;
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma = (soma * 31 + texto.charCodeAt(i)) >>> 0;
  return PALETA[soma % PALETA.length];
}

module.exports = { corDe, PALETA, NEUTRA };
