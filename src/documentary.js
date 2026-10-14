// Parte II — "Os Mineiros": documentário (de ficção) sobre a equipe de Minas
// Gerais que tenta cavar até o outro lado do mundo.
//
// As pessoas são personagens fictícios. As técnicas, equipamentos, rochas e
// números citados são reais (ou ordens de grandeza reais da mineração).
// Os dinossauros do canteiro são figurantes — e a paleontóloga explica isso.

const V = (x, y, z) => [x, y, z];

// Aparência e posição de cada entrevistado na cena da mina (metros).
// `facing` = ângulo (rad) para onde a pessoa olha; `pose` = animação.
export const PEOPLE = {
  helena: {
    name: 'Helena Batista',
    age: 52,
    role: 'Engenheira de minas · coordenadora do Projeto Antípoda',
    city: 'Belo Horizonte',
    years: '27 anos de mineração',
    look: { skin: 0x8d5a3b, shirt: 0xe9e4d8, pants: 0x3b4252, helmet: 0xffffff, hair: 0x1b1410, female: true, vest: true },
    pos: V(58.5, 0, 22.5),
    facing: -2.2,
    pose: 'tablet',
  },
  luciana: {
    name: 'Luciana Prates',
    age: 44,
    role: 'Geóloga',
    city: 'Ouro Preto',
    years: 'formada na Escola de Minas de Ouro Preto',
    look: { skin: 0xd9a77f, shirt: 0x5a7a8c, pants: 0x4a4038, helmet: 0x2e7d32, hair: 0x6b3f1f, female: true, vest: true },
    pos: V(-14.2, -18, -13.8),
    facing: 0.82,
    pose: 'hammer',
  },
  kelly: {
    name: 'Kelly Cristina Andrade',
    age: 33,
    role: 'Operadora de escavadeira',
    city: 'Congonhas',
    years: '9 anos de operação',
    look: { skin: 0x6b4430, shirt: 0x7a6a50, pants: 0x3c3a36, helmet: 0xf2c200, hair: 0x120c08, female: true, vest: true },
    pos: V(-22.2, -12, 19.6),
    facing: 2.25,
    pose: 'handsHips',
  },
  bigode: {
    name: 'Wanderley "Bigode" Costa',
    age: 49,
    role: 'Blaster (encarregado de desmonte com explosivos)',
    city: 'Itabira',
    years: '24 anos de fogo',
    look: { skin: 0xb07a52, shirt: 0x8a8578, pants: 0x4f4a40, helmet: 0xff7a1a, mustache: true, vest: true },
    pos: V(-30.3, -6, 25.4),
    facing: -2.19,
    pose: 'radio',
  },
  tiao: {
    name: 'Sebastião "Seu Tião" Ferreira',
    age: 61,
    role: 'Maquinista do guincho (operador da extração)',
    city: 'Nova Lima',
    years: '38 anos de mina subterrânea',
    look: { skin: 0x7a4e34, shirt: 0x5b6f86, pants: 0x3a3a3a, helmet: 0xffffff, mustache: true, beard: true, grey: true },
    pos: V(10.6, -18, 12.6),
    facing: -0.9,
    pose: 'idle',
  },
  rodrigo: {
    name: 'Rodrigo Nunes',
    age: 38,
    role: 'Sondador (operador da sonda de perfuração)',
    city: 'Paracatu',
    years: '15 anos de sondagem',
    look: { skin: 0xc58c64, shirt: 0x7d6e5a, pants: 0x403a32, helmet: 0xffffff, beard: true, vest: true },
    pos: V(13.2, -18, -11.2),
    facing: -1.9,
    pose: 'gesture',
  },
  marquinho: {
    name: 'Marcos Vinícius "Marquinho" Rocha',
    age: 27,
    role: 'Técnico de segurança do trabalho',
    city: 'Sabará',
    years: '6 anos de mina',
    look: { skin: 0x4a2f22, shirt: 0x2f5d8a, pants: 0x2f3440, helmet: 0x1e88e5, vest: true, backpack: true },
    pos: V(-9.6, -18, -3.2),
    facing: 1.9,
    pose: 'pointing',
  },
  patricia: {
    name: 'Patrícia Moura',
    age: 41,
    role: 'Paleontóloga (e responsável pelos figurantes)',
    city: 'Uberaba',
    years: '15 anos escavando dinossauros no Triângulo Mineiro',
    look: { skin: 0xc8946a, shirt: 0xb59a6a, pants: 0x5a5040, helmet: 0xffffff, hair: 0x3a2414, female: true, vest: true },
    pos: V(-57.4, 0, -28.3),
    facing: 1.113,
    pose: 'hammer',
  },
  cida: {
    name: 'Aparecida "Dona Cida" Lopes',
    age: 66,
    role: 'Cozinheira do canteiro',
    city: 'Raposos',
    years: 'há 31 anos cozinhando pra mineiro',
    look: { skin: 0x9a6444, shirt: 0xc94f4f, pants: 0x2d2d3a, helmet: null, hair: 0xd8d4cc, female: true, apron: true },
    pos: V(66.2, 0, 30.5),
    facing: -2.7,
    pose: 'thermos',
  },
};

