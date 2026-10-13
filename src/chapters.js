// Roteiro da visita guiada. Cada capítulo diz o que a cena mostra, para onde
// a câmera vai e o texto que aparece no cartão. Os textos usam valores
// calculados pela física (ctx), para os números baterem com a simulação.

import { DOC_CHAPTERS } from './documentary.js';

export const PRESETS = [
  { id: 'nl', name: 'Nova Lima (MG)', lat: -19.99, lon: -43.85, anti: 'Mar das Filipinas, ao sul do Japão' },
  { id: 'sp', name: 'São Paulo', lat: -23.55, lon: -46.63, anti: 'Mar das Filipinas, a sudeste de Okinawa (Japão)' },
  { id: 'ba', name: 'Buenos Aires', lat: -34.6, lon: -58.38, anti: 'Mar Amarelo, pertinho da costa da China' },
  { id: 'pk', name: 'Pequim', lat: 39.9, lon: 116.4, anti: 'Argentina, perto de Bahía Blanca' },
  { id: 'md', name: 'Madri', lat: 40.42, lon: -3.7, anti: 'Ilha Norte da Nova Zelândia' },
  { id: 'ny', name: 'Nova York', lat: 40.71, lon: -74.0, anti: 'Oceano Índico, a sudoeste da Austrália' },
  { id: 'np', name: 'Polo Norte', lat: 89.99, lon: 0, anti: 'Polo Sul (Antártida)' },
];

const V = (x, y, z) => [x, y, z];

