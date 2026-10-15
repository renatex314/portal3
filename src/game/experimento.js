// Série Experimento — o relógio do tempo do jogo em Flash "Time Experiment"
// (RodKis, 2014), com portais. Tecla 2 PARA o tempo do mundo (você anda); na
// pausa, a roda do mouse escolhe quantos segundos voltar e o tiro LARANJA cai
// nas paredes daquele instante; o AZUL cai no presente. Entrar no azul leva
// você ao laranja no passado: o seu eu que saltou vira um clone que repete o
// que você fez (pisa em botões) e o jogo avisa de PARADOXOS quando o passado
// não pode se repetir. Ver `relogio.js`.
//
// Coordenadas em metros; o chão é y = 0; a saída fica em −z.

import { northWallWithExit } from './levels.js';
import { lava } from './hard.js';

const E = (n, def) => ({ ...def, id: 600 + n, n, code: `E${String(n + 1).padStart(2, '0')}`, series: 'experiment', music: def.music ?? 'labTense', relogio: true, heat: false });

function sign(w, x, y, z, rotY, code, name, line2) {
  w.sign(x, y, z, rotY, [
    [`EXPERIMENTO ${code}`, 84, 150],
    [name, 66, 270, '#00838f'],
    [line2, 38, 380, '#55575c', 'Arial, sans-serif'],
    ['SÉRIE EXPERIMENTO · LABORATÓRIO ANTÍPODA', 28, 455, '#8a8c90', 'Arial, sans-serif'],
  ]);
}

/** sala retangular de metal (só os painéis `white` aceitam portal) */
function hall(w, x0, x1, z0, z1, h, m = {}) {
  w.box(x0, -1, z0, x1, 0, z1, m.floor ?? 'metal');
  w.box(x0 - 1, h, z0 - 1, x1 + 1, h + 1, z1 + 1, 'metal');
  if (m.w !== false) w.box(x0 - 1, -1, z0 - 1, x0, h, z1 + 1, 'metal');
  if (m.e !== false) w.box(x1, -1, z0 - 1, x1 + 1, h, z1 + 1, 'metal');
  if (m.n !== false) w.box(x0, -1, z0 - 1, x1, h, z0, 'metal');
  if (m.s !== false) w.box(x0, -1, z1, x1, h, z1 + 1, 'metal');
}
/** painel de concreto claro encostado numa parede (aceita portal) */
const panel = (w, x0, y0, z0, x1, y1, z1) => w.box(x0, y0, z0, x1, y1, z1, 'white');
const lights = (w, pts, y, k = 45) => pts.forEach(([x, z]) => w.light(x, y, z, k));

