# Versão nativa (Rust + Bevy 0.20)

Reescrita do jogo de portais (`jogo.html` / `src/game/`) em Rust, com Bevy 0.20 e Rapier
(rapier3d 0.36 direto). Objetivo: tudo funcionando como na versão web, testado.

- `src/lib.rs` — o jogo inteiro como plugin (`GamePlugin`).
- `src/main.rs` — o app com janela.
- `src/bin/teste.rs` — cenários sem janela (renderização para imagem, teclas injetadas,
  quadros avançados à mão), como os testes com puppeteer da versão web.
- `assets/` — músicas, sons, vozes e texturas copiados de `public/`; fases exportadas.
- `tools/export-levels.mjs` — grava o `build(w)` de cada fase da versão web em JSON
  (`assets/levels/levels.json`); o Rust reproduz as mesmas chamadas da API do mundo.

Compilar: `~/.cargo/bin/cargo run` (o PATH desta máquina não tem o cargo).

Testes: `./testar.sh` roda todos. `target/release/teste travessia` (fase 1 jogada de ponta a ponta: portais, vão, saída);
`teste shot --level N --eye x,y,z --yaw a --pitch b --portals "b:c..,n..;o:..." --out f.png` captura
uma vista para comparar com a web (scratchpad `webshot.mjs`, mesmos argumentos).

## Etapas (✅ feito e testado · 🔶 em andamento · ⬜ falta)

### 1. Fundação
- ✅ Plugin do jogo, estados (menu, jogando, pausa, editor), configurações de áudio, idioma
- ✅ Executor de testes sem janela (capturas + estado em JSON)
- ✅ Mundo: caixas com materiais (white/metal/rock/glass/grate/magma...), luzes, faixas de luz, placas
- ✅ Carregar `levels.json` (reproduzir as chamadas) e as fases do editor (formato JSON do editor) (testes `todas`, `editor`)
- ✅ Física (Rapier): colisores das caixas, corpo do jogador com controlador de personagem

### 2. Jogador e câmera
- ✅ Movimento (WASD/setas), pulo, agachar, autostep 0,45 m, snap ao chão, gravidade por zona
- 🔶 Mouse e teclado (setas olham, Q/F, G, Z/X, Enter), zoom, balanço da câmera, tremida
- ✅ Arma em primeira pessoa (Mark III: plasma, condutos, arcos, partículas, holograma), câmera própria por cima

### 3. Portais
- ✅ Mira, colocação (paredes que aceitam portal, deslizar para posição válida), funis de queda
- ✅ Vista pelo portal (câmera para textura + plano de corte oblíquo), recursão
- 🔶 Atravessar (jogador, cubos, bolas, lasers), velocidade preservada, ajuda de arremesso
- 🔶 Moldura, brilho, partículas (✅), sons

### 4. Mecanismos
- ✅ Cubos (pegar/soltar/arremessar), cubo refletor de laser, cubo especial, dispensador (testes `cubo`, `fronteira`, `mecanismos`)
- ✅ Botões de chão, pedestal da arma, botões de apertar (5 modelos, modos por item), portas, plataformas, movers e esmagadores (testes `cubo`, `arma`, `mecanismos`)
- ✅ Grade de desintegração, fornalha, rocha fundida (shader + brasas), perigos (testes `mecanismos`, `extras`, `chefe`)
- ✅ Lançador e receptor de bola de energia (teste `energia`), placa de lançamento, funil (teste `fronteira`)
- ✅ Laser, receptor de laser, cubo refletor, ponte de luz (8 modelos), através de portais (testes `fronteira`, `ponte`)
- ✅ Torretas, saúde, morte e recomeço (teste `torretas`; falta o HUD da vida)
- ✅ Zonas de gravidade, buraco negro, lua/terra/estrelas, túnel (testes `mecanismos`, `extras`)
- ✅ Elevador de saída, gatilhos de falas, dicas por tempo (testes `travessia`, `mecanismos`)
- ✅ Esmagado entre uma peça em movimento e a parede; objetos que somem se desfazem (grade, fornalha, rocha fundida, relógio; teste `extras`)

