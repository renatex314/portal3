// Série Momento — Parte 2: testes ainda mais difíceis, que misturam o momento
// com o resto do laboratório: bolas de energia cruzando o voo, torretas de
// guarda, buracos negros que entortam a trajetória, zonas sem peso, viagem no
// tempo, placas de lançamento e funis. As grades de desintegração ficam a
// poucos metros dos painéis de captura: a janela para abrir os portais no ar
// é de menos de um segundo.
//
// Coordenadas em metros; o chão de referência é y = 0 e a rocha fundida fica em
// y = −4. Ângulos dos painéis: a normal da face é para onde eles atiram.

import { lava, pillar, lamps } from './hard.js';
import { M, D, sign, walls, dropShaft } from './momentum.js';

// M08: posições medidas por simulação (o voo é curvado pelos buracos negros)
const M08 = {
  bh: [
    [-18.8, 29, -17.8, 220],
    [-43.7, 29, -62.8, 220],
    [-12.5, 29, -114.5, 220],
    [-38.6, 29, -159.7, 220],
  ],
  hops: [
    { c: [0.7, -59.3], cn: [-0.528, 0.707, 0.47], l: [-4.5, -49], ln: [-0.5, D, -0.5], f: -47 },
    { c: [-62.4, -105], cn: [0.516, 0.707, 0.484], l: [-51.7, -100.7], ln: [0.5, D, -0.5], f: -98.7 },
    { c: [5.8, -156.2], cn: [-0.527, 0.707, 0.471], l: [0.6, -145.9], ln: [-0.5, D, -0.5], f: -143.9 },
    { c: [-57, -202], cn: [0.514, 0.707, 0.486], l: [-46.3, -197.7], ln: [0, 0.94, -0.342], f: -195.7 },
  ],
  exit: [-35.6, -260.4],
  lanes: [-135, -188],
};

// paredão de ponta a ponta que só existe numa época (faixas coloridas dão a pista:
// azul = passado, vermelho = futuro)
const eraSlab = (w, x0, x1, za, zb, era) => {
  const z0 = Math.min(za, zb);
  const z1 = Math.max(za, zb);
  w.box(x0, -4, z0, x1, 62, z1, era === 'past' ? 'metal' : 'rock', { era });
  const col = era === 'past' ? 0x38d8ff : 0xff4a2a;
  for (const x of [x0 + 0.2, x1 - 0.4]) w.inEra(w.strip(x, 4, z0 - 0.4, x + 0.2, 56, z0 - 0.1, col, 1.2), era);
};

// M10: paredões [passado, futuro] de cada salto (z do início de cada um), vãos de bolas e torretas
const M10_SLABS = [
  [-22, -35],
  [-68, -81],
  [-119, -132],
  [-165, -178],
];
const M10_PELLETS = [
  [-129, 24],
  [-175, 20],
];
const M10_TURRETS = [
  [-60, 30, -244, 1.2],
  [-12, 30, -244, -1.2],
];

