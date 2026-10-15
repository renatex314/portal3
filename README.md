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

## 🦖 Dinossauros (em tudo)

Todos os dinossauros são procedurais (`src/dinos.js`): elipsoides e cilindros com pivôs nas
articulações, animados por código (andar, correr, pastar, voar, rugir). Espécies: T-rex, raptor,
titanossauro, tricerátops, estegossauro e pterossauro, além de esqueletos fósseis. O rugido é
sintetizado (`Soundtrack.roar` em `src/audio.js`).

- **Deserto (prólogo):** um T-rex ronda o buraco e ruge, raptores correm em bando, titanossauros
  passeiam no horizonte, pterossauros voam, a exploradora tem um filhote de tricerátops, há um
  fóssil exposto na parede do buraco e uma placa "CUIDADO: DINOSSAUROS".
- **Documentário:** T-rex de capacete andando no comboio dos caminhões, raptores de capacete na
  borda da cava, titanossauros, estegossauro e tricerátops pastando, pterossauros sobre a cava, um
  raptor (o Pipoca) na gaiola da descida e um filhote de tricerátops na cozinha. Nova entrevista com
  a paleontóloga **Patrícia** (personagem fictícia; fatos reais): o itabirito é ~10× mais velho que
  os dinossauros, os dinossauros de Minas (Peirópolis/Uberaba e Prata), os erros dos figurantes e
  "aves são dinossauros" — com o T-rex rugindo atrás dela.
- **Física:** um T-rex de capacete surfa em cima da cápsula (e cai junto: no vácuo, peso não muda a
  queda), um tricerátops vai na cápsula do túnel em corda, um pterossauro voa com o satélite, o pino
  de **Chicxulub** marca o asteroide que extinguiu os dinossauros, o gráfico do "balanço" virou um
  🦖 de skate e o "Mito × realidade" ganhou o mito do T-rex que cai mais rápido.
- **Jogo:** você e os outros jogadores são raptores de capacete (aparecem pelos portais), cada
  cabine tem um raptor-mascote, as torretas viraram "T-rex robôs", as amostras têm pegada de
  dinossauro, as câmaras têm pterossauros, tricerátops e fósseis, e o mapa livre tem um T-rex no
  pátio que ruge e **empurra** quem fica na frente dele.

## O que tem na visita (26 capítulos, 3 partes)

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
| Entrevista 3 | Patrícia, paleontóloga | por que não há fósseis aqui, dinossauros de Minas, aves são dinossauros — e o T-rex ruge |
| Entrevista 4 | Kelly, operadora de escavadeira | lavra em bancadas |
| Entrevista 5 | Bigode, blaster | plano de fogo, emulsão, retardos — com detonação no "FOGO!" |
| Entrevista 6 | Seu Tião, maquinista do guincho | abertura de poço, torre, skip, gaiola, cabo |
| Entrevista 7 | Rodrigo, sondador | sondagem rotativa, broca diamantada/PDC, lama, Kola (12.262 m) |
| Entrevista 8 | Marquinho, técnico de segurança | calor, ventilação, gelo, autorresgatador |
| Descida | dentro da gaiola | 0 → 3.900 m com rocha, temperatura, pressão e marcos |
| Entrevista 9 | Dona Cida, cozinheira | pão de queijo e a marmita pelo buraco |
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
  reserva de 6 s (de verdade) mostrada no canto da tela, que recarrega no mesmo ritmo em que gasta
  (6 s gastos voltam em 6 s); só no modo solo.
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

**Desafios hardcore** — 5 salas enormes (até ~190 m) para quem quer sofrer: plataformas que voam na
diagonal com paradas de meio segundo nas pontas, pistões que esmagam (inclusive sobre rampas), rampas
inclinadas, chuva de bolas de energia, torretas e grades de desintegração horizontais que apagam os
portais no meio de uma queda (é preciso abri-los no ar). Feitas para o tempo lento.

