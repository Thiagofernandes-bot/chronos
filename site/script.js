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