export const EXPERIMENTO = [
  // ------------------------------------------------------------------ E01
  E(0, {
    name: 'Tempo Parado',
    who: 'Helena',
    lesson: 'A ponte só fica de pé por 7 s depois que você sai da placa. A travessia leva o dobro: pare o tempo (2) no meio dela.',
    build(w) {
      // corredor sobre a rocha fundida: plataforma de partida, 44 m de ponte e a saída
      w.box(-8, -1, -2, 8, 0, 10, 'white');
      w.box(-8, -1, -64, 8, 0, -54, 'white');
      lava(w, -8, 8, -54, -2, -4);
      w.box(-9, -1, -65, -8, 7, 11, 'metal');
      w.box(8, -1, -65, 9, 7, 11, 'metal');
      w.box(-9, 7, -65, 9, 8, 11, 'metal');
      w.box(-8, -1, 10, 8, 7, 11, 'metal');
      w.box(-8, -1, -65, 8, 7, -64, 'metal');
      // a ponte sobe da rocha quando a placa está (ou esteve há pouco) ligada
      w.door('bridge', -1.7, -4.4, -54, 1.7, -4.0, -2, { axis: 'y', dist: 4.0, speed: 1.8 });
      w.button(0, 0, 6, 'bridge', { hold: 7 });
      w.strip(-1.2, 0.005, 5.2, 1.2, 0.03, 5.3, 0x8fe3ff, 2);
      w.exitElevator(0, 0, -60);
      sign(w, -7.97, 3.2, 4, Math.PI / 2, 'E01', 'TEMPO PARADO', 'tecla 2 · pausa o tempo do mundo');
      lights(w, [[0, 6], [0, -20], [0, -40], [0, -58]], 6.2, 60);
      return {
        spawn: [0, 0, 8, 0],
        gun: 'none',
        relogio: true,
        intro: [
          ['Helena', 'Esse é o relógio de pulso do experimento. A tecla 2 para o tempo do mundo: tudo congela, menos você.'],
          ['Helena', 'A ponte só fica de pé por sete segundos depois que você sai da placa, e são quarenta e quatro metros. Pise na placa, corra e pare o tempo no meio da ponte.'],
        ],
        hints: [{ after: 45, lines: [['Helena', 'Saia da placa, corra pela ponte e aperte 2 antes de ela cair. Com o mundo parado, a ponte não cai: termine a travessia e só então aperte 2 de novo.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ E02
  E(1, {
    name: 'Dois de Mim',
    who: 'Helena',
    lesson: 'A porta só fica aberta com alguém no botão — e o botão é longe dela. Salte para o passado: o seu passado fica no botão.',
    build(w) {
      hall(w, -12, 12, -16, 8, 6, { n: false });
      northWallWithExit(w, -12, 12, 6, -16, 'd1');
      w.button(-9, 0, -10, 'd1');
      w.strip(-9.8, 0.005, -10.9, -8.2, 0.03, -10.8, 0xffb347, 2);
      // só estes painéis aceitam portal: um do lado do botão, outro do lado da porta
      panel(w, -12, 0, -14, -11.9, 5, -4); // parede oeste
      panel(w, -8, 0, -16, -3, 5, -15.9); // parede norte, à esquerda da porta
      sign(w, 11.97, 3.2, 0, -Math.PI / 2, 'E02', 'DOIS DE MIM', 'pausa · passado · azul no presente');
      lights(w, [[0, 2], [-6, -10], [6, -10]], 5.6, 45);
      return {
        spawn: [4, 0, 5, 0],
        gun: 'both',
        relogio: true,
        intro: [
          ['Helena', 'A porta de saída só abre enquanto alguém está pisando no botão do canto — e dá tempo de sobra para ela fechar até você chegar.'],
          ['Helena', 'Pise no botão, pare o tempo (2) e escolha na roda do mouse quantos segundos voltar. O laranja cai no passado, perto da porta; o azul, no presente, perto do botão.'],
          ['Helena', 'Entre no azul: você sai no passado, e o seu eu de antes continua no botão enquanto você corre para a porta.'],
        ],
        hints: [
          { after: 90, lines: [['Helena', 'Painel da esquerda da porta: laranja (no passado). Painel da parede oeste, do lado do botão: azul. O holograma mostra você no botão: escolha um tempo em que você já estava nele.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ E03
  E(2, {
    name: 'A Ilha',
    who: 'Kelly',
    lesson: 'Um carrinho leva você até o botão da ilha; a porta de saída fica do outro lado da rocha fundida. Deixe o seu passado no botão.',
    build(w) {
      // plataforma de partida (norte), ilha do botão (sul) e rocha fundida no meio
      w.box(-14, -1, -20, 14, 0, -6, 'metal');
      w.box(-14, -1, 16, 14, 0, 24, 'metal');
      lava(w, -14, 14, -6, 16, -4);
      w.box(-15, -1, -21, -14, 7, 25, 'metal');
      w.box(14, -1, -21, 15, 7, 25, 'metal');
      w.box(-15, 7, -21, 15, 8, 25, 'metal');
      w.box(-14, -1, 24, 14, 7, 25, 'metal');
      northWallWithExit(w, -14, 14, 7, -20, 'd1');
      // o carrinho vai e volta entre a partida e a ilha
      w.mover('sh', -2, -0.4, -6, 2, 0, -2, { to: [0, 0, 18], speed: 3.5, waits: [3, 3] });
      w.button(0, 0, 20, 'd1');
      w.strip(-0.8, 0.005, 19.1, 0.8, 0.03, 19.2, 0xffb347, 2);
      panel(w, -10, 0, -20, -4, 5, -19.9); // norte, à esquerda da porta (o laranja cai aqui, no passado)
      panel(w, -6, 0, 23.9, 6, 5, 24); // sul, na ilha (o azul cai aqui, no presente)
      sign(w, -13.97, 3.2, -12, Math.PI / 2, 'E03', 'A ILHA', 'carrinho · botão · passado');
      lights(w, [[0, -12], [0, 4], [0, 20], [-8, -12], [8, -12]], 6.2, 55);
      return {
        spawn: [8, 0, -10, Math.PI],
        gun: 'both',
        relogio: true,
        intro: [
          ['Kelly', 'A porta de saída está aqui no norte, mas o botão que a abre fica na ilha, lá do outro lado da rocha fundida. O carrinho vai e volta.'],
          ['Kelly', 'Vá até o botão. A porta só abre enquanto alguém pisa nele: pare o tempo, ponha o laranja no passado, perto da porta, e o azul perto do botão. O seu passado fica no botão.'],
        ],
        hints: [{ after: 120, lines: [['Kelly', 'Fique uns segundos no botão antes de saltar: assim, mesmo voltando alguns segundos, o seu passado já está nele quando você chegar.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ E04
  E(3, {
    name: 'Três em Um',
    who: 'Seu Tião',
    lesson: 'A porta só abre com os três botões pisados ao mesmo tempo: dois clones e você. Dois saltos, um dentro do outro.',
    build(w) {
      hall(w, -14, 14, -20, 10, 6, { n: false });
      northWallWithExit(w, -14, 14, 6, -20, 'd1');
      // três botões: um com cada "eu"
      w.button(-10, 0, -2, 'd1'); // B1 (oeste)
      w.button(0, 0, 6, 'd1'); // B2 (sul)
      w.button(5, 0, -17, 'd1'); // B3 (perto da porta)
      for (const [x, z] of [[-10, -2], [0, 6], [5, -17]]) w.strip(x - 0.8, 0.005, z - 0.9, x + 0.8, 0.03, z - 0.8, 0xffb347, 2);
      panel(w, -14, 0, -6, -13.9, 5, 2); // oeste, do lado de B1
      panel(w, -4, 0, 9.9, 4, 5, 10); // sul, do lado de B2
      panel(w, 3, 0, -20, 9, 5, -19.9); // norte, à direita da porta, do lado de B3
      sign(w, 13.97, 3.2, 0, -Math.PI / 2, 'E04', 'TRÊS EM UM', 'três botões · dois saltos');
      lights(w, [[0, 0], [-9, -2], [0, 7], [5, -16], [0, -12]], 5.6, 48);
      return {
        spawn: [0, 0, 3, 0],
        gun: 'both',
        relogio: true,
        intro: [
          ['Seu Tião', 'Três botões, uma porta. Ela só abre com os três pisados ao mesmo tempo, e você é um só.'],
          ['Seu Tião', 'Salte do primeiro botão para perto do segundo e deixe o passado pisando o primeiro. Pise o segundo e salte de novo, para perto do terceiro: agora são dois passados e você.'],
          ['Seu Tião', 'O segundo salto precisa cair depois do primeiro: não dá para voltar a antes da própria chegada. E o passado precisa durar até a porta abrir.'],
        ],
        hints: [
          { after: 150, lines: [['Seu Tião', 'Primeiro salto: azul na parede oeste, laranja na parede sul, com bastante tempo (uns dez segundos). Segundo: azul na sul, laranja ao lado da porta, uns três segundos.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ E05
  E(4, {
    name: 'Paradoxo',
    who: 'Dona Cida',
    lesson: 'Duas portas, dois botões longe delas e uma bola de energia no meio. O seu passado precisa de caminho livre: se algo o bloquear, o tempo desfaz o loop.',
    build(w) {
      // sala 1 (partida), sala 2 (depois da porta d1) e a saída (porta d2)
      hall(w, -12, 12, -6, 14, 6, { n: false });
      hall(w, -12, 12, -30, -6, 6, { n: false, s: false });
      w.box(-12, -1, -7, -1.5, 6, -6, 'metal'); // parede entre as salas, com o vão da porta d1
      w.box(1.5, -1, -7, 12, 6, -6, 'metal');
      w.box(-1.5, 3.5, -7, 1.5, 6, -6, 'metal');
      w.door('d1', -1.5, 0, -6.8, 1.5, 3.5, -6.2);
      northWallWithExit(w, -12, 12, 6, -30, 'd2');
      w.button(-9, 0, 6, 'd1'); // B1 (sala 1, longe da porta)
      w.button(9, 0, -14, 'd2'); // B2 (sala 2, longe da saída)
      for (const [x, z] of [[-9, 6], [9, -14]]) w.strip(x - 0.8, 0.005, z - 0.9, x + 0.8, 0.03, z - 0.8, 0xffb347, 2);
      // painéis de portal: perto de cada botão e perto de cada porta
      panel(w, -12, 0, 0, -11.9, 5, 12); // sala 1, oeste (B1)
      panel(w, -9, 0, -6, -4, 5, -5.9); // sala 1, ao lado da porta d1
      panel(w, 11.9, 0, -20, 12, 5, -10); // sala 2, leste (B2)
      panel(w, 3, 0, -30, 9, 5, -29.9); // sala 2, ao lado da saída d2
      // a bola de energia varre a sala 2 (e o seu passado, se ele cruzar com ela)
      w.launcher(-12, 1.1, -12, [1, 0, 0], { delay: 2, life: 7, speed: 6.5 });
      sign(w, 11.97, 3.2, 8, -Math.PI / 2, 'E05', 'PARADOXO', 'o passado precisa de caminho livre');
      lights(w, [[0, 6], [-8, 6], [0, -12], [8, -12], [0, -24]], 5.6, 50);
      return {
        spawn: [6, 0, 12, 0],
        gun: 'both',
        relogio: true,
        cubes: [[3, 0, 9]], // um cubo solto: se ele ficar no caminho do seu passado, é paradoxo
        intro: [
          ['Dona Cida', 'Duas portas. A primeira só abre com alguém no botão da sala; a segunda, no botão da sala de trás — e os dois ficam longe das portas.'],
          ['Dona Cida', 'Dois saltos, um dentro do outro. E um aviso: o seu passado repete exatamente o que você fez. Se uma porta, uma bola de energia ou um cubo estiver no caminho dele, o tempo vê o paradoxo e desfaz o loop.'],
        ],
        hints: [
          { after: 180, lines: [['Dona Cida', 'Salte uns quatro segundos do botão da primeira sala para perto da porta d1. Atravesse, pise o segundo botão, espere, e salte de novo uns três segundos para perto da saída.']] },
        ],
      };
    },
  }),
];