| Desafio | Personagem | O que tem |
|---------|------------|-----------|
| H01 Pistões Diagonais | Bigode | sem arma: quatro plataformas diagonais e uma rampa com pistões |
| H02 Esmagadores | Rodrigo | seis pistões fora de sincronia, chuva de bolas de energia, ponte |
| H03 Queda Livre | Seu Tião | queda de 50 m: a grade apaga os portais, abra os dois no ar e voe para o túnel |
| H04 Rampas e Torretas | Marquinho | terraços ligados por rampas sobre rocha fundida, torretas, plataforma final |
| H05 Inferno | Dona Cida | bola de energia liga as plataformas, pistões, elevador e mergulho com grade |

**Série Momento** — 10 testes enormes (até ~300 m), todos difíceis, resolvidos com momento (os quatro últimos misturam o momento com bolas de energia, buracos negros, viagem no tempo e torretas). **Painéis
diagonais** de concreto claro aceitam portal em qualquer inclinação: você cai num portal no chão e sai
voando por um painel inclinado (o que entra rápido sai rápido). O próximo par de portais tem de ser
aberto **em pleno voo** — no painel pega-voo (moldura laranja) onde você vai cair e no próximo painel
lançador (moldura azul, a seta mostra para onde ele atira). Grades de desintegração no meio do caminho
apagam os portais e barram os tiros, então nada fica pronto antes. Uma assistência de mira (como nos
jogos do gênero) puxa de leve para o centro do portal quem chega voando de encontro a ele.

| Teste | Personagem | O que tem |
|-------|------------|-----------|
| M01 Arremesso em Cadeia | Bigode | poço de 34 m, salão em L, duas grades: dois pares de portais no ar |
| M02 Queda Infinita | Seu Tião | chão + teto até 115 km/h, portal aberto caindo pela janela, voo de 100 m, painel quase em pé até a plataforma a 40 m |
| M03 Zigue-Zague | Kelly | quatro arremessos cruzando o salão na diagonal, três grades, três pares no ar |
| M04 Gêiser | Rodrigo | voo rasante, portal na parede onde você bate e outro no chão: a velocidade vira subida até a torre |
| M05 Mergulho | Marquinho | queda de 100 m com uma grade horizontal no meio: portais abertos caindo, depois mais um par no voo |
| M06 Do Outro Lado | Helena | tudo junto: queda infinita, parede-gêiser e zigue-zague — quatro pares de portais no ar |
| M07 Fogo Cruzado | Bigode | cinco arremessos em zigue-zague com a grade colada no painel de captura (meio segundo para abrir os portais) e bolas de energia cruzando cada voo |
| M08 Singularidade | Kelly | quatro buracos negros entortam os voos: o painel de captura fica onde a curva leva você (medido por simulação) |
| M09 Paradoxo | Dona Cida | o percurso do Fogo Cruzado com paredões que só existem no passado ou no futuro: troque de época (T) no ar, duas vezes por salto |
| M10 Horizonte de Eventos | Seu Tião | tudo junto: buracos negros, paredões de duas épocas, bolas de energia e torretas guardando a plataforma de saída |

Todos foram resolvidos por um robô de teste que joga com a física real do jogo (pelo console:
`__jogo.manual = true` e `__jogo.step(1/60)` avançam a simulação quadro a quadro).

**Série Fronteira** — 4 mapas enormes que juntam tudo: **lasers** (atravessam portais e vidro,
queimam o jogador e as torretas) com **cubos refletores** e receptores, **placas de lançamento**,
**funis de excursão** (feixe que carrega sem gravidade, atravessa portais e pode ser ligado por
sinal), **bolas de energia**, **viagem no tempo** (`T` alterna entre o passado e o futuro da mesma
sala: paredes, chãos, rampas e pontes existem só numa época), **antigravidade** (corredor de
gravidade invertida e torre sem peso), **buracos negros** (puxam o jogador, os objetos e até
curvam as bolas de energia; o horizonte não devolve nada) e um **portal para a Lua** (um tiro na
Lua pela claraboia abre o portal lá; o vácuo puxa tudo, e a Lua tem gravidade lunar).