### 5. Tempo
- 🔶 Tempo lento ✅, campo de dilatação ✅ (lógica, som, HUD; teste `tempo`); ⬜ esfera de vidro e efeitos de tela
- ✅ Viagem no tempo por eras (série Fronteira; teste `epoca`)
- 🔶 Relógio do tempo (série Experimento): ✅ gravação, pausa e Δ, holograma do passado, vermelho
  temporal, salto, clones (que apertam botões), eco, paradoxos e desfazer (inclusive com o tempo
  parado), verificação da linha do tempo na saída, HUD, vista do passado pelo ciano (teste `relogio`);
  bolas pelo par temporal (nos dois sentidos, laços, bolas da história), objetos mandados ao passado
  e duplos, torretas do passado (teste `relogio-bolas`); lasers pelo par temporal, feixe do passado,
  laço e paradoxo do laser (teste `relogio-laser`); pares de portais dos clones (cinza, com vista);
  campo de dilatação na linha do tempo (teste `relogio-campo`); ⬜ vermelhos das versões passadas
  vistos do passado (janelas de fundo preto, bolas que entram nelas)

### 6. Personagens e cenário
- ✅ NPCs nas cabines, dinossauros (andando, pastando, voando, T-rex que ruge e empurra), corpo do jogador nas vistas pelos portais, fósseis, cristais do mapa livre (teste `extras`)
- ✅ Detalhes de fases: portal que troca de lugar (101), guincho do poço (4), túnel até o outro lado do mundo com painel e ajuda da borda (6), temperatura do ar, falas da Lua (teste `extras`)
- ✅ Luta contra chefe (Sistema Nervoso): crânio com veias animadas (shader), salão, torretas de foguete com laser, foguetes pelo portal, núcleos na fornalha, calma e porta (teste `chefe`)

### 7. Interface e som
- ✅ HUD (mira, câmara, tempo, vida, campo, tempo lento, época, avisos, legendas, zoom, dano), menu com séries e cadeados, pausa com opções, fim de câmara, final; progresso salvo (teste `menu`)
- ✅ Legendas e vozes gravadas, falas de introdução e dicas por tempo
- ✅ Músicas (climas e faixas) e efeitos sonoros (Web Audio em Rust: web-audio-api; teste `som`)
- ✅ Poeira no ar e sombras de contato embaixo dos objetos
- ✅ Pós-processamento: bloom, desfoque de movimento, névoa de calor, lente do campo, onda do tiro, aberração, vinheta, grão, tempo lento, gelo, glitch (cenário `efeitos`)
- ✅ Português e inglês: dicionário da versão web (tools/export-i18n.mjs), textos da tela traduzidos sozinhos, botão no menu, salvo no progresso (teste `idioma`)

### 8. Editor de níveis
- ✅ Câmara por células (abrir, fechar, pintar, andares, teto), itens (39 tipos, paleta, encaixe no chão/parede/teto/face, mover, alças de borda, girar, duplicar, copiar/colar), ligações de sinal e modo dos botões de apertar, propriedades (egui), desfazer/refazer, testar (F5) e voltar, salvar no disco, exportar/importar .json, Meus níveis no menu (teste `editor`)
- ✅ Ferramentas: régua, trajetória (placas, bolas, lançamento livre, criar placa), alcance (busca em quadros), validar, robô (prova gravada ao completar o teste, reprodução, velocidade para a trajetória)

### 9. Extras da versão web
- ✅ Mapa livre "A Mina" (cristais; teste `extras`)
- ✅ Multiplayer pelo servidor da versão web (server.js): nativo e web na mesma sala, avatares com nome, portais de cada um na cor da vaga, cubos, torretas, cristais, troca de câmara da sala (teste `multiplayer`)
- ✅ Campanha original (src/campaign): lê o pacote .zip ou a pasta do Portal do próprio jogador
  (zip, VPK, BSP, KeyValues), converte os pincéis, luzes, objetos estáticos (.mdl/.phy), cubos,
  torretas, lançadores e receptores; sistema de I/O das entidades (portas, trens, botões,
  gatilhos, moldes, portas giratórias, foguetes, vidro), falas das cenas com legendas da
  instalação, câmera de cena, esmaecimento. 🔶 modelos animados e texturas da Valve (sala da
  GLaDOS, elevador) usam o desenho próprio; ⬜ tela de créditos (termina direto)

### 10. Distribuição
- ✅ Pacotes: .app (Mac arm64/Intel) e .exe (Windows) pelo GitHub Actions (`nativo.yml`, versão "nativo"); ⬜ Linux
