# Túnel Gravitacional

Visualização 3D cinematográfica (Three.js) que explica, para quem nunca estudou
física, o que aconteceria se alguém pulasse num túnel reto que atravessa a
Terra — o famoso "trem gravitacional".

Inspirado em duas imagens geradas por IA ("Túnel a vácuo transterrestre" e
"Túnel até a China"). A visita também corrige os erros de física dessas
imagens (gravidade constante de 9,8 m/s², centro da Terra "vazio", camadas
com nomes trocados).

## Como rodar

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm run build      # gera dist/ (site estático, abre em qualquer hospedagem)
```

Links diretos para um capítulo: `http://localhost:5173/#5` (0 = prólogo).

## O que tem na visita (25 capítulos, 3 partes)

Ao abrir, a tela inicial oferece **começar com som e narração** (recomendado) ou sem som.

**Parte I — o planeta**: prólogo no deserto (o buraco, a exploradora, a placa), a antípoda de Minas
Gerais (Mar das Filipinas, não a China) e o corte animado das camadas da Terra.

**Parte II — documentário "Os Mineiros"** (ficção; técnicas e números reais), num canteiro 3D no
Quadrilátero Ferrífero: cava em bancadas, poço com torre de extração e guincho, sonda com trado,
guindaste, escavadeiras, caminhões, ventilação, geradores, escritório e a cozinha.

| Capítulo | Quem / o quê | Assunto |
|----------|--------------|---------|
| Abertura | voo de drone com rótulos | o Projeto Antípoda e suas 3 frentes |
| Entrevista 1 | Helena, engenheira de minas | o plano |
| Entrevista 2 | Luciana, geóloga | laterita, itabirito (2,4 bi anos), embasamento, gradiente térmico |
| Entrevista 3 | Kelly, operadora de escavadeira | lavra em bancadas |
| Entrevista 4 | Bigode, blaster | plano de fogo, emulsão, retardos — com detonação no "FOGO!" |
| Entrevista 5 | Seu Tião, maquinista do guincho | abertura de poço, torre, skip, gaiola, cabo |
| Entrevista 6 | Rodrigo, sondador | sondagem rotativa, broca diamantada/PDC, lama, Kola (12.262 m) |
| Entrevista 7 | Marquinho, técnico de segurança | calor, ventilação, gelo, autorresgatador |
| Descida | dentro da gaiola | 0 → 3.900 m com rocha, temperatura, pressão e marcos |
| Entrevista 8 | Dona Cida, cozinheira | pão de queijo e a marmita pelo buraco |
| Epílogo | zoom real na crosta | Mponeng (4 km), Kola (12,3 km), fim da crosta (35 km) |

Cada entrevista tem crédito na tela, legendas faladas, transcrição completa e **ficha técnica** no cartão.

**Parte III — a física da queda**: o túnel, o pulo, por que a gravidade diminui, velocidade máxima
no centro, a chegada, o balanço, o satélite rasante, o túnel em corda, primeira pessoa, mito ×
realidade e o modo explorar.

## Parte IV — jogo "Laboratório Antípoda" (`jogo.html`)

Quebra-cabeça em primeira pessoa com **arma de portais**, ambientado num laboratório (fictício)
embaixo de Nova Lima. Abre pelo botão **🎮 Jogar** da visita ou direto em `jogo.html`.

- **Portais com perspectiva real:** cada portal renderiza a cena a partir de uma câmera virtual
  transformada para o outro portal, com projeção fora do eixo enquadrando o portal
  (`CameraUtils.frameCorners`) e plano de recorte na saída; na tela, cada pixel do portal busca a
  imagem pelo cruzamento do raio olho→pixel com o plano do portal. Há recursão (portal dentro de
  portal) e você vê o próprio corpo pelos portais.
- **Física de corpos rígidos (Rapier):** cubos e torretas tombam, giram, empilham e são empurrados; o
  jogador é um *character controller* que colide com eles (dá para subir num cubo, empurrar, usar de
  escudo, derrubar torreta). Enquanto um corpo está na boca de um portal, um filtro de contato desliga
  a colisão com o que fica atrás do plano do portal (`src/game/physics.js`).