| Teste | Personagem | O que tem |
|-------|------------|-----------|
| F01 Feixe e Fé | Rodrigo | laser e cubo refletor, placa de lançamento, torretas queimadas atrás do vidro, funil de 84 m pelos portais, bola de energia do teto ao receptor |
| F02 Ecos do Tempo | Dona Cida | muro rachado no futuro, rampa só no passado, queda de 16 m num buraco do futuro com arremesso pela parede, torretas por trás pelos portais |
| F03 Horizonte de Eventos | Seu Tião | corredor de gravidade invertida com bola de energia, laser mandado pelos portais até o fundo do salão, funil por cima do buraco negro, torre sem peso |
| F04 Mar da Tranquilidade | Helena | tudo junto: bola de energia, placa, laser e torretas, claraboia, portal na Lua, cânion lunar com a ponte de 2031, buraco negro, a base de 2187 e o funil até a saída |

Os quatro também foram resolvidos de ponta a ponta pelo robô de teste.

**Série Chefes** — um inimigo gigante por fase, resolvido com foguetes devolvidos pelos portais e núcleos queimados na fornalha.

| Chefe | Personagem | O que tem |
|-------|------------|-----------|
| B01 Sistema Nervoso | Helena | luta no estilo do Portal 1 contra um crânio de 13 m com as veias e os nervos à mostra: uma torreta de foguetes trava o laser em você e atira; saia da frente e deixe o foguete entrar no portal azul (numa parede branca atrás de você) — o laranja já está na parede, apontando para o crânio. Cada acerto derruba um núcleo pela boca, que você leva (`E`) até a fornalha no meio do salão. A câmara é uma sala industrial escura no clima da do Portal 1 (painéis brancos de portal em paredes de metal, pilares com luz de alerta, passarelas, tubulações, treliças, bancos de máquinas piscando, ventiladores, cabos grossos do teto ao crânio; as torretas sobem de alçapões no chão). Com três queimados os nervos recuam, sobra só o feixe arrumado (o "sistema tranquilo") e a porta de trás abre. Resolvido de ponta a ponta pelo robô de teste |

**Série Experimento** — o relógio do tempo do jogo em Flash *Time Experiment* (RodKis, 2014), com portais e clones do passado como no mod *Thinking with Time Machine*. A tecla `2` **para o tempo do mundo** (portas, plataformas, bolas de energia, cubos, torretas, botões com contagem: tudo congela, menos você; os cubos ficam parados onde estão, até no ar). Parado, o **holograma do passado** mostra só o que era diferente (portas e cubos em outro lugar, bolas de energia e o seu eu de antes); a **roda do mouse** escolhe quantos segundos voltar (de meio em meio segundo) e o tiro **laranja** cai nas paredes daquele instante, inclusive atrás de uma porta que já se fechou. O **azul** cai no presente. Entrar no azul leva você ao laranja Δ segundos antes (**loop fechado**: uma só linha do tempo): o mundo volta ao instante de destino e o seu eu que saltou vira um **clone** que repete o que você fez e pisa em botões, até mergulhar no azul "eco" e sumir. O jogo checa **paradoxos**: se o seu passado não puder se repetir (uma bola de energia atinge o clone, uma porta ou um cubo fica no caminho dele, o chão em que ele pisava sumiu, o destino está ocupado, ou o Δ é maior que o tempo desde a sua última chegada), o loop colapsa com um efeito de falha e você volta ao instante do salto, com os portais como estavam. Efeitos: onda de choque, mundo azul-gelo e poeira parada na pausa; holograma ciano com a marca "−N s" no laranja; no salto, flash, aberração, túnel radial e o mundo "rebobinando" ao seu redor; clone com mergulho em anéis de energia.

