// Só três coisas: a barra que ganha fundo ao rolar, a entrada dos blocos e
// um leve afastamento da janela grande do herói. Nada depende disso para a
// página funcionar — sem JS ela continua inteira e legível.

const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------- barra topo */
const topo = document.getElementById('topo');
const marcaTopo = () => topo.classList.toggle('preso', scrollY > 24);
marcaTopo();
addEventListener('scroll', marcaTopo, { passive: true });

/* ----------------------------------------------------------- entrada suave */
const alvos = document.querySelectorAll('.sobe, .revela');
if (calmo || !('IntersectionObserver' in window)) {
  alvos.forEach((el) => el.classList.add('vis'));
} else {
  const olho = new IntersectionObserver((itens) => {
    itens.forEach((it) => {
      if (!it.isIntersecting) return;
      // um atraso curto por irmão deixa o bento entrar em cascata
      const irmaos = [...it.target.parentElement.children].filter((e) => e.classList.contains('sobe'));
      it.target.style.transitionDelay = Math.min(irmaos.indexOf(it.target), 4) * 70 + 'ms';
      it.target.classList.add('vis');
      olho.unobserve(it.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  alvos.forEach((el) => olho.observe(el));

  // Rede de seguranca: se por algum motivo o observador nao disparar, nada
  // pode ficar invisivel. Passado um tempo, tudo que ja esta na tela entra.
  setTimeout(() => {
    alvos.forEach((el) => {
      if (el.classList.contains('vis')) return;
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) {
        el.classList.add('vis');
        olho.unobserve(el);
      }
    });
  }, 1400);
}

/* ------------------------------------------- a janela do herói se endireita */
// Ela aparece deitada para trás e vai ficando de frente conforme sobe na
// tela. Quem desliga animação no sistema recebe a janela reta e parada.
const palco = document.querySelector('.palco');
const janela = document.querySelector('.palco .janela');

if (janela && !calmo) {
  const ZOOM = 0.94;                                  // tamanho no começo
  const giroMaximo = () => (innerWidth < 760 ? 11 : 19); // graus no começo

  let pedido = 0;
  const endireitar = () => {
    pedido = 0;
    const topo = janela.getBoundingClientRect().top;
    // 0 com a quina de cima quase no pé da tela, 1 quando ela chega a 20%
    const bruto = (innerHeight * 0.92 - topo) / (innerHeight * 0.72);
    const t = Math.min(Math.max(bruto, 0), 1);
    const suave = 1 - Math.pow(1 - t, 2);
    janela.style.setProperty('--giro', ((1 - suave) * giroMaximo()).toFixed(2) + 'deg');
    janela.style.setProperty('--zoom', (ZOOM + suave * (1 - ZOOM)).toFixed(4));
  };
  endireitar();
  addEventListener('scroll', () => { if (!pedido) pedido = requestAnimationFrame(endireitar); }, { passive: true });
  addEventListener('resize', endireitar, { passive: true });

  // a varredura de luz acontece uma vez, quando a janela entra em cena
  if ('IntersectionObserver' in window) {
    const olhoPalco = new IntersectionObserver((itens) => {
      itens.forEach((it) => {
        if (!it.isIntersecting) return;
        palco.classList.add('acende');
        olhoPalco.disconnect();
      });
    }, { threshold: 0.25 });
    olhoPalco.observe(janela);
  } else {
    palco.classList.add('acende');
  }

  // e a luz do mouse passeia por cima da tela
  janela.addEventListener('pointermove', (e) => {
    const r = janela.getBoundingClientRect();
    janela.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    janela.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
  });
}

/* --------------------------------------- a peca e os recortes seguem o mouse */
// A peca anda para um lado e os recortes para o outro, mais rapido. E so isso
// que cria a sensacao de que uns estao na frente e outros atras.
const obj = document.querySelector('.heroi-obj');
const heroi = document.querySelector('.heroi');

if (obj && heroi && !calmo) {
  let pedidoObj = 0;
  let alvoX = 0;
  let alvoY = 0;

  const aplicar = () => {
    pedidoObj = 0;
    obj.style.setProperty('--px', alvoX.toFixed(3));
    obj.style.setProperty('--py', alvoY.toFixed(3));
  };

  heroi.addEventListener('pointermove', (e) => {
    const r = heroi.getBoundingClientRect();
    // -1 a 1 a partir do centro do heroi
    alvoX = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2)));
    alvoY = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2)));
    if (!pedidoObj) pedidoObj = requestAnimationFrame(aplicar);
  });

  heroi.addEventListener('pointerleave', () => {
    alvoX = 0;
    alvoY = 0;
    if (!pedidoObj) pedidoObj = requestAnimationFrame(aplicar);
  });
}

