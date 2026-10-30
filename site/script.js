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

/* --------------------------------------------------- janela do herói flutua */
const palco = document.querySelector('.palco .janela');
if (palco && !calmo) {
  let pedido = 0;
  const mover = () => {
    pedido = 0;
    const topoPalco = palco.getBoundingClientRect().top;
    if (topoPalco > innerHeight || topoPalco < -palco.offsetHeight) return;
    // sobe no máximo 26px enquanto a janela atravessa a tela
    const avanco = Math.min(Math.max((innerHeight - topoPalco) / innerHeight, 0), 1);
    palco.style.transform = 'translateY(' + (26 - avanco * 26).toFixed(1) + 'px)';
  };
  mover();
  addEventListener('scroll', () => { if (!pedido) pedido = requestAnimationFrame(mover); }, { passive: true });
}