| Teste | Personagem | O que tem |
|-------|------------|-----------|
| E01 A Ponte | Helena | 52 m de rocha fundida; a ponte só fica de pé com alguém na placa. Só o seu passado, voltado uns 14 s ou mais, segura a placa enquanto você atravessa |
| E02 Dois de Mim | Helena | a porta só abre com alguém no botão do canto e bate na hora que ele solta; o passado fica no botão enquanto você corre para a porta |
| E03 A Ilha | Kelly | carrinho vai e volta sobre a rocha fundida até o botão da ilha; a porta de saída é do outro lado |
| E04 Três em Um | Seu Tião | três botões ao mesmo tempo: dois saltos, um dentro do outro (dois clones e você) |
| E05 Paradoxo | Dona Cida | duas portas em sequência, cada uma com o botão longe, bola de energia varrendo a segunda sala: o passado de um salto precisa de caminho livre para o outro |

Todas foram resolvidas de ponta a ponta pelo robô de teste, que também provou cada tipo de paradoxo (cubo sobre o clone, bola de energia no caminho dele, destino ocupado e salto para antes da chegada).

### Editor de níveis (estilo Portal 2)

No menu, **🛠 Editor de níveis** (ou **＋ Novo nível** em *Meus níveis*). Os níveis ficam no navegador (`localStorage`); **Exportar** baixa um `.nivel.json` e **Importar** o lê de volta. Eles aparecem em *Meus níveis* e rodam como qualquer fase. `F5` testa e volta.

- **① Câmara:** a câmara é feita de **células de 4 m** numa grade. *Abrir células* (A), *Fechar células* (X) e *Pintar faces* (P): branco aceita portal, preto/metal não, vidro. Clique ou arraste; `Shift` pinta a parede inteira. As paredes surgem sozinhas e a luz de teto é automática. O teto some do editor; **Andar −/+** (PgUp/PgDn) escolhe a altura em que você desenha.
- **② Itens:** escolha na paleta e clique: botão, cubo, dispensador, torreta, placa de lançamento e elevador encaixam no centro da célula; lançadores, receptores, lasers, portais fixos e placas de texto, na parede; portas e grades, numa face inteira de célula. `R` gira 90°, arraste move, `Del` apaga, `Ctrl+D` duplica, `Ctrl+Z/Y` desfaz/refaz. **＋ Ligar a…** conecta um botão/receptor a uma porta, plataforma ou funil (as linhas coloridas mostram as ligações). O **cubo** e o **dispensador de cubo** têm a opção *Tipo de cubo* (comum, **redirecionamento de laser** ou especial); `R` gira o cubo refletor para onde o feixe sai. Blocos livres, rampas, painéis diagonais, zonas de gravidade, buracos negros e o resto estão na paleta; as alças ✥ ⟳ ⤢ (avançado) movem, giram e esticam com grade.
- **Ferramentas:** **Régua** (distâncias e alturas), **Trajetória** (arco de cada placa de lançamento e caminho das bolas de energia, e um lançamento livre com ângulo e velocidade: mostra altura, alcance, tempo, velocidade e o que acontece no fim, atravessando portais fixos), **Alcance** (o que o jogador alcança andando, pulando, caindo, pelas placas e pelos portais fixos, e se o elevador de saída entra), **Validar** (botão sem porta, partida dentro da parede, sem superfície de portal…) e **Robô** (ao completar o nível no teste, o seu caminho vira uma *prova* que o editor reproduz como fantasma; ela fica desatualizada se o nível mudar).
- Câmera: botão direito + `WASD` voa (`Q`/`E` descem e sobem, `Shift` acelera, roda ajusta a velocidade), botão do meio arrasta, roda aproxima, `F` foca. `1`/`2` trocam de aba.

A trajetória e o alcance são **estimativas** do centro do corpo com a física do jogo (validadas contra o voo real de uma placa: pouso a ≤ 0,1 m); não incluem funis nem o jogador mudando de direção no ar.

Controles: mouse para olhar, `W A S D`, botão esquerdo (ou `Q`) portal azul, direito portal laranja,
botão do meio tempo lento, `Z` (segurar) zoom — a rodinha ajusta o aumento —, `Espaço` pula, `E` pega/solta (cubo ou torreta) ou desliga torreta por trás, botão esquerdo
segurando um objeto arremessa, `T` viaja no tempo (série Fronteira), `R` reinicia, `Esc` pausa. Precisa de teclado e mouse.
Progresso salvo no navegador; `jogo.html?todas` libera todas as câmaras e testes.

