# Chronos

Rastreador de tempo para Windows. Mede quanto tempo você passa em cada
aplicativo e, no navegador, em cada site e em cada aba — tudo gravado só no
seu PC, sem conta, sem nuvem, sem internet.

## Instalar

Na pasta `dist`:

- **Chronos-instalador-1.0.0.exe** — instala com atalho no menu iniciar e na
  área de trabalho.
- **Chronos-portatil-1.0.0.exe** — roda sem instalar (um arquivo só).

O instalador não é assinado digitalmente, então o Windows mostra um aviso do
SmartScreen na primeira vez: *Mais informações → Executar assim mesmo*.

## Como funciona

- Um processo auxiliar de 10 KB (`chronos-probe.exe`, escrito em C#) pergunta
  ao Windows, a cada 2 segundos, qual é a janela ativa, há quanto tempo o
  teclado e o mouse estão parados e — quando a janela é de um navegador — qual
  é a URL da aba aberta, lida pela API de acessibilidade do Windows.
- O app transforma essas amostras em blocos de tempo e grava um arquivo por dia
  em `%APPDATA%\Chronos\dados\AAAA-MM-DD.jsonl`.
- Sem teclado nem mouse pelo tempo configurado (padrão: 5 min), o tempo passa a
  contar como **Ausente**. Bloqueou a tela ou suspendeu o PC, o rastreio pausa.

Navegadores lidos: Chrome, Edge, Brave, Firefox, Opera, Vivaldi.
Se a URL não puder ser lida (PWA, janela sem barra de endereço), o Chronos usa
o título da janela.

### Ícones

Os ícones dos programas são extraídos do próprio executável pelo Windows —
não sai nada do PC para isso. Já os ícones dos sites precisam de internet, por
isso vêm **desligados**: ligue em *Ajustes → Ícones dos sites* se quiser.

### Privacidade

Guarda o domínio e o caminho da página (`youtube.com/watch`), **sem** a query
string — ou seja, sem termos de busca nem tokens de sessão. Nada sai do PC; a
única exceção é a busca de ícones de sites, que é opcional e desligada por
padrão. Para apagar tudo: *Ajustes → Apagar histórico*.

## Identidade visual

- Tipografia **General Sans** (Regular/Medium/Semibold), embutida em
  `src/renderer/fontes` — o app não busca fonte na internet. A família é da
  Indian Type Foundry, distribuída pelo [Fontshare](https://fontshare.com)
  sob a ITF Free Font License.
- Preto `#040605`, verde `#55D396`, verde escuro `#169A50`, cinza `#272C2A` e
  branco, com o degradê verde→turquesa aparecendo na marca, no anel de meta e
  numa luz discreta no rodapé da barra lateral.
- Botões, filtros e etiquetas em pílula com borda de 1px, como no manual.
- As cores das categorias foram reafinadas para conversar com o verde. Se você
  já tinha trocado a cor de alguma categoria na mão, a sua escolha é mantida.

## Telas

- **Hoje** — tempo ativo, um resumo do dia em uma frase, gráfico por hora,
  linha do tempo, meta de foco, categorias e os mais usados (com os sites
  separados do navegador).
- **Aplicativos** — ranking; clique numa linha para ver as janelas/abas.
- **Navegador** — tempo por site; clique para ver as abas daquele site.
- **Categorias** — distribuição e o editor de regras.
- **Histórico** — últimos 30 dias, média por dia e dia mais cheio.
- **Ajustes** — ausência, intervalo, meta, tema, ícones dos sites, iniciar com
  o Windows, exportar CSV, apagar dados.

O botão de sol/lua no topo troca entre o tema claro e o escuro na hora.

### Categorias

Um site vale mais que o app: 2h de YouTube no Chrome entram em
*Entretenimento*, não em "Chrome". As regras já vêm preenchidas (Trabalho,
Jogos, Comunicação, Estudo, Redes sociais, Entretenimento, Sistema) e são
editáveis em *Categorias* — inclusive criando categorias novas. Marque quais
contam como "produtivo" para a meta de foco.

## Desenvolvimento

```bash
npm install
npm run probe    # compila o chronos-probe.exe (usa o csc.exe do Windows)
npm run icons    # gera os ícones PNG/ICO por código
npm start        # roda em modo desenvolvimento
npm run dist     # gera o instalador e o portátil em dist/
```

Variáveis de ambiente úteis:

- `CHRONOS_DATA=<pasta>` — usa outra pasta de dados (modo portátil ou testes).
- `CHRONOS_SHOT=<pasta>` — abre o app, salva um PNG de cada tela e fecha.
  Para conferir o visual sem precisar olhar na mão.

Dados de exemplo para desenvolver sem esperar o dia passar:

```bash
node native/seed-demo.js C:\Temp\chronos-demo
```

## Estrutura

```
native/ChronosProbe.cs   janela ativa, ocioso e URL da aba (C#, UI Automation)
native/make-icons.js     desenha o ícone pixel a pixel e escreve PNG/ICO
src/main.js              janela, bandeja, probe, IPC, pausa automática
src/tracker.js           amostras -> blocos de tempo
src/store.js             arquivos por dia, configuração e agregação
src/categories.js        regras padrão e classificação
src/renderer/            painel (HTML/CSS/JS puro, sem framework)
```