/* ------------------------------------------- a palavra que fica trocando */
// Sem JS o HTML ja mostra "foi.", que e uma frase inteira. Daqui para baixo e
// so enfeite: a largura do bloco acompanha a palavra para o ponto final nao
// pular de lugar.
const gira = document.querySelector('.gira');

if (gira) {
  const palavras = (gira.dataset.palavras || '').split('|').filter(Boolean);

  if (palavras.length > 1) {
    const texto = gira.textContent.trim();
    gira.textContent = '';

    const p = document.createElement('span');
    p.className = 'p';
    p.textContent = texto;

    const medidor = document.createElement('span');
    medidor.className = 'medidor';
    medidor.setAttribute('aria-hidden', 'true');

    gira.append(p, medidor);
    gira.style.width = p.offsetWidth + 'px';

    let i = palavras.indexOf(texto);
    if (i < 0) i = 0;

    // Troca o span inteiro em vez de mexer em classe: um elemento recem-criado
    // ja nasce rodando a animacao de entrada. Nada depende de
    // requestAnimationFrame, que o navegador congela em aba de fundo — foi
    // assim que a palavra ficou invisivel na primeira tentativa.
    const trocar = () => {
      i = (i + 1) % palavras.length;
      const prox = palavras[i];
      medidor.textContent = prox;
      const largura = medidor.offsetWidth;
      const velho = gira.querySelector('.p');

      gira.style.width = largura + 'px';

      if (calmo) {
        velho.textContent = prox;
        return;
      }

      velho.classList.add('fora');
      const novo = document.createElement('span');
      novo.className = 'p';
      novo.textContent = prox;
      gira.insertBefore(novo, medidor);
      setTimeout(() => velho.remove(), 420);
    };

    setInterval(trocar, 2000);
  }
}

/* ----------------------------------------------------------------- cursor */
// Um ponto que fica exatamente onde o mouse esta (para nao perder pontaria) e
// um anel que chega atrasado. Some em touch e para quem pediu menos movimento.
const ponto = document.querySelector('.cur-ponto');
const anel = document.querySelector('.cur-anel');
const fino = matchMedia('(hover: hover) and (pointer: fine)').matches;

if (ponto && anel && fino && !calmo) {
  const raiz = document.documentElement;
  const clicavel = 'a, button, summary, input, textarea, [role="button"]';
  let x = innerWidth / 2;
  let y = innerHeight / 2;
  let ax = x;
  let ay = y;
  let vivo = false;

  const quadro = () => {
    // o anel persegue o ponto; 0.18 e o quanto ele encosta a cada quadro
    ax += (x - ax) * 0.18;
    ay += (y - ay) * 0.18;
    anel.style.translate = ax.toFixed(1) + 'px ' + ay.toFixed(1) + 'px';
    requestAnimationFrame(quadro);
  };
  requestAnimationFrame(quadro);

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX;
    y = e.clientY;
    ponto.style.translate = x + 'px ' + y + 'px';
    if (!vivo) {
      vivo = true;
      raiz.classList.add('cursor-vivo');
      // o anel comeca junto, senao entra voando da ultima posicao
      ax = x;
      ay = y;
    }
    raiz.classList.toggle('perto', !!(e.target.closest && e.target.closest(clicavel)));
  }, { passive: true });

  addEventListener('pointerdown', () => raiz.classList.add('aperta'));
  addEventListener('pointerup', () => raiz.classList.remove('aperta'));
  addEventListener('pointerleave', () => raiz.classList.remove('cursor-vivo'));
  addEventListener('blur', () => raiz.classList.remove('cursor-vivo'));
}