Visual: texturas procedurais com relevo e rugosidade (paredes, pisos e tetos diferentes, chapa
antiderrapante, sujeira e desgaste), desfoque de movimento da câmera, mais forte em alta velocidade (botão “Desfoque” no menu e
na pausa), brilho das luzes, vinheta, poeira no ar e sombras de contato.
Arma de cara sci-fi: placas blindadas, condutos de energia com um pulso a cada tiro, anéis
flutuando em volta da câmara, aletas de calor que abrem depois dos tiros, íris no emissor, painel
holográfico com o estado dos portais, garras que abrem segurando objetos; balança, atrasa ao virar
e afunda ao aterrissar. Torretas com metralhadoras giratórias, cabeça que procura e mira, LEDs de
status, antena piscando, clarão e rastro de bala, faíscas ao cair. Grade de desintegração com malha
hexagonal, varredura, arcos elétricos, bobinas pulsando e uma onda onde algo atravessa. Portas com
indicador; objetos desintegram na grade e na fornalha.

Som do jogo: **gravações reais de domínio público (CC0)**, com a síntese ao vivo só como reserva
(se um arquivo não carregar).
- **Músicas** (`public/music/`, 26 MB): faixas sombrias de ficção científica tocadas em streaming
  com transição suave — "Dark Sci-Fi Audio Pack", "Ambience Pack 1 – Sci Fi Horror",
  "Menacing Otherworld" e "Searching", do OpenGameArt. As câmaras tocam as mais lentas, os desafios
  e as torretas as mais urgentes, a série Momento e a câmara final as mais grandiosas.
- **Efeitos** (`public/sfx/`, 4,5 MB): pacotes de Kenney (Sci-Fi Sounds e Impact Sounds) e do
  OpenGameArt (metal e madeira, 50 efeitos sci-fi, passos em chapa, vento, T-rex) — nada de bipes
  digitais: botões, portas e placas de lançamento usam metal de verdade; confirmações e
  recompensas, sinos reais; ligar e desligar máquinas varre a altura de gravações de motores
  (e tocadas ao contrário na viagem no tempo). Arma de portais, passos (concreto, chapa
  metálica e vidro), torretas, bolas de energia, laser, funil, buraco negro, vento que cresce
  com a velocidade e o rugido do T-rex.
- Créditos e links de cada faixa em `public/music/LEIA-ME.txt` e `public/sfx/LEIA-ME.txt`.
- Não são as trilhas nem os sons originais dos jogos Portal (Valve), que têm direitos autorais.
A visita (documentário) continua com a música sintetizada.

Original: sem nomes, marcas ou arquivos de outros jogos (a campanha original, abaixo, usa os arquivos
da cópia do Portal do próprio jogador; nenhum deles vem com o site).

### Campanha original (com a sua cópia do Portal)

Quem tem o **Portal** (Valve) pode jogar a campanha original inteira dentro deste jogo: as câmaras
00 a 19, as três fases de fuga, a luta final e o encerramento com a música e a letra dos créditos.
Nada da Valve fica neste repositório nem no site publicado (GitHub Pages) — os mapas, as falas, as
legendas e a música vêm **da cópia do próprio jogador** e são lidos só no navegador dele.

**1. Gere o pacote (uma vez, no computador que tem o Portal):**

```bash
npm run pacote                                        # pasta padrão (CrossOver)
npm run pacote -- "/caminho/para/steamapps/common/Portal"
```

Sai um `portal-campanha.zip` (~180 MB) com só o que a campanha usa: os 18 mapas sem iluminação,
visibilidade e texturas embutidas (314 MB → 17 MB), as falas e músicas tocadas por eles, as cenas, os
scripts de som, o roteiro dos créditos e as legendas/textos em português do Brasil e inglês. O
arquivo está no `.gitignore` — **não publique o pacote**: o conteúdo é da Valve. Guarde-o no seu
computador (ou leve para outro aparelho seu).