- **"O que entra rápido sai rápido":** a passagem é disparada pelo centro de massa e posição +
  velocidade (e giro, nos objetos) passam pela mesma transformação rígida, sem empurrões extras — a
  energia se conserva (num loop entre dois portais no chão você volta sempre à mesma altura). Saindo
  devagar de um portal no chão, há só o mínimo para o corpo sair inteiro; caindo quase reto em cima
  de um portal no chão, um "funil" puxa a trajetória para o centro dele.
- **Tempo lento (botão do meio):** desacelera tudo para ~28% (o mouse continua normal), com som
  abafado, batida de coração, tela dessaturada com vinheta azul e um anel em volta da mira. Gasta uma
  reserva de 6 s (de verdade) mostrada no canto da tela, que recarrega devagar; só no modo solo.
- **Passagem contínua:** a câmera sai do portal exatamente onde a vista dele estava e volta suavemente
  a ficar de pé (giro e posição); se ela ainda estiver atrás da boca do portal, é desenhada do ponto
  equivalente do outro lado, então a imagem nunca "pula".
- **Visual:** borda dos portais animada com faíscas e clarão ao abrir, plasma girando no portal sem
  par, arma de portais detalhada (núcleo com a cor do último portal), amostras com cantos reforçados
  que acendem no botão, botões de piso com luzes, torretas que abrem ao mirar, painéis com relevo
  (`src/game/models.js`).
- **6 câmaras ligadas ao documentário**, com as falas narradas dos personagens:

| Câmara | Personagem | Desafio |
|--------|------------|---------|
| 01 A Bancada | Helena | atravessar um vão com dois portais |
| 02 Itabirito | Luciana | buscar a amostra no alto do pilar e pôr no botão |
| 03 Fogo! | Bigode | lançamento: cair num portal no chão e sair voando pela parede |
| 04 O Poço | Seu Tião | queda de 40 m no poço → lançamento a ~100 km/h |
| 05 Calor | Marquinho | levar a amostra sobre rocha fundida (parede + teto) |
| 06 Antípoda | Dona Cida | abrir a escotilha e atravessar um túnel onde a gravidade diminui, zera no centro e inverte — você chega de cabeça para baixo do outro lado |
| Mapa livre · A Mina | Helena e Marquinho | mapa grande para explorar (sozinho ou em grupo): torres, cava em degraus, rio de rocha fundida com ponte vigiada, galerias, poço de 30 m e sacada — 12 cristais e 9 torretas (desligue por trás com E, derrube com uma amostra arremessada ou com um portal embaixo) |

**Bateria clássica** — 12 testes que seguem a progressão clássica dos jogos de portais (estrutura dos
quebra-cabeças; cenário, nomes e falas próprios), com mecânicas novas: arma achada num pedestal (primeiro
só com o azul, depois a melhoria), portais fixos da fase, portal que troca de lugar sozinho, grade de
desintegração, dispensador de amostras, bola de energia com receptor, plataformas e a fornalha.

| Teste | Personagem | Desafio |
|-------|------------|---------|
| C00 Despertar | Helena | sem arma: amostra do dispensador no botão; a grade da saída |
| C01 Portal Automático | Helena | sem arma: o laranja troca de sala a cada 4 s |
| C02 A Arma | Helena | pegar a arma (só azul) e usar o laranja fixo |
| C03 Celas de Vidro | Luciana | buscar a amostra num poço e levar ao botão no outro |
| C04 Pelo Teto | Bigode | portal embaixo da amostra: ela cai do teto no botão da ilha |
| C05 Dois Botões | Kelly | duas amostras, uma no alto de uma plataforma |
| C06 Bola de Energia | Rodrigo | desviar a bola até o receptor |
| C07 Elevador de Energia | Rodrigo | bola no receptor liga a plataforma sobre a rocha fundida |
| C08 Voo | Bigode | queda de 12 m num portal no chão → voo por cima da rocha fundida |
| C09 Arma Completa | Helena | a melhoria da arma; levar a amostra ao patamar |
| C10 Torretas | Marquinho | amostras como escudo, portal embaixo, empurrão |
| C11 A Amostra Rosa | Dona Cida | levar a amostra rosa até a fornalha |

Controles: mouse para olhar, `W A S D`, botão esquerdo (ou `Q`) portal azul, direito portal laranja,
botão do meio tempo lento, `Espaço` pula, `E` pega/arremessa (cubo ou torreta) ou desliga torreta por
trás, `R` reinicia, `Esc` pausa. Precisa de teclado e mouse.
Progresso salvo no navegador; `jogo.html?todas` libera todas as câmaras e testes.