// T-rex (figurante) que aparece atrás da paleontóloga: x, y, z, direção
export const INTERVIEW_REX = [-76.7, 0, -52.4, 0.71];

const ficha = (rows) =>
  `<div class="ficha"><span class="ficha-t">Ficha técnica</span>${rows.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('')}</div>`;
const qa = (pairs) => `<div class="qa">${pairs.map(([q, a]) => `<p class="q">${q}</p><p class="a">${a}</p>`).join('')}</div>`;

export const DOC_CHAPTERS = [
  {
    id: 'doc-abertura',
    part: 'doc',
    kicker: 'Parte II · Documentário',
    title: 'Os Mineiros',
    scene: 'mine',
    titleCard: ['PARTE II', 'OS MINEIROS', 'Quadrilátero Ferrífero, Minas Gerais · dia 1.214 da obra'],
    body: () => `
      <p>Antes da física, uma pergunta: <b>quem</b> ia cavar esse buraco? E <b>como</b>?</p>
      <p>Viemos para o <b>Quadrilátero Ferrífero</b>, em Minas Gerais — região onde se cava há mais de 300 anos, primeiro atrás de ouro, depois de ferro. Aqui está o (imaginário) <b>Projeto Antípoda</b>: uma equipe mineira tentando furar a Terra até o outro lado.</p>
      <p>O canteiro tem três frentes: a <b>cava</b> em degraus, o <b>poço vertical</b> com a torre de extração e a <b>sonda</b> que perfura lá do fundo.</p>
      <p class="muted">Documentário de ficção: as pessoas são personagens; as técnicas, máquinas, rochas e números são reais.</p>
      <p class="muted">🦖 Sim, tem dinossauro no canteiro — de capacete, porque EPI é obrigatório. São figurantes; a paleontóloga explica tudo na Entrevista 3.</p>`,
    camFrom: V(260, 140, 330),
    cam: { pos: V(78, 46, 96), target: V(0, -12, 0), fov: 45, dur: 7 },
    autoRotate: true,
    mineLabels: ['headframe', 'rig', 'crane', 'excavator', 'trucks', 'vent', 'winch', 'benches', 'office', 'rex'],
    subs: [
      ['Narrador', 'Minas Gerais. Terra vermelha, cheia de ferro.'],
      ['Narrador', 'Aqui, uma equipe decidiu fazer o impossível:'],
      ['Narrador', 'cavar até o outro lado do mundo.'],
      ['Narrador', 'Faltam 12.741 quilômetros e 990 metros.'],
      ['Narrador', 'E, sim: a equipe tem dinossauros.'],
    ],
  },
  {
    id: 'doc-helena',
    part: 'doc',
    kicker: 'Documentário · Entrevista 1',
    title: '"Cada metro ensina alguma coisa"',
    scene: 'mine',
    interview: 'helena',
    body: () => `
      ${qa([
        ['O que é o Projeto Antípoda?', 'A ideia é simples de falar e impossível de fazer: um furo reto daqui de Minas até o outro lado do planeta. São 12.742 quilômetros. A gente sabe que não vai chegar — mas cada metro que desce ensina alguma coisa sobre a Terra.'],
        ['Por que começar em Minas?', 'Porque aqui se cava há três séculos. Tem gente nesta obra cujo bisavô já trabalhava em mina de ouro em Nova Lima. Esse conhecimento não está em livro nenhum.'],
        ['Qual é o plano?', 'Três etapas, uma dentro da outra: primeiro a <b>cava a céu aberto</b>, para tirar solo e rocha mole; depois o <b>poço vertical</b>, aberto com explosivo e servido por guincho; e, do fundo do poço, a <b>sonda rotativa</b>, que desce até onde a rocha deixar.'],
      ])}
      ${ficha([
        ['Equipe', '~380 pessoas em 3 turnos, 24 h por dia'],
        ['Frentes', 'cava a céu aberto · poço vertical · sondagem profunda'],
        ['Meta "oficial"', '12.742 km (o diâmetro da Terra)'],
        ['Meta realista', 'alguns quilômetros (ver o fim da Parte II)'],
      ])}`,
    subs: [
      ['Helena', 'A ideia é simples de falar e impossível de fazer.'],
      ['Helena', 'Um furo reto daqui de Minas até o outro lado do planeta.'],
      ['Helena', 'A gente sabe que não vai chegar lá...'],
      ['Helena', '...mas cada metro que desce ensina alguma coisa.'],
    ],
  },
  {
    id: 'doc-luciana',
    part: 'doc',
    kicker: 'Documentário · Entrevista 2',
    title: 'O que tem debaixo de Minas',
    scene: 'mine',
    interview: 'luciana',
    body: () => `
      ${qa([
        ['Por que a terra aqui é tão vermelha?', 'É ferrugem, literalmente. O solo daqui tem muito ferro, e o ferro oxidado fica vermelho. Embaixo dele vem a <b>canga</b> e a <b>laterita</b>, uma crosta dura que a chuva vai cozinhando ao longo de milhões de anos.'],
        ['E essas listras na parede da cava?', 'Isso é o <b>itabirito</b>: camadas de ferro e de quartzo que se depositaram no fundo de um mar há uns <b>2,4 bilhões de anos</b>. É uma página do diário da Terra, de quando a atmosfera começou a ter oxigênio.'],
        ['E mais fundo?', 'Xistos, quartzitos e, no fim, o <b>embasamento</b>: granitos e gnaisses com mais de 2,7 bilhões de anos. A cada quilômetro a rocha fica uns 20 °C mais quente. O engraçado é que toda essa história cabe nos primeiros quilômetros — e a Terra tem 6.371 de raio.'],
      ])}
      <div class="rock-column">
        <span class="ficha-t">Coluna de rochas do poço (simplificada)</span>
        <div style="--c:#9b3b1d"><b>0–30 m</b> solo laterítico e canga</div>
        <div style="--c:#c98a5a"><b>30–120 m</b> saprolito (rocha "podre", desfazendo)</div>
        <div style="--c:#5d5a60"><b>120–600 m</b> itabirito (ferro bandado)</div>
        <div style="--c:#6f7d6a"><b>600–1.500 m</b> xisto e filito</div>
        <div style="--c:#d8cdb4"><b>1.500–2.500 m</b> quartzito</div>
        <div style="--c:#8d8a8e"><b>2.500 m +</b> granito-gnaisse do embasamento</div>
      </div>`,
    subs: [
      ['Luciana', 'Essa terra é vermelha por causa de ferrugem, literalmente.'],
      ['Luciana', 'Essas listras são itabirito: ferro e quartzo, camada por camada.'],
      ['Luciana', 'Elas se formaram no fundo de um mar, há 2,4 bilhões de anos.'],
      ['Luciana', 'E a cada quilômetro, a rocha fica uns 20 graus mais quente.'],
    ],
  },
  {
    id: 'doc-patricia',
    part: 'doc',
    kicker: 'Documentário · Entrevista 3',
    title: 'E os dinossauros?',
    scene: 'mine',
    interview: 'patricia',
    rexRoar: true,
    body: () => `
      ${qa([
        ['Tem fóssil de dinossauro nessa cava?', 'Nenhum. O itabirito daqui tem uns <b>2,4 bilhões de anos</b>. Os dinossauros apareceram há uns <b>230 milhões</b> e sumiram há <b>66 milhões</b>. Essa rocha é umas <b>dez vezes mais velha</b> que o primeiro dinossauro — quando ela se formou, a vida na Terra era só micróbio.'],
        ['Então Minas não tem dinossauro?', 'Tem, e muito! No <b>Triângulo Mineiro</b>, em <b>Peirópolis</b> (Uberaba), as rochas do <b>Grupo Bauru</b> têm uns 70 milhões de anos e guardam <b>titanossauros</b> — aqueles pescoçudos gigantes —, como o <i>Uberabatitan</i>. Em Prata (MG) acharam o <i>Maxakalisaurus</i>.'],
        ['E esses dinossauros aqui no canteiro?', 'São figurantes do documentário! E repara nos erros: o <b>T-rex</b> viveu na <b>América do Norte</b>, não no Brasil. E o <b>estegossauro</b> sumiu uns 80 milhões de anos antes de o T-rex nascer: tem mais tempo entre os dois do que entre o T-rex e a gente.'],
        ['E dinossauro ainda existe?', 'Existe: <b>as aves são dinossauros</b>. Quando o Bigode grita "fogo" e o passarinho voa, quem está fugindo é um dinossauro.'],
      ])}
      ${ficha([
        ['Era dos dinossauros', '~230 a 66 milhões de anos atrás (Triássico, Jurássico e Cretáceo)'],
        ['Itabirito do Quadrilátero', '~2,4 bilhões de anos: sem fósseis de animais'],
        ['Dinossauros de Minas', 'Peirópolis (Uberaba) e Prata, no Triângulo Mineiro'],
        ['Fim da era', 'asteroide de ~10 km em Chicxulub (México), há 66 milhões de anos'],
        ['Onde ficam os fósseis', 'só na crosta, em rochas sedimentares — nunca no manto'],
      ])}`,
    subs: [
      ['Patrícia', 'Fóssil de dinossauro nessa cava? Nenhum.'],
      ['Patrícia', 'Essa rocha é dez vezes mais velha que o primeiro dinossauro.'],
      ['Patrícia', 'Mas no Triângulo Mineiro tem titanossauro, aqueles pescoçudos gigantes.'],
      ['Rex', 'RRRROOOOAAAARRR!'],
      ['Patrícia', 'Esse aí é figurante. E nem é daqui: o T-rex viveu na América do Norte.'],
      ['Patrícia', 'E passarinho é dinossauro. Quando o Bigode grita fogo, quem foge é dinossauro.'],
    ],
  },
  {
    id: 'doc-kelly',
    part: 'doc',
    kicker: 'Documentário · Entrevista 4',
    title: 'A cava: degrau por degrau',
    scene: 'mine',
    interview: 'kelly',
    body: () => `
      ${qa([
        ['Por que a cava tem esses degraus?', 'São as <b>bancadas</b>. Se a gente cavasse um barranco reto, ele desmoronava. Com degraus, cada parede é baixa e firme, e o patamar (a <b>berma</b>) segura o que cair. É por isso que mina a céu aberto parece um estádio de cabeça pra baixo.'],
        ['Como é o seu dia?', 'Turno de oito horas. A escavadeira pega uns 4 metros cúbicos de rocha por vez; com três ou quatro passadas eu encho um caminhão de 30 toneladas. Ele sobe a rampa, despeja na pilha e volta. Dá umas 200 viagens por turno, somando a frota.'],
        ['E o pessoal?', 'Meu pai falava que mulher não operava máquina pesada. Hoje ele manda foto da minha escavadeira no grupo da família.'],
      ])}
      ${ficha([
        ['Técnica', 'lavra a céu aberto em bancadas'],
        ['Bancadas', '6 m de altura, bermas de 8 m, faces a ~70°'],
        ['Escavadeira', 'hidráulica de ~70 t, caçamba de ~4 m³'],
        ['Caminhões', 'fora de estrada, ~30 t por viagem'],
        ['Limite prático', 'cavas chegam a algumas centenas de metros; depois só por poço'],
      ])}`,
    subs: [
      ['Kelly', 'Se cavasse um barranco reto, ele desmoronava.'],
      ['Kelly', 'Com degraus, cada parede é baixa e firme.'],
      ['Kelly', 'Três, quatro passadas e o caminhão de 30 toneladas tá cheio.'],
      ['Kelly', 'Hoje meu pai manda foto da minha escavadeira no grupo da família.'],
    ],
  },
  {
    id: 'doc-bigode',
    part: 'doc',
    kicker: 'Documentário · Entrevista 5',
    title: 'Fogo!',
    scene: 'mine',
    interview: 'bigode',
    blast: true,
    body: () => `
      ${qa([
        ['Explosivo não é perigoso demais?', 'Explosivo não é bagunça, é matemática. A gente fura a rocha num desenho certinho — o <b>plano de fogo</b> —, enche cada furo com <b>emulsão</b> bombeada, tampa com brita e liga tudo com <b>retardos eletrônicos</b>. Cada furo explode uns milissegundos depois do outro, e a rocha cai quebradinha, no lugar certo.'],
        ['E no poço?', 'No poço é o mesmo ciclo, só que apertado: <b>furar, carregar, detonar, ventilar, tirar o entulho, escorar</b>. Avança uns 3 metros por ciclo. Num dia bom, dois ciclos.'],
        ['Qual a regra mais importante?', 'Ninguém dentro do raio. Sirene, contagem, rádio. Quando eu grito "fogo", até passarinho sabe.'],
      ])}
      <button class="chip" id="btn-blast">💥 Detonar de novo</button>
      ${ficha([
        ['Técnica', 'perfuração e desmonte (drill and blast)'],
        ['Furos na cava', '~89 mm de diâmetro, ~7 m de profundidade, malha 2,5 × 3 m'],
        ['Explosivo', 'emulsão bombeada + tampão de brita'],
        ['Iniciação', 'retardos eletrônicos (milissegundos entre furos)'],
        ['Segurança', 'sirene, raio de evacuação de ~500 m, vistoria pós-fogo'],
      ])}`,
    subs: [
      ['Bigode', 'Explosivo não é bagunça. É matemática.'],
      ['Bigode', 'Cada furo explode uns milissegundos depois do outro.'],
      ['Rádio', 'Atenção, frente norte: área evacuada. Fogo em 3... 2... 1...'],
      ['Bigode', 'FOGO!'],
      ['Bigode', 'Viu? A rocha caiu quebradinha, no lugar certo.'],
    ],
  },
  {
    id: 'doc-tiao',
    part: 'doc',
    kicker: 'Documentário · Entrevista 6',
    title: 'O poço e o guincho',
    scene: 'mine',
    interview: 'tiao',
    body: () => `
      ${qa([
        ['O que o senhor faz aqui?', 'Eu sou o maquinista do guincho. Tudo que desce e sobe no poço passa pela minha mão: gente, ferramenta, rocha. Lá em cima da torre tem as <b>polias</b>; o cabo passa por elas e vem enrolar no <b>tambor</b>, aqui na casa do guincho.'],
        ['Há quanto tempo o senhor trabalha em mina?', 'Trinta e oito anos. Comecei moleque em mina de ouro subterrânea, aqui em Nova Lima — mina velha, funda, de descer mais de dois quilômetros. Meu pai trabalhou lá, meu avô também.'],
        ['Qual o segredo do ofício?', 'O cabo é a vida da gente. Toda manhã eu olho ele metro por metro. E campainha é lei: cada toque é uma ordem, e ninguém mexe na gaiola sem o sinal.'],
      ])}
      ${ficha([
        ['Técnica', 'abertura de poço vertical (shaft sinking)'],
        ['Torre de extração', 'estrutura de aço com polias no topo (headframe)'],
        ['Guincho', 'tambor elétrico, cabo de aço de ~50 mm'],
        ['Skip / gaiola', '~10 t de rocha por viagem; gaiola leva a equipe'],
        ['Velocidade', 'até ~12 m/s (≈ 43 km/h) no poço'],
        ['Parede', 'tirantes de aço + tela + concreto projetado'],
      ])}`,
    subs: [
      ['Seu Tião', 'Tudo que desce e sobe no poço passa pela minha mão.'],
      ['Seu Tião', 'Comecei moleque, em mina de ouro aqui de Nova Lima.'],
      ['Seu Tião', 'O cabo é a vida da gente. Toda manhã eu olho ele metro por metro.'],
      ['Seu Tião', 'E campainha é lei, sô.'],
    ],
  },
  {
    id: 'doc-rodrigo',
    part: 'doc',
    kicker: 'Documentário · Entrevista 7',
    title: 'A sonda: mais fundo que qualquer poço',
    scene: 'mine',
    interview: 'rodrigo',
    body: () => `
      ${qa([
        ['Como uma sonda fura tão fundo?', 'Ela gira uma coluna de tubos com uma <b>broca</b> na ponta — de <b>diamante</b> ou de <b>PDC</b>, que é diamante sintético. Pelo meio do tubo a gente bombeia <b>lama de perfuração</b>: ela esfria a broca, traz o pó de rocha pra cima e segura a parede do furo.'],
        ['Qual é o furo mais fundo do mundo?', 'O de <b>Kola</b>, na Rússia. Os soviéticos levaram quase 20 anos e chegaram a <b>12.262 metros</b>, em 1989. Lá embaixo a rocha estava a uns <b>180 °C</b> e começou a se comportar feito massa de pão de queijo: fecha o furo. Pararam ali.'],
        ['E a largura desse furo?', 'Uns 23 centímetros. Do tamanho de um prato. Ninguém passa por ali — só a broca e os sensores.'],
      ])}
      ${ficha([
        ['Técnica', 'sondagem rotativa profunda'],
        ['Broca', 'coroa diamantada ou PDC; troca a cada algumas centenas de metros'],
        ['Fluido', 'lama de bentonita (resfria, limpa e estabiliza o furo)'],
        ['Parede', 'revestimento de aço cimentado em etapas'],
        ['Recorde', 'Kola SG-3: 12.262 m, ~23 cm de diâmetro, ~180 °C no fundo'],
      ])}`,
    subs: [
      ['Rodrigo', 'A broca gira lá embaixo, e a lama traz o pó de rocha pra cima.'],
      ['Rodrigo', 'O furo mais fundo do mundo foi na Rússia: 12 quilômetros.'],
      ['Rodrigo', 'Lá embaixo a rocha vira massa de pão de queijo e fecha o furo.'],
      ['Rodrigo', 'E o furo tinha a largura de um prato.'],
    ],
  },
  {
    id: 'doc-marquinho',
    part: 'doc',
    kicker: 'Documentário · Entrevista 8',
    title: 'Calor, ar e segurança',
    scene: 'mine',
    interview: 'marquinho',
    body: () => `
      ${qa([
        ['Qual é o maior inimigo lá embaixo?', 'O calor. A rocha esquenta conforme desce, e o ar comprimido pelo peso de cima também. Nas minas mais fundas do mundo, na África do Sul, a quase 4 km, a rocha passa dos 60 °C — eles mandam <b>gelo</b> lá pra baixo pra dar pra trabalhar.'],
        ['E o ar?', 'Esse tubo amarelo é a <b>ventilação</b>. Ele empurra ar fresco até a frente de trabalho e tira poeira e gás do explosivo. Pó de rocha tem sílica, que causa silicose — então máscara não é opcional.'],
        ['E se der problema?', 'Cada um desce com o <b>autorresgatador</b> no cinto: um aparelho que dá oxigênio por uns 30 a 60 minutos. E tem <b>câmara de refúgio</b> no caminho. Aqui ninguém é herói. Herói é quem volta pra casa.'],
      ])}
      ${ficha([
        ['Ventilação', 'ventiladores principais + dutos flexíveis até a frente'],
        ['Refrigeração', 'água gelada e "pasta de gelo" nas minas mais fundas'],
        ['Riscos', 'calor, poeira de sílica, gases do fogo, explosão de rocha (rock burst)'],
        ['EPI', 'capacete com lanterna, máscara PFF2, protetor auricular, autorresgatador'],
        ['Mina mais funda', 'Mponeng (África do Sul): ~4 km'],
      ])}`,
    subs: [
      ['Marquinho', 'O maior inimigo lá embaixo é o calor.'],
      ['Marquinho', 'Na África do Sul, a quase 4 km, mandam gelo pra baixo.'],
      ['Marquinho', 'Esse tubo amarelo leva ar fresco até a frente de trabalho.'],
      ['Marquinho', 'Aqui ninguém é herói. Herói é quem volta pra casa.'],
    ],
  },
  {
    id: 'doc-descida',
    part: 'doc',
    kicker: 'Documentário · Descida',
    title: 'Descendo o poço',
    scene: 'mine',
    descent: true,
    titleCard: ['DESCIDA', 'Poço principal', '06h12 · turno A'],
    body: () => `
      <p>Entramos na <b>gaiola</b> com a equipe do turno. Agora o tempo está acelerado: veja à direita a profundidade, a rocha que passa pela parede, a temperatura e a pressão.</p>
      <p>Repare nas referências: a descida passa a altura da Torre Eiffel, do maior prédio do mundo, do Pico da Bandeira... e para onde termina a <b>mina mais funda do mundo</b>.</p>
      <p class="muted">Ainda assim, quando a gaiola parar, você terá percorrido só uma fração minúscula do caminho até o outro lado.</p>`,
    subs: [
      ['Rádio', 'Gaiola com seis, descendo. Três toques.'],
      ['Marquinho', 'Sente a orelha estalando? É a pressão do ar aumentando.'],
      ['Seu Tião (rádio)', 'Velocidade de cruzeiro. Doze metros por segundo.'],
      ['Rodrigo', 'Daqui pra baixo é itabirito. Olha as listras.'],
      ['Marquinho', 'Lá no fundo a rocha tá quente. Encosta não.'],
      ['Marquinho', 'Isso vale pra você também, Pipoca.'],
    ],
  },
  {
    id: 'doc-cida',
    part: 'doc',
    kicker: 'Documentário · Entrevista 9',
    title: 'Pausa pro café',
    scene: 'mine',
    interview: 'cida',
    body: () => `
      ${qa([
        ['O que sai da cozinha por dia?', 'Uns seiscentos pães de queijo por turno, café coado de hora em hora e, quinta-feira, feijão tropeiro. Mineiro não cava de barriga vazia.'],
        ['A senhora acredita que eles chegam do outro lado?', 'Eles acham que estão cavando pro Japão. Eu falo: lá do outro lado é mar, meu filho — vai chegar molhado.'],
        ['E se chegarem?', 'Aí eu mando a marmita pelo buraco. Diz que leva uns quarenta minutos pra cair lá. Chega quentinha.'],
      ])}
      <p class="muted">Dona Cida está certa duas vezes: a antípoda de Minas Gerais fica no <b>Mar das Filipinas</b>, ao sul do Japão — e, num túnel ideal, a marmita levaria mesmo uns 42 minutos (é o assunto da Parte III).</p>`,
    subs: [
      ['Dona Cida', 'Seiscentos pães de queijo por turno. Mineiro não cava de barriga vazia.'],
      ['Dona Cida', 'Eles acham que estão cavando pro Japão.'],
      ['Dona Cida', 'Lá do outro lado é mar, meu filho. Vai chegar molhado.'],
      ['Dona Cida', 'Se chegarem, eu mando a marmita pelo buraco. Chega quentinha.'],
    ],
  },
  {
    id: 'doc-limite',
    part: 'doc',
    kicker: 'Documentário · Epílogo',
    title: 'Até onde dá para cavar',
    scene: 'space',
    near: 0.002,
    depthMarkers: true,
    cut: 1,
    tunnel: 0,
    labels: ['mk_mponeng', 'mk_kola', 'mk_crosta', 'mk_minas'],
    camFrom: V(-99.2, 0.12, 0.55),
    camFromTarget: V(-99.62, 0.0, 0),
    cam: { pos: V(-170, 120, 240), target: V(0, 0, 0), fov: 42, dur: 14 },
    body: () => `
      <p>A câmera começa com um <b>zoom gigantesco</b> na borda da Terra e vai se afastando. Os riscos vermelhos são, em escala real:</p>
      <ul class="layers-list">
        <li><i style="--c:#ffb74d"></i><span><b>~4 km</b> — a mina mais funda do mundo (Mponeng)</span></li>
        <li><i style="--c:#ff5a4a"></i><span><b>12,3 km</b> — o furo mais fundo já feito (Kola)</span></li>
        <li><i style="--c:#b0bec5"></i><span><b>~35 km</b> — o fim da crosta continental</span></li>
      </ul>
      <p>Se a Terra fosse uma maçã, o furo mais fundo da história <b>não atravessaria nem a casca</b>.</p>
      <p class="muted">"A gente não vai chegar ao outro lado", diz Helena. "Mas agora dá pra imaginar o que aconteceria se chegasse." É a Parte III.</p>`,
    subs: [
      ['Helena', 'Se a Terra fosse uma maçã...'],
      ['Helena', '...o furo mais fundo da história não atravessaria nem a casca.'],
      ['Helena', 'A gente não vai chegar ao outro lado.'],
      ['Helena', 'Mas agora dá pra imaginar o que aconteceria se chegasse.'],
    ],
  },
];

// Referências que aparecem durante a descida do poço (profundidade em metros)
export const DESCENT_MILESTONES = [
  { d: 30, text: 'Fim do solo vermelho: começa a rocha' },
  { d: 150, text: 'Itabirito: 10× mais velho que os dinossauros — nenhum fóssil aqui' },
  { d: 330, text: 'Já desceu a altura da Torre Eiffel (330 m)' },
  { d: 828, text: 'Já desceu a altura do Burj Khalifa (828 m)' },
  { d: 2892, text: 'Já desceu a altura do Pico da Bandeira (2.892 m)' },
  { d: 3900, text: 'Fim da linha: aqui termina a mina mais funda do mundo' },
];

export const DESCENT_ROCKS = [
  { to: 30, name: 'Solo laterítico e canga' },
  { to: 120, name: 'Saprolito' },
  { to: 600, name: 'Itabirito (ferro bandado)' },
  { to: 1500, name: 'Xisto e filito' },
  { to: 2500, name: 'Quartzito' },
  { to: 1e9, name: 'Granito-gnaisse do embasamento' },
];