const PHYSICS = [
  {
    id: 'intro',
    kicker: 'Prólogo',
    title: 'Um buraco até o outro lado do mundo',
    scene: 'ground',
    body: () => `
      <p>Imagine um buraco <b>reto</b>, atravessando a Terra inteira, de um lado ao outro.</p>
      <p>Agora imagine que você <b>pula</b> nele.</p>
      <p class="big-q">Você cairia para sempre? Pararia no meio? Sairia do outro lado?</p>
      <p class="muted">Nesta visita você vai descobrir a resposta — sem fórmulas, só olhando.</p>`,
    cam: { pos: V(16, 7.5, 13), target: V(0, -3, 0), fov: 50, dur: 0 },
    next: 'Pular no buraco',
  },
  {
    id: 'antipoda',
    kicker: 'Parte I · Capítulo 1',
    title: 'Primeiro: onde fica o "outro lado"?',
    scene: 'space',
    body: (c) => `
      <p>Um túnel reto, passando pelo centro, liga dois pontos <b>exatamente opostos</b> do planeta. Esse ponto oposto se chama <b>antípoda</b>.</p>
      <p>Saindo de <b>${c.originName}</b>, você <u>não</u> chegaria na China: sairia no <b>${c.antiName}</b>.</p>
      <p class="muted">Curiosidade: quem quer sair na China tem que cavar na <b>Argentina</b>. E como ~70% da Terra é oceano, a maioria dos túneis termina... no mar.</p>`,
    cam: { pos: V(-210, 85, 175), target: V(0, 0, 0), fov: 45, dur: 3.2 },
    cut: 0,
    tunnel: 0,
    through: true,
    pins: true,
    labels: ['origin', 'anti'],
  },
  {
    id: 'camadas',
    kicker: 'Parte I · Capítulo 2',
    title: 'O que tem lá dentro',
    scene: 'space',
    body: () => `
      <p>Vamos "fatiar" a Terra para ver por dentro. Ela é feita de camadas, como uma cebola:</p>
      <ul class="layers-list">
        <li><i style="--c:#9c8a74"></i><span><b>Crosta</b> — a casca fina onde vivemos (até 35 km)</span></li>
        <li><i style="--c:#c4622d"></i><span><b>Manto</b> — rocha quente, quase 2.900 km de espessura</span></li>
        <li><i style="--c:#ff9a2e"></i><span><b>Núcleo externo</b> — ferro <b>líquido</b>, ~4.500 °C</span></li>
        <li><i style="--c:#fff0b0"></i><span><b>Núcleo interno</b> — bola de ferro sólido, ~5.400 °C</span></li>
      </ul>
      <p class="muted">O centro <b>não é oco</b>: é a parte mais densa e pesada do planeta.</p>`,
    cam: { pos: V(170, 175, 265), target: V(0, 28, 0), fov: 42, dur: 3.5 },
    cut: 1,
    tunnel: 0,
    labels: ['layers', 'center'],
    layerTour: true,
  },
  {
    id: 'tunel',
    kicker: 'Parte III · Capítulo 3',
    title: 'E se desse para cavar?',
    scene: 'space',
    body: (c) => `
      <p>Agora vamos <b>fazer de conta que os mineiros conseguiram</b>: um túnel de <b>12.742 km</b>, passando bem pelo centro.</p>
      <p>Vamos tirar <b>todo o ar</b> de dentro dele (vácuo). Assim nada te freia: só a gravidade age.</p>
      <p class="muted">⚠️ O túnel e a cápsula estão desenhados <b>gigantes</b> para dar para ver. Na escala real eles seriam mais finos que um fio de cabelo nesta imagem.</p>`,
    cam: { pos: V(35, 125, 255), target: V(0, 5, 0), fov: 42, dur: 3 },
    cut: 1,
    tunnel: 1,
    pins: true,
    labels: ['origin', 'anti', 'scale', 'center'],
    capsule: true,
    sim: { mode: 'reset-pause' },
  },
  {
    id: 'pulo',
    kicker: 'Capítulo 4',
    title: 'O pulo',
    scene: 'space',
    body: (c) => `
      <p>Você entra na cápsula e <b>se solta</b>. No começo é uma queda normal: a cada segundo você fica <b>~35 km/h mais rápido</b> (9,8 m/s²).</p>
      <p>Olhe o painel à direita: a velocidade não para de subir... mas a <span class="hl-g">gravidade</span> vai <b>diminuindo</b> conforme você desce.</p>
      <p class="muted">A simulação está acelerada ${c.speed}× — arraste para girar, role para dar zoom.</p>`,
    camMode: 'follow',
    cam: { pos: V(-75, 40, 85), target: V(-100, 0, 0), fov: 45, dur: 2.5 },
    followOffset: V(25, 30, 85),
    cut: 1,
    tunnel: 1,
    capsule: true,
    gArrow: true,
    vArrow: true,
    hud: true,
    labels: ['capsule', 'center'],
    sim: { mode: 'reset-run', speed: 60 },
  },
  {
    id: 'gravidade',
    kicker: 'Capítulo 5',
    title: 'Por que a gravidade diminui?',
    scene: 'space',
    body: () => `
      <p>Quando você está <b>dentro</b> da Terra, tem planeta em volta de você em todas as direções.</p>
      <p>A parte <span class="hl-gold">dourada</span> (a bola abaixo de você) te puxa para o centro. Já a casca <span class="hl-blue">azulada</span> por cima te puxa para todos os lados ao mesmo tempo — e essas puxadas <b>se cancelam</b>.</p>
      <p>Quanto mais fundo, menor a bola dourada → menos gravidade. <b>No centro, ela é zero.</b></p>`,
    cam: { pos: V(10, 105, 275), target: V(0, 25, 0), fov: 40, dur: 3 },
    cut: 1,
    tunnel: 1,
    capsule: true,
    gArrow: true,
    field: true,
    shell: true,
    hud: true,
    labels: ['capsule', 'shellIn', 'shellOut'],
    sim: { mode: 'run', speed: 30 },
  },
  {
    id: 'centro',
    kicker: 'Capítulo 6',
    title: 'No centro: velocidade máxima',
    scene: 'space',
    body: (c) => `
      <p>No centro da Terra a gravidade é <b>zero</b>... mas você está na <b>maior velocidade</b> da viagem:</p>
      <p class="big-num">${c.vmaxKmh} km/h</p>
      <p>É ~${c.vmaxSound}× a velocidade do som — São Paulo ao Rio em menos de 1 minuto. Sem gravidade te puxando, você simplesmente <b>passa reto</b>, embalado.</p>`,
    camMode: 'follow',
    cam: { pos: V(-18, 18, 42), target: V(-10, 0, 0), fov: 45, dur: 3 },
    followOffset: V(8, 14, 38),
    cut: 1,
    tunnel: 1,
    capsule: true,
    gArrow: true,
    vArrow: true,
    hud: true,
    labels: ['capsule', 'center'],
    sim: { mode: 'jump', at: 0.42, speed: 6 },
  },
  {
    id: 'freando',
    kicker: 'Capítulo 7',
    title: 'Depois do centro: freando sozinho',
    scene: 'space',
    body: (c) => `
      <p>Passou do centro, a gravidade <b>vira de lado</b>: continua puxando para o centro, que agora está <b>atrás</b> de você. Ela vai te freando...</p>
      <p>...e você chega do outro lado com velocidade <b>exatamente zero</b>, bem na boca do túnel, ~<b>${c.tOneWay} minutos</b> depois de pular.</p>
      <p class="big-q">Agarre a borda! Senão você cai de volta — e vai e volta para sempre.</p>`,
    camMode: 'follow',
    cam: { pos: V(115, 35, 70), target: V(85, 0, 0), fov: 45, dur: 3 },
    followOffset: V(-22, 26, 70),
    cut: 1,
    tunnel: 1,
    capsule: true,
    gArrow: true,
    vArrow: true,
    hud: true,
    pins: true,
    labels: ['capsule', 'anti'],
    sim: { mode: 'jump', at: 0.7, speed: 40 },
  },
  {
    id: 'balanco',
    kicker: 'Capítulo 8',
    title: 'É só um balanço gigante',
    scene: 'space',
    body: () => `
      <p>Já andou de <b>balanço</b> ou viu um skatista numa pista em U? Mesma coisa!</p>
      <p>Lá em cima: parado, cheio de <span class="hl-blue">energia de altura</span>. Embaixo (o centro): toda ela virou <span class="hl-orange">energia de movimento</span>. Do outro lado: sobe até a mesma altura e para.</p>
      <p>A soma das duas energias <b>nunca muda</b> — por isso você sempre chega exatamente na borda, nem um centímetro a mais.</p>`,
    cam: { pos: V(0, 120, 290), target: V(0, 0, 0), fov: 40, dur: 3 },
    cut: 1,
    tunnel: 1,
    capsule: true,
    hud: true,
    ramp: true,
    pins: true,
    labels: ['capsule', 'origin', 'anti'],
    sim: { mode: 'reset-run', speed: 120 },
  },
  {
    id: 'satelite',
    kicker: 'Capítulo 9',
    title: 'O segredo: um satélite rasante',
    scene: 'space',
    body: (c) => `
      <p>Um satélite voando em órbita <b>rente ao chão</b> dá uma volta na Terra em <b>~84 minutos</b>.</p>
      <p>Veja a linha pontilhada: a cápsula fica <b>sempre exatamente embaixo</b> do satélite! Os dois saem juntos e chegam juntos ao outro lado, em ~${c.tOneWayUni} minutos.</p>
      <p class="muted">A cápsula é a "sombra" do satélite projetada no túnel. Por isso a velocidade máxima dela (${c.vmaxUniKmh} km/h) é igual à velocidade orbital. (Modelo: Terra uniforme.)</p>`,
    cam: { pos: V(0, 55, 340), target: V(0, 25, 0), fov: 40, dur: 3 },
    cut: 1,
    tunnel: 1,
    capsule: true,
    satellite: true,
    hud: true,
    labels: ['capsule', 'sat'],
    forceModel: 'uniform',
    sim: { mode: 'reset-run', speed: 120 },
  },
  {
    id: 'corda',
    kicker: 'Capítulo 10',
    title: 'Plot twist: qualquer túnel reto leva ~42 min',
    scene: 'space',
    body: (c) => `
      <p>E se o túnel não passar pelo centro? Por exemplo, um túnel reto ligando duas cidades mais próximas (a <b>laranja</b>).</p>
      <p>Ele é mais curto, mas fica mais "deitado": a gravidade empurra menos ao longo dele. Uma coisa compensa a outra e... <b>as duas cápsulas chegam ao mesmo tempo!</b></p>
      <p class="muted">Em teoria, São Paulo → Rio ou São Paulo → Tóquio: ~${c.tOneWayUni} minutos, qualquer que seja a distância. Esse é o famoso "trem gravitacional".</p>`,
    cam: { pos: V(0, 95, 300), target: V(0, 30, 0), fov: 40, dur: 3 },
    cut: 1,
    tunnel: 1,
    capsule: true,
    chord: true,
    hud: true,
    labels: ['capsule', 'chord'],
    forceModel: 'uniform',
    sim: { mode: 'reset-run', speed: 120 },
  },
  {
    id: 'viagem',
    kicker: 'Capítulo 11',
    title: 'Agora, a viagem em primeira pessoa',
    scene: 'space',
    body: () => `
      <p>Você está <b>dentro da cápsula</b>. Repare: durante a viagem inteira você <b>flutua</b>, sem peso — você e a cápsula caem juntos, como os astronautas na Estação Espacial.</p>
      <p>As luzes passam cada vez mais rápido até o anel <span class="hl-red">vermelho</span> (o centro), depois vão desacelerando até a saída.</p>`,
    camMode: 'ride',
    cut: 1,
    tunnel: 1,
    capsule: true,
    hud: true,
    rideHud: true,
    sim: { mode: 'reset-run', speed: 60 },
  },
  {
    id: 'mitos',
    kicker: 'Capítulo 12',
    title: 'Mito × realidade',
    scene: 'space',
    body: (c) => `
      <div class="myths">
        <div><b>"A gravidade é 9,8 m/s² o caminho todo"</b><span>Não: ela diminui até zero no centro. (A imagem original errou nisso.)</span></div>
        <div><b>"O centro da Terra é vazio"</b><span>Não: é uma bola de ferro mais quente que a superfície do Sol.</span></div>
        <div><b>"Você sentiria o peso aumentar/diminuir"</b><span>Não: em queda livre você flutua a viagem inteira.</span></div>
        <div><b>"São exatos ${c.tOneWayUni} minutos"</b><span>Na Terra real (núcleo denso) é ainda mais rápido: ~${c.tOneWayPrem} min, chegando a ${c.vmaxPremKmh} km/h.</span></div>
        <div><b>"Dá para fazer de verdade"</b><span>Não: calor de ~5.400 °C, pressão 3,6 milhões de vezes a do ar, e a rotação da Terra jogaria você contra a parede (só um túnel de polo a polo escaparia disso).</span></div>
        <div><b>"Com ar dentro, daria certo"</b><span>O ar te freia: você chegaria a ~200 km/h, iria e voltaria cada vez menos e terminaria parado... no centro.</span></div>
      </div>`,
    cam: { pos: V(-160, 150, 230), target: V(0, 0, 0), fov: 42, dur: 3.5 },
    cut: 1,
    tunnel: 1,
    capsule: true,
    labels: ['layersMain'],
    sim: { mode: 'run', speed: 120 },
    autoRotate: true,
  },
  {
    id: 'explore',
    kicker: 'Capítulo final',
    title: 'Explore você mesmo',
    scene: 'space',
    body: () => `
      <p><b>Clique em qualquer lugar da Terra</b> para ver onde fica a antípoda — e cave o túnel de lá, se quiser.</p>
      <p>Use os controles para mudar o modelo (Terra uniforme × real), a velocidade e o tipo de câmera.</p>
      <p class="muted">Arraste para girar · role/pinça para zoom · botão direito para mover.</p>
      <p><a class="chip game" href="./jogo.html">🎮 Parte IV: jogue o Laboratório Antípoda →</a></p>`,
    cam: { pos: V(-170, 120, 240), target: V(0, 0, 0), fov: 42, dur: 3 },
    cut: 1,
    tunnel: 1,
    capsule: true,
    hud: true,
    pins: true,
    labels: ['origin', 'anti', 'capsule'],
    explore: true,
    sim: { mode: 'run', speed: 120 },
  },
];

// Parte I (a ideia e o planeta) → Parte II (documentário dos mineiros) → Parte III (a física da queda)
export const CHAPTERS = [...PHYSICS.slice(0, 3), ...DOC_CHAPTERS, ...PHYSICS.slice(3)];