Original: sem nomes, marcas ou arquivos de outros jogos.

### Multiplayer na rede local

```bash
npm run build
npm run serve        # servidor em 0.0.0.0:5181 (site + WebSocket /ws); mostra os endereços da rede
```

Cada pessoa abre `http://<ip-da-máquina>:5181/jogo.html`, digita um nome e o **mesmo nome de sala** e
clica em **Entrar na sala**. O mapa da sala (qualquer câmara ou o mapa livre) é escolhido por qualquer pessoa no menu de pausa (`Esc`) ou nos cartões do menu, e muda para todos. Até 4 por sala; cada um tem seu par de portais (azul/laranja,
roxo/vermelho, verde/amarelo, ciano/rosa) e todos atravessam os portais de todos. Os outros
aparecem como mineiros com o nome em cima; amostras carregadas, botões e portas são compartilhados;
quando alguém chega ao elevador, a sala inteira vai para a próxima câmara. Quem entra depois cai
direto na câmara em que a sala está. Sem o servidor (`npm run dev`), o jogo funciona só no modo solo.

O servidor (`server.js`) só repassa mensagens entre quem está na mesma sala e guarda a câmara atual e
os portais abertos; não há contas nem dados salvos.

## Som

- **Música procedural** (Web Audio, sem arquivos nem direitos autorais): deserto, espaço, viola
  caipira para Minas, tensão na descida e pulsação na viagem dentro da cápsula; efeitos de
  explosão, ronco do poço e vento da queda.
- **Narração** com as vozes pt-BR instaladas no sistema (Web Speech API): o narrador lê os
  capítulos e cada entrevistado fala suas legendas com tom próprio; a música abaixa durante a fala.
  Sem voz pt-BR instalada, as legendas avançam sozinhas.
- Botões **♪ Música** e **🗣 Narração** na barra superior.

Controles: arrastar = girar, roda/pinça = zoom, botão direito = mover;
`←`/`→` capítulos, `espaço` pausa, `R` recomeça o pulo, `H` modo cinema,
`L` rótulos, `F` tela cheia.

## Física

Tudo em `src/physics.js`, integrado com Runge–Kutta 4 em unidades SI:

- **Terra uniforme** (didática): g(r) = g₀·r/R → movimento harmônico simples,
  ida em **42 min 10 s**, pico de **7,9 km/s** (= velocidade orbital rasante).
- **Terra real (PREM)**: g(r) tabelado do modelo PREM (g até sobe no manto,
  por causa do núcleo denso) → ida em **~38 min**, pico de **~9,9 km/s**.
- Túnel em corda: a aceleração é a componente da gravidade ao longo do túnel,
  g(r)·s/r; no modelo uniforme o período independe da corda.

Simplificações declaradas na própria visita: sem ar, sem rotação da Terra,
sem calor/pressão; túnel e cápsula desenhados gigantes.

## Estrutura

```
src/
  main.js      orquestração: câmera cinematográfica, capítulos, HUD, pós-processamento
  chapters.js  roteiro (textos e o que cada capítulo liga/desliga)
  documentary.js  Parte II: personagens, entrevistas, fichas técnicas
  mine.js      canteiro de mineração 3D (máquinas, pessoas articuladas, poço, explosão)
  audio.js     trilha sonora procedural e efeitos
  narrator.js  narração por voz (Web Speech API)
  game/        Parte IV: world.js (cenário), physics.js (Rapier), portals.js (portais), player.js (jogador), props.js (cubos), turrets.js, energy.js (bolas de energia), models.js (modelos), levels.js (câmaras), classic.js (bateria clássica), sfx.js, main.js
  space.js     Terra com corte em cunha (shaders), túnel, cápsula, satélite, Lua, estrelas
  ground.js    cena do deserto com o buraco (terreno procedural)
  physics.js   modelos de gravidade e simulação
  charts.js    gráficos 2D do painel
  noise.js     ruído procedural (JS e GLSL)
public/textures  texturas da Terra/Lua (exemplos do three.js, licença MIT)
```

Para depurar no console do navegador: `window.__tunel` expõe `goTo`, `sim`,
`space`, `camera`.
