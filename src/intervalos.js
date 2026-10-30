'use strict';

// Contas com pedaços de tempo que podem se sobrepor.
//
// Um app pode estar em uso de dois jeitos ao mesmo tempo: na frente (você
// olhando) e tocando (vídeo rodando na outra tela). Somar os dois contaria
// o mesmo minuto duas vezes, então o que vale é a união dos períodos.

/** Junta períodos que se tocam num só. Devolve uma lista nova, ordenada. */
function unir(periodos) {
  if (!periodos || !periodos.length) return [];
  const ordenados = periodos.slice().sort((a, b) => a[0] - b[0]);
  const saida = [ordenados[0].slice()];
  for (let i = 1; i < ordenados.length; i++) {
    const atual = ordenados[i];
    const ultimo = saida[saida.length - 1];
    if (atual[0] <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], atual[1]);
    else saida.push(atual.slice());
  }
  return saida;
}

/** Quanto tempo os períodos cobrem, sem contar sobreposição. */
function duracao(periodos) {
  let total = 0;
  for (const [ini, fim] of unir(periodos)) total += Math.max(0, fim - ini);
  return total;
}

/** O que existe em "a" e não está coberto por "b". */
function subtrair(a, b) {
  const base = unir(a);
  const tirar = unir(b);
  if (!tirar.length) return base;

  const saida = [];
  for (const periodo of base) {
    let ini = periodo[0];
    const fim = periodo[1];
    for (const [ti, tf] of tirar) {
      if (tf <= ini) continue;
      if (ti >= fim) break;
      if (ti > ini) saida.push([ini, Math.min(ti, fim)]);
      ini = Math.max(ini, tf);
      if (ini >= fim) break;
    }
    if (ini < fim) saida.push([ini, fim]);
  }
  return saida;
}

/** Guarda um período na lista daquela chave. */
function juntar(mapa, chave, inicio, fim) {
  if (!chave || fim <= inicio) return;
  let lista = mapa.get(chave);
  if (!lista) { lista = []; mapa.set(chave, lista); }
  lista.push([inicio, fim]);
}

module.exports = { unir, duracao, subtrair, juntar };
