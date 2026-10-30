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
const alvos = document.querySelectorAll('.sobe');
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