/* ----------------------------------------- esteira: duplica para dar a volta */
// A animacao anda -50%, entao o conteudo precisa estar duas vezes no trilho
// para o rabo encostar na cabeca sem salto.
const trilho = document.querySelector('.esteira .trilho');
if (trilho) {
  const copia = trilho.firstElementChild.cloneNode(true);
  copia.setAttribute('aria-hidden', 'true');
  trilho.append(copia);
}

/* -------------------------------- uma so passada de scroll para a pagina toda */
const barra = document.querySelector('.progresso i');
const faixaImg = document.querySelector('.faixa > img');
const faixaSec = document.querySelector('.faixa');
const passos = document.querySelector('.passos');
const listaPassos = passos ? [...passos.querySelectorAll('.passo')] : [];

let pedidoRolagem = 0;
const naRolagem = () => {
  pedidoRolagem = 0;
  const altura = document.documentElement.scrollHeight - innerHeight;

  if (barra) {
    barra.style.setProperty('--rolagem', altura > 0 ? (scrollY / altura).toFixed(4) : '0');
  }

  // a imagem da faixa anda mais devagar que a pagina; o scale 1.14 do CSS e
  // justamente a folga para ela se mexer sem mostrar borda
  if (faixaImg && faixaSec && !calmo) {
    const r = faixaSec.getBoundingClientRect();
    if (r.bottom > -200 && r.top < innerHeight + 200) {
      const meio = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      faixaImg.style.setProperty('--par', (meio * 46).toFixed(1) + 'px');
    }
  }

  // o fio dos passos enche conforme a secao atravessa a tela
  if (passos) {
    const r = passos.getBoundingClientRect();
    const bruto = (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.25);
    const t = Math.min(Math.max(bruto, 0), 1);
    passos.style.setProperty('--anda', t.toFixed(3));
    listaPassos.forEach((p, i) => {
      p.classList.toggle('ativo', t >= (i + 0.35) / listaPassos.length);
    });
  }
};

naRolagem();
addEventListener('scroll', () => { if (!pedidoRolagem) pedidoRolagem = requestAnimationFrame(naRolagem); }, { passive: true });
addEventListener('resize', naRolagem, { passive: true });

/* ------------------------------------------------- faq que abre e fecha macio */
// O <details> normal pisca o conteudo inteiro de uma vez. Aqui eu seguro o
// clique, animo a altura com a Web Animations API (que nao depende de
// requestAnimationFrame) e so entao mexo no atributo open.
document.querySelectorAll('.faq details').forEach((det) => {
  const resumo = det.querySelector('summary');
  const resp = det.querySelector('.resp');
  if (!resumo || !resp) return;
  let animando = false;

  resumo.addEventListener('click', (e) => {
    if (calmo) return;
    e.preventDefault();
    if (animando) return;
    animando = true;

    const abrindo = !det.open;
    if (abrindo) det.open = true;
    const alvo = resp.scrollHeight;

    const quadros = abrindo
      ? [{ height: '0px', opacity: 0 }, { height: alvo + 'px', opacity: 1 }]
      : [{ height: alvo + 'px', opacity: 1 }, { height: '0px', opacity: 0 }];

    const anim = resp.animate(quadros, { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim.onfinish = () => {
      resp.style.height = '';
      if (!abrindo) det.open = false;
      animando = false;
    };
  });
});