export const MOMENTUM2 = [
  // ------------------------------------------------------------------ M07
  M(6, {
    name: 'Fogo Cruzado',
    who: 'Bigode',
    music: 'labTense',
    lesson: 'Cinco arremessos em zigue-zague, com a grade quase em cima do painel de captura — e bolas de energia e torretas no caminho.',
    build(w) {
      walls(w, -62, 45, -272, 24, -6, 62);
      w.box(-63, 62, -273, 46, 63, 25, 'metal');
      lava(w, -62, 45, -272, 24, -4);
      // torre de partida (poço de 40 m) e o primeiro painel de lançamento (NE)
      dropShaft(w, -30, 12, 40, { size: 8, wall: 2 });
      const NE = [0.5, D, -0.5];
      const NW = [-0.5, D, -0.5];
      const SW = [-0.5, D, 0.5];
      const SE = [0.5, D, 0.5];
      w.panel([-32, 2.5, -4], NE, { w: 5, h: 5, stand: -4 });
      // cada salto: captura (pega-voo, grande) → lançamento (do lado de cá) → grade colada na captura
      const hop = (cx, cz, catchN, launchOff, launchN, fz) => {
        w.panel([cx, 2.5, cz], catchN, { w: 7, h: 8, stand: -4, color: 0xffb03a });
        w.panel([cx + launchOff[0], 2.5, cz + launchOff[1]], launchN, { w: 5, h: 5, stand: -4 });
        w.fizzler(-45, -4, fz - 0.1, 45, 62, fz + 0.1);
      };
      hop(24.6, -60.6, SW, [-4.6, 10.6], NW, -48);
      hop(-36.6, -106.6, SE, [4.6, 10.6], NE, -94);
      hop(24.6, -152.6, SW, [-4.6, 10.6], NW, -140);
      // o desvio acumulado dos saltos anteriores leva o voo para (-30, -205): o painel fica onde o voo realmente cai
      hop(-30, -205.1, SE, [4.6, 10.6], [0, 0.94, -0.342], -192.5);
      // o pouso final varia alguns metros de uma tentativa para outra: o pilar é largo
      pillar(w, -60, -268, -8, -214, 30);
      w.exitElevator(-32, 30, -240);
      // bolas de energia cruzando o salão no alto de cada salto: colunas de três lançadores,
      // cada um com o seu ritmo (a bola vive 15 s: ela atravessa, bate na parede e volta)
      const lane = (side, y, zc, d0) =>
        [-3, 0, 3].forEach((dz, i) =>
          w.launcher(side * 45, y, zc + dz, [-side, 0, 0], { delay: d0 + i * 2.3, life: 15, speed: 6.5 }),
        );
      lane(-1, 25, -34, 1.0); // salto 1 (o voo passa a 25 m, perto do centro)
      lane(1, 18, -82, 4.5); // salto 2
      lane(-1, 27, -128, 8.0); // salto 3
      lane(1, 18, -176, 11.5); // salto 4
      sign(w, 44.97, 30, 0, -Math.PI / 2, 'M07', 'FOGO CRUZADO', 'cinco arremessos · janela de meio segundo');
      lamps(w, [
        [-30, 58, 10],
        [10, 58, -40],
        [-10, 58, -90],
        [10, 58, -140],
        [-10, 58, -190],
        [-32, 58, -230],
      ], 600, 120);
      return {
        spawn: [-30, 40, 6.2, Math.PI],
        gun: 'both',
        dinos: [{ s: 'ptero', scale: 1.2, orbit: { cx: 0, cz: -120, rx: 30, rz: 100, y: 46, speed: 11, bank: 0.35, bob: 1.5 } }],
        intro: [
          ['Bigode', 'Cinco arremessos, um atrás do outro. Os painéis laranja pegam você no ar; os brancos pequenos jogam pro outro lado.'],
          ['Bigode', 'E a grade agora fica colada no painel de captura: você passa por ela e tem meio segundo para abrir os dois portais.'],
        ],
        hints: [
          { after: 90, lines: [['Bigode', 'Tempo lento antes da grade. Passou dela: um portal no laranja, outro no painel pequeno do mesmo lado.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ M08
  M(7, {
    name: 'Singularidade',
    who: 'Kelly',
    music: 'labEpic',
    lesson: 'Buracos negros entortam o voo: o painel de captura fica onde a trajetória curva leva você — e a borda deles não devolve ninguém.',
    build(w) {
      const C = M08;
      walls(w, -70, 70, -300, 24, -6, 70);
      w.box(-71, 70, -301, 71, 71, 25, 'metal');
      lava(w, -70, 70, -300, 24, -4);
      dropShaft(w, -56, 12, 40, { size: 8, wall: 2 });
      w.panel([-58, 2.5, -4], [0.5, D, -0.5], { w: 5, h: 5, stand: -4 });
      // cada salto: captura (grande, virada contra a velocidade de chegada) → lançamento → grade 2 m antes dele
      for (const h of C.hops) {
        w.panel([h.c[0], 2.5, h.c[1]], h.cn, { w: 8, h: 9, stand: -4, color: 0xffb03a });
        w.panel([h.l[0], 2.5, h.l[1]], h.ln, { w: 5, h: 5, stand: -4 });
        w.fizzler(-70, -4, h.f - 0.1, 70, 70, h.f + 0.1);
      }
      for (const [x, y, z, strength] of C.bh) w.blackHole(x, y, z, { strength, horizon: 1.6, reach: 40 });
      // plataforma de saída
      pillar(w, C.exit[0] - 28, C.exit[1] - 28, C.exit[0] + 28, C.exit[1] + 28, 30);
      w.exitElevator(C.exit[0], 30, C.exit[1]);
      // bolas de energia que os buracos negros entortam, cruzando o alto dos saltos 3 e 4
      [-3, 3].forEach((dz, i) => {
        w.launcher(-70, 19, C.lanes[0] + dz, [1, 0, 0], { delay: 2 + i * 3.1, life: 22, speed: 7 });
        w.launcher(70, 27, C.lanes[1] + dz, [-1, 0, 0], { delay: 5 + i * 3.1, life: 22, speed: 7 });
      });
      sign(w, 69.97, 30, 0, -Math.PI / 2, 'M08', 'SINGULARIDADE', 'buracos negros · trajetórias curvas');
      lamps(w, [
        [-56, 66, 10],
        [0, 66, -40],
        [0, 66, -120],
        [0, 66, -200],
        [-30, 66, -270],
      ], 700, 140);
      return {
        spawn: [-56, 40, 6.2, Math.PI],
        gun: 'both',
        dinos: [{ s: 'ptero', scale: 1.3, orbit: { cx: 0, cz: -150, rx: 50, rz: 110, y: 52, speed: 11, bank: 0.35, bob: 1.5 } }],
        intro: [
          ['Kelly', 'Quatro buracos negros no salão. Eles puxam você, as bolas de energia e a trajetória inteira: o painel de captura nunca fica onde a conta de cabeça diria.'],
          ['Kelly', 'Nada de errar o horizonte: passou da borda, não volta. E a grade fica a meio segundo do painel.'],
        ],
        hints: [
          { after: 90, lines: [['Kelly', 'Olha pra onde o voo curva, não pra onde ele começou. O laranja está sempre no ponto de pouso, virado contra a sua velocidade.']] },
        ],
      };
    },
  }),
  // ------------------------------------------------------------------ M09
  M(8, {
    name: 'Paradoxo',
    who: 'Dona Cida',
    music: 'labTense',
    lesson: 'Os mesmos cinco arremessos, mas com paredões que só existem em uma época: troque de época (T) no ar, duas vezes por salto, antes de chegar na grade.',
    build(w) {
      walls(w, -62, 45, -272, 24, -6, 62);
      w.box(-63, 62, -273, 46, 63, 25, 'metal');
      lava(w, -62, 45, -272, 24, -4);
      dropShaft(w, -30, 12, 40, { size: 8, wall: 2 });
      const NE = [0.5, D, -0.5];
      const NW = [-0.5, D, -0.5];
      const SW = [-0.5, D, 0.5];
      const SE = [0.5, D, 0.5];
      w.panel([-32, 2.5, -4], NE, { w: 5, h: 5, stand: -4 });
      const hop = (cx, cz, catchN, launchOff, launchN, fz) => {
        w.panel([cx, 2.5, cz], catchN, { w: 7, h: 8, stand: -4, color: 0xffb03a });
        w.panel([cx + launchOff[0], 2.5, cz + launchOff[1]], launchN, { w: 5, h: 5, stand: -4 });
        w.fizzler(-45, -4, fz - 0.1, 45, 62, fz + 0.1);
      };
      hop(24.6, -60.6, SW, [-4.6, 10.6], NW, -48);
      hop(-36.6, -106.6, SE, [4.6, 10.6], NE, -94);
      hop(24.6, -152.6, SW, [-4.6, 10.6], NW, -140);
      hop(-30, -205.1, SE, [4.6, 10.6], [0, 0.94, -0.342], -192.5);
      pillar(w, -60, -268, -8, -214, 30);
      w.exitElevator(-32, 30, -240);
      // paredões de ponta a ponta: um só existe no passado (a), o outro só no futuro (b);
      // entre eles há um vão de 8 m para trocar de época de novo
      const slab = (za, zb, era) => eraSlab(w, -62, 45, za, zb, era);
      for (const [a0, b0] of [
        [-14, -30],
        [-68, -84],
        [-114, -130],
        [-160, -176],
      ]) {
        slab(a0, a0 - 8, 'past');
        slab(b0, b0 - 8, 'future');
      }
      // bolas de energia nos vãos entre os paredões
      const lane = (side, y, zc, d0) =>
        [-3, 0, 3].forEach((dz, i) =>
          w.launcher(side * 45, y, zc + dz, [-side, 0, 0], { delay: d0 + i * 2.3, life: 15, speed: 6.5 }),
        );
      lane(-1, 25, -26, 1.0);
      lane(1, 18, -80, 4.5);
      lane(-1, 27, -126, 8.0);
      lane(1, 18, -172, 11.5);
      sign(w, 44.97, 30, 0, -Math.PI / 2, 'M09', 'PARADOXO', 'T no ar · quatro paredões');
      lamps(w, [
        [-30, 58, 10],
        [10, 58, -40],
        [-10, 58, -90],
        [10, 58, -140],
        [-10, 58, -190],
        [-32, 58, -230],
      ], 600, 120);
      return {
        spawn: [-30, 40, 6.2, Math.PI],
        gun: 'both',
        timeTravel: true,
        eraNames: ['PASSADO · 2009', 'FUTURO · 2187'],
        dinos: [{ s: 'ptero', scale: 1.2, orbit: { cx: 0, cz: -120, rx: 30, rz: 100, y: 46, speed: 11, bank: 0.35, bob: 1.5 } }],
        intro: [
          ['Dona Cida', 'O mesmo percurso do Fogo Cruzado, só que agora tem paredão atravessando o salão: o azul só existe no passado, o vermelho só no futuro.'],
          ['Dona Cida', 'No ar, aperte T antes do azul, volte no vão entre os dois e abra os portais depois da grade. Se errar o tempo, você bate na parede.'],
        ],
        hints: [
          { after: 90, lines: [['Dona Cida', 'Faixa azul na parede = paredão do passado. Faixa vermelha = do futuro. Vá para o futuro antes da azul e volte para o passado antes da vermelha.']] },
        ],
      };
    },
  }),
  // ------------------------------------------------------------------ M10
  M(9, {
    name: 'Horizonte de Eventos',
    who: 'Seu Tião',
    music: 'labEpic',
    lesson: 'O teste final: buracos negros que entortam o voo, paredões de duas épocas, bolas de energia e torretas esperando na plataforma de saída.',
    build(w) {
      const C = M08;
      walls(w, -70, 70, -300, 24, -6, 70);
      w.box(-71, 70, -301, 71, 71, 25, 'metal');
      lava(w, -70, 70, -300, 24, -4);
      dropShaft(w, -56, 12, 40, { size: 8, wall: 2 });
      w.panel([-58, 2.5, -4], [0.5, D, -0.5], { w: 5, h: 5, stand: -4 });
      for (const h of C.hops) {
        w.panel([h.c[0], 2.5, h.c[1]], h.cn, { w: 8, h: 9, stand: -4, color: 0xffb03a });
        w.panel([h.l[0], 2.5, h.l[1]], h.ln, { w: 5, h: 5, stand: -4 });
        w.fizzler(-70, -4, h.f - 0.1, 70, 70, h.f + 0.1);
      }
      for (const [x, y, z, strength] of C.bh) w.blackHole(x, y, z, { strength, horizon: 1.6, reach: 40 });
      pillar(w, C.exit[0] - 28, C.exit[1] - 28, C.exit[0] + 28, C.exit[1] + 28, 30);
      w.exitElevator(C.exit[0], 30, C.exit[1]);
      // corredor de concreto até o elevador: as torretas só enxergam quem ainda está na entrada
      w.box(C.exit[0] - 9.4, 30, C.exit[1] - 0.6, C.exit[0] - 8.4, 34, C.exit[1] + 19.4, 'metal');
      w.box(C.exit[0] + 9.4, 30, C.exit[1] - 0.6, C.exit[0] + 10.4, 34, C.exit[1] + 19.4, 'metal');
      // dois paredões por salto (passado e futuro), com um vão curto entre eles
      for (const [a0, b0] of M10_SLABS) {
        eraSlab(w, -70, 70, a0, a0 - 7, 'past');
        eraSlab(w, -70, 70, b0, b0 - 7, 'future');
      }
      // bolas de energia nos vãos dos saltos 3 e 4
      [-2, 2].forEach((dz, i) => {
        w.launcher(-70, M10_PELLETS[0][1], M10_PELLETS[0][0] + dz, [1, 0, 0], { delay: 2 + i * 3.1, life: 22, speed: 7 });
        w.launcher(70, M10_PELLETS[1][1], M10_PELLETS[1][0] + dz, [-1, 0, 0], { delay: 5 + i * 3.1, life: 22, speed: 7 });
      });
      sign(w, 69.97, 30, 0, -Math.PI / 2, 'M10', 'HORIZONTE DE EVENTOS', 'tudo junto · sem margem');
      lamps(w, [
        [-56, 66, 10],
        [0, 66, -40],
        [0, 66, -120],
        [0, 66, -200],
        [-30, 66, -270],
      ], 700, 140);
      return {
        spawn: [-56, 40, 6.2, Math.PI],
        gun: 'both',
        timeTravel: true,
        eraNames: ['PASSADO · 2009', 'FUTURO · 2187'],
        turrets: M10_TURRETS,
        dinos: [{ s: 'ptero', scale: 1.4, orbit: { cx: 0, cz: -150, rx: 50, rz: 110, y: 52, speed: 11, bank: 0.35, bob: 1.5 } }],
        intro: [
          ['Seu Tião', 'Quatro buracos negros, paredões que mudam de época, bolas de energia e, no fim, as torretas. Tudo ao mesmo tempo.'],
          ['Seu Tião', 'Troque de época antes da faixa azul, volte no vão, e só depois da grade abra os portais. A curva do voo você já conhece.'],
        ],
        hints: [
          { after: 120, lines: [['Seu Tião', 'Painel laranja é onde o voo termina, não onde parece. E as torretas só atiram em quem está de pé na plataforma: corra para o elevador.']] },
        ],
      };
    },
  }),
];