**2. Jogue:** no site (ou em `npm run dev`), abra uma câmara da seção "Campanha original" e escolha
o `portal-campanha.zip` — ou, num computador com o Portal instalado, a pasta do jogo (a que tem as
pastas `portal` e `hl2`). No Chrome e no Edge a escolha fica lembrada para a próxima visita.

- **No desenvolvimento:** `npm run dev` lê direto a instalação em `PORTAL_DIR` (padrão: a pasta do
  CrossOver), sem perguntar; `jogo.html?campanha=testchmb_a_00` já começa num mapa.

Como funciona:

- **Mapas** (`src/game/campaign/bsp.js`, `convert.js`): cada pincel vira uma caixa (ou sólido
  convexo) com os materiais **daqui** — concreto claro onde o original aceita portal, metal onde não
  aceita, vidro, painéis de luz e rocha fundida no lugar da gosma. Portais se apoiam em vários
  pincéis seguidos e respeitam os volumes "sem portal" do original.
- **Lógica** (`io.js`): o sistema de entradas/saídas das entidades — gatilhos com filtros, relés,
  temporizadores, contadores, portas, botões, elevadores em trilhos, dispensadores de cubos,
  portais fixos da fase, grades, bolas de energia e receptores, torretas, esmaecimentos, câmeras de
  cena, músicas e troca de fase. Peças presas a uma porta ou trilho andam junto com ela. A arma é
  achada e melhorada nas mesmas câmaras do original.
- **Falas** (`dialogue.js`, `scenes.js`): as cenas da GLaDOS tocam os áudios da cópia do jogador,
  com as legendas do próprio jogo em português do Brasil (ou inglês, se não houver).
- **Luta final** (`boss.js`): a sequência é a do mapa original (núcleos que caem, incinerador,
  foguetes desviados pelos portais), com desenho **próprio** para a máquina, os núcleos, a torreta
  de foguetes e as cabines dos elevadores.
- **Créditos** (`credits.js`): a música, a letra digitada, os nomes e a arte em ASCII seguem o
  roteiro `scripts/credits.txt` da cópia do jogador, numa tela de terminal daqui.
- **Pacote** (`scripts/pacote-portal.mjs`, `zip.js`, `source.js`): o .zip é lido por partes
  (`File.slice` + `DecompressionStream`), sem carregar os 180 MB de uma vez.
- O código da campanha é carregado à parte, só quando o jogo abre (~60 KB).

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
  dinos.js     dinossauros procedurais (montagem, animação, trajetos) e fósseis
  mine.js      canteiro de mineração 3D (máquinas, pessoas articuladas, poço, explosão)
  audio.js     trilha sonora procedural e efeitos
  narrator.js  narração por voz (Web Speech API)
  game/        Parte IV: world.js (cenário), physics.js (Rapier), portals.js (portais), player.js (jogador), props.js (cubos), turrets.js, energy.js (bolas de energia), models.js (modelos), textures.js (texturas), fx.js (pós-processamento e efeitos), levels.js (câmaras), classic.js (bateria clássica), hard.js (desafios hardcore), momentum.js (série Momento), fronteira.js (série Fronteira), chefe.js e chefeSala.js (série Chefes: o crânio e a câmara do B01), experimento.js e relogio.js (série Experimento: o relógio do tempo, clones e paradoxos), editor/ (editor de níveis: câmara em células, itens, trajetória, alcance, validação e robô gravado), frontier.js (lasers, funis, placas, gravidade, tempo, Lua), sfx.js, main.js
  space.js     Terra com corte em cunha (shaders), túnel, cápsula, satélite, Lua, estrelas
  ground.js    cena do deserto com o buraco (terreno procedural)
  physics.js   modelos de gravidade e simulação
  charts.js    gráficos 2D do painel
  noise.js     ruído procedural (JS e GLSL)
public/textures  texturas da Terra/Lua (exemplos do three.js, licença MIT)
```

Para depurar no console do navegador: `window.__tunel` expõe `goTo`, `sim`,
`space`, `camera`.
