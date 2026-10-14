// Desafios hardcore: salas enormes sobre rocha fundida, plataformas que voam
// na diagonal com paradas curtas nas pontas, pistões que esmagam, rampas,
// chuva de bolas de energia e uma grade que apaga seus portais no meio de
// uma queda. Dá para passar sem o tempo lento — mas é para isso que ele existe.
//
// Coordenadas em metros; o norte (saída) fica em −z.

import { portalGun } from './models.js';

const H = (n, def) => ({ ...def, id: 200 + n, n, code: `H${String(n + 1).padStart(2, '0')}`, series: 'hard', music: def.music ?? 'labTense', heat: def.heat ?? true });

/** salão: paredes e teto de metal (sem chão) */
export function hall(w, x0, x1, z0, z1, y0, top, mat = 'metal') {
  w.box(x0 - 1, y0, z0 - 1, x0, top, z1 + 1, mat);
  w.box(x1, y0, z0 - 1, x1 + 1, top, z1 + 1, mat);
  w.box(x0, y0, z1, x1, top, z1 + 1, mat);
  w.box(x0, y0, z0 - 1, x1, top, z0, mat);
  w.box(x0 - 1, top, z0 - 1, x1 + 1, top + 1, z1 + 1, 'metal');
}

/** chão de rocha fundida (mata) */
export function lava(w, x0, x1, z0, z1, y) {
  w.box(x0, y - 2, z0, x1, y, z1, 'rock');
  w.hazard(x0, y, z0, x1, y + 0.6, z1);
}

/** pilar/ilha com o topo em `top` e frisos acesos nas bordas de cima (leitura do salto) */
export function pillar(w, x0, z0, x1, z1, top, mat = 'metal', base = -8) {
  const b = w.box(x0, base, z0, x1, top, z1, mat);
  const e = 0.08;
  const c = 0x8fd8ff;
  w.strip(x0, top - 0.06, z0 - 0.005, x1, top + 0.005, z0 + e, c, 1.8);
  w.strip(x0, top - 0.06, z1 - e, x1, top + 0.005, z1 + 0.005, c, 1.8);
  w.strip(x0 - 0.005, top - 0.06, z0, x0 + e, top + 0.005, z1, c, 1.8);
  w.strip(x1 - e, top - 0.06, z0, x1 + 0.005, top + 0.005, z1, c, 1.8);
  return b;
}

/** rampa reta: de (x, y0, z0) até (x, y1, z1) ao longo de z, largura `wd` */
export function rampZ(w, x, wd, z0, y0, z1, y1) {
  const L = Math.hypot(z1 - z0, y1 - y0);
  const th = Math.atan2(y1 - y0, z0 - z1); // sobe indo para −z
  const t = 0.6;
  const cy = (y0 + y1) / 2 - (t / 2) * Math.cos(th);
  const cz = (z0 + z1) / 2 - (t / 2) * Math.sin(th);
  return w.ramp(x, cy, cz, wd, t, L, [th, 0, 0]);
}

/** rampa reta ao longo de x: de (x0, y0) até (x1, y1), centrada em z, largura `wd` */
export function rampX(w, z, wd, x0, y0, x1, y1) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const ph = Math.atan2(y1 - y0, x1 - x0); // sobe indo para +x
  const t = 0.6;
  const cy = (y0 + y1) / 2 - (t / 2) * Math.cos(ph);
  const cx = (x0 + x1) / 2 + (t / 2) * Math.sin(ph);
  return w.ramp(cx, cy, z, L, t, wd, [0, 0, ph]);
}

/**
 * Pistão sobre uma rampa: a base é reta e a rampa sobe por baixo dela, então a
 * altura de cima conta a partir do ponto mais alto da rampa sob o pistão (com
 * folga para o jogador passar em pé) e a descida vai até o ponto mais baixo.
 */
function slopeCrusher(w, id, x0, x1, zc, depth, surfAt, opts) {
  const zUp = zc - depth / 2; // lado de cima da rampa (ela sobe para −z)
  const zDown = zc + depth / 2;
  const bottom = surfAt(zUp) + 2.45;
  const travel = bottom - surfAt(zDown);
  return w.mover(id, x0, bottom, zUp, x1, bottom + 5, zDown, { to: [0, -travel, 0], speed: 12, back: 3, crush: true, ...opts });
}

function sign(w, x, y, z, rotY, code, name, line2) {
  w.sign(x, y, z, rotY, [
    [`DESAFIO ${code}`, 104, 150],
    [name, 76, 270, '#c0392b'],
    [line2, 40, 380, '#55575c', 'Arial, sans-serif'],
    ['HARDCORE · LABORATÓRIO ANTÍPODA', 30, 455, '#8a8c90', 'Arial, sans-serif'],
  ]);
}

export const lamps = (w, pts, k = 420, dist = 95) => pts.forEach(([x, y, z]) => w.light(x, y, z, k, 0xfff1dc, dist));

export const HARD = [
  // ------------------------------------------------------------------ H01
  H(0, {
    name: 'Pistões Diagonais',
    who: 'Bigode',
    lesson: 'Plataformas voando na diagonal sobre a rocha fundida. Desça só na parada.',
    build(w) {
      hall(w, -16, 16, -100, 10, -8, 32);
      lava(w, -16, 16, -100, 10, -6);
      pillar(w, -4, 2, 4, 10, 0); // partida
      // 1: sobe e vai para a direita
      w.mover('m1', -1.5, -0.6, -1, 1.5, 0, 2, { to: [10, 6, -12], speed: 6, waits: [0.8, 0.7] });
      pillar(w, 8, -22, 14, -13.5, 6);
      // 2: desce cruzando o salão inteiro, rápido
      w.mover('m2', 9.5, 5.4, -25, 12.5, 6, -22, { to: [-20, -4, -12], speed: 7.5, waits: [0.7, 0.55], phase: 0.5 });
      pillar(w, -14, -46, -6, -37.5, 2);
      // 3: elevador diagonal
      w.mover('m3', -11.5, 1.4, -49, -8.5, 2, -46, { to: [0, 10, -10], speed: 6.5, waits: [0.7, 0.6] });
      pillar(w, -14, -66, -6, -59.5, 12);
      // rampa com dois pistões
      rampZ(w, -10, 4, -65.8, 12, -75.85, 18);
      const surf1 = (z) => 12 + (-65.8 - z) * 0.6;
      slopeCrusher(w, 'p1', -12.2, -7.8, -69.7, 1.6, surf1, { waits: [1.0, 0.45] });
      slopeCrusher(w, 'p2', -12.2, -7.8, -73.5, 1.6, surf1, { waits: [1.0, 0.45], phase: 0.6 });
      pillar(w, -14, -84, -6, -75.8, 18);
      // 4: o salto final, a mais rápida
      w.mover('m5', -11.5, 17.4, -87, -8.5, 18, -84, { to: [18, -10, -6], speed: 9, waits: [0.6, 0.5] });
      pillar(w, 4, -100, 16, -93.5, 8);
      w.exitElevator(10, 8, -97);
      sign(w, -15.97, 5, 4, Math.PI / 2, 'H01', 'PISTÕES DIAGONAIS', 'paradas curtas · tempo lento');
      lamps(w, [
        [0, 28, 2],
        [8, 28, -18],
        [-6, 28, -40],
        [-8, 28, -62],
        [-6, 28, -80],
        [8, 28, -94],
      ]);
      return {
        spawn: [0, 0, 7, 0],
        gun: 'none',
        intro: [
          ['Bigode', 'Sem arma hoje. Só perna e cabeça. Essas plataformas voam na diagonal e param menos de um segundo em cada ponta.'],
          ['Bigode', 'Sobe e desce só na parada. Botão do meio do mouse segura o tempo — usa sem vergonha.'],
        ],
        hints: [{ after: 60, lines: [['Bigode', 'Espera na beirada, de frente pra onde ela vai chegar. Quando parar, já pula.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ H02
  H(1, {
    name: 'Esmagadores',
    who: 'Rodrigo',
    lesson: 'Passe pelos pistões e pela chuva de bolas de energia.',
    build(w) {
      hall(w, -4, 4, -130, 8, -8, 12);
      w.box(-4, -1, -80, 4, 0, 8, 'metal');
      // seis pistões desencontrados
      [0, 0.35, 0.7, 0.15, 0.55, 0.85].forEach((ph, i) => {
        const z = -8 - i * 7;
        w.mover(`c${i}`, -4, 2.2, z - 0.8, 4, 11.9, z + 0.8, { to: [0, -2.2, 0], speed: 14, back: 2.5, waits: [0.75, 0.4], crush: true, phase: ph });
      });
      // chuva de bolas de energia atravessando o corredor
      for (const [z, y, d] of [
        [-56, 1.0, 0],
        [-61, 1.4, 0.7],
        [-66, 0.8, 1.4],
        [-71, 1.2, 0.35],
        [-76, 1.0, 1.0],
      ])
        w.launcher(-4, y, z, [1, 0, 0], { speed: 9, life: 30, delay: 0.5 + d });
      // rampa e a ponte que vai e volta sobre a rocha fundida
      rampZ(w, 0, 8, -80, 0, -90, 6);
      pillar(w, -4, -96, 4, -89.85, 6);
      lava(w, -4, 4, -110.5, -96, -4);
      w.mover('ponte', -1.5, 5.4, -99, 1.5, 6, -96, { to: [0, 0, -11], speed: 8, waits: [0.6, 0.6] });
      pillar(w, -4, -130, 4, -110.5, 6);
      w.exitElevator(0, 6, -124);
      sign(w, 3.97, 4, 2, -Math.PI / 2, 'H02', 'ESMAGADORES', 'pistões · bolas de energia · ponte');
      lamps(w, [
        [0, 10.5, -2],
        [0, 10.5, -30],
        [0, 10.5, -66],
        [0, 10.5, -100],
      ], 160, 50);
      return {
        spawn: [0, 0, 5, 0],
        gun: 'none',
        intro: [
          ['Rodrigo', 'Seis pistões de perfuração, fora de sincronia. Passa embaixo quando estiver lá em cima — e não para no meio.'],
          ['Rodrigo', 'Depois vem a chuva de bolas de energia e uma ponte que não espera ninguém.'],
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ H03
  H(2, {
    name: 'Queda Livre',
    who: 'Seu Tião',
    lesson: 'A grade apaga os portais na queda: abra os dois no ar e saia pelo túnel.',
    build(w) {
      // poço de 60 m, com um túnel de saída no meio da parede sul
      w.box(-11, -4, -11, -10, 62, 11, 'metal');
      w.box(10, -4, -11, 11, 62, 11, 'metal');
      w.box(-10, -4, -11, 10, 62, -10, 'metal');
      w.box(-11, -4, 10, -3, 62, 11, 'metal');
      w.box(3, -4, 10, 11, 62, 11, 'metal');
      w.box(-3, -4, 10, 3, 24, 11, 'metal');
      w.box(-3, 31, 10, 3, 62, 11, 'metal');
      w.box(-11, 62, -11, 11, 63, 11, 'metal');
      // rocha fundida em volta do pilar (embaixo dele não: quem cai rápido no
      // portal passa metade do corpo para baixo do chão antes de atravessar)
      lava(w, -10, 10, -10, -2.5, 0);
      lava(w, -10, 10, 2.5, 10, 0);
      lava(w, -10, -2.5, -2.5, 2.5, 0);
      lava(w, 2.5, 10, -2.5, 2.5, 0);
      pillar(w, -2.5, -2.5, 2.5, 2.5, 1, 'white', -4); // alvo lá embaixo
      w.box(-3, 26, -10, 3, 33, -9.8, 'white'); // placa na parede norte (saliente)
      // túnel de saída
      w.box(-3, 20, 11, 3, 24, 50, 'metal');
      w.box(-4, 20, 11, -3, 31, 50, 'metal');
      w.box(3, 20, 11, 4, 31, 50, 'metal');
      w.box(-4, 31, 11, 4, 32, 50, 'metal');
      w.box(-4, 20, 50, 4, 32, 51, 'metal');
      w.exitElevator(0, 24, 45);
      // beirada lá no alto e a grade logo abaixo dela
      w.box(4, 48, -6, 10, 50, 6, 'metal');
      w.fizzler(-10, 45.9, -10, 10, 46.1, 10);
      sign(w, 9.97, 52, 2, -Math.PI / 2, 'H03', 'QUEDA LIVRE', 'abra os portais no ar');
      lamps(w, [
        [0, 58, 0],
        [0, 30, 0],
        [0, 6, 0],
        [0, 29, 30],
      ], 260, 70);
      return {
        spawn: [7, 50, 0, Math.PI / 2],
        gun: 'both',
        intro: [
          ['Seu Tião', 'Cinquenta metros de poço. Logo abaixo da beirada tem uma grade que apaga qualquer portal que você abrir daqui de cima.'],
          ['Seu Tião', 'Então é no ar: um portal no pilar branco lá embaixo, outro na placa branca da parede. Você sai voando pro túnel.'],
        ],
        hints: [{ after: 40, lines: [['Seu Tião', 'Pula, passa da grade, segura o tempo e mira com calma: pilar primeiro, placa depois.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ H04
  H(3, {
    name: 'Rampas e Torretas',
    who: 'Marquinho',
    lesson: 'Suba as rampas sobre a rocha fundida sob a mira das torretas.',
    build(w) {
      hall(w, -20, 20, -92, 10, -8, 28);
      lava(w, -20, 20, -92, 10, -4);
      pillar(w, -20, -2, -6, 10, 0, 'white'); // partida
      rampZ(w, -15, 6, -2, 0, -12, 5);
      pillar(w, -20, -26, -6, -11.9, 5, 'white'); // terraço 1
      w.box(-10, 5, -18, -8, 7.4, -16, 'metal'); // abrigo
      rampX(w, -20, 6, -6.1, 5, 6, 10);
      pillar(w, 6, -36, 20, -14, 10, 'white'); // terraço 2
      w.box(10, 10, -30, 12, 12.4, -28, 'metal');
      rampZ(w, 11, 6, -36, 10, -46, 15);
      pillar(w, -6, -62, 20, -45.9, 15, 'white'); // terraço 3
      w.box(2, 15, -52, 4, 17.4, -50, 'metal');
      w.box(14, 15, -54, 16, 17.4, -52, 'metal');
      // última travessia: plataforma diagonal até a saída, sob fogo
      w.mover('m', 4, 14.4, -65, 7, 15, -62, { to: [-8, 5, -12], speed: 7, waits: [0.7, 0.6] });
      pillar(w, -12, -92, 4, -77.5, 20);
      w.exitElevator(-4, 20, -86);
      sign(w, -19.97, 4, 4, Math.PI / 2, 'H04', 'RAMPAS E TORRETAS', 'escudo · tempo lento · queda');
      lamps(w, [
        [-12, 24, 0],
        [-12, 24, -18],
        [8, 24, -24],
        [10, 26, -42],
        [6, 26, -56],
        [-4, 26, -84],
      ]);
      return {
        spawn: [-13, 0, 6, 0],
        gun: 'both',
        cubes: [
          [-16, 0, 2],
          [-10, 0, 2],
          [-14, 5, -22],
          [8, 15, -56],
        ],
        turrets: [
          [17, 10, -18, -Math.PI / 2],
          [15, 15, -50, 0],
          [0, 15, -58, 0.74],
          [-8, 20, -88, 0.3],
        ],
        intro: [
          ['Marquinho', 'Rampa, terraço, rampa. Torreta em cada canto e rocha fundida embaixo de tudo.'],
          ['Marquinho', 'Carrega uma amostra na frente que ela segura os tiros. E o tempo lento ajuda a passar entre uma rajada e outra.'],
        ],
        hints: [{ after: 60, lines: [['Marquinho', 'Os terraços são brancos: um portal embaixo da torreta e outro na parede derruba ela de longe.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ H05
  H(4, {
    name: 'Inferno',
    who: 'Dona Cida',
    lesson: 'Ligue a ponte com a bola de energia e atravesse tudo até o fim.',
    build(w) {
      hall(w, -14, 14, -130, 10, -10, 40);
      lava(w, -14, 14, -130, 10, -6);
      // 1) sala de partida: bola de energia no receptor liga as plataformas
      pillar(w, -14, -12, 14, 10, 0, 'white');
      w.launcher(-14, 1.09, -4, [1, 0, 0], { speed: 7 });
      w.catcher(10, 9, 10, [0, 0, -1], 'ponte');
      w.box(13.8, 0, -7, 14, 4, -1, 'white'); // onde a bola bate
      w.box(8, 0, -12, 12, 12, -11, 'white'); // bloco virado para o receptor
      // 2) duas plataformas diagonais em sequência (só andam com a ponte ligada)
      w.mover('ponte', -1.5, -0.6, -15, 1.5, 0, -12, { to: [-9, 7, -14], speed: 7, waits: [0.7, 0.55], always: false });
      pillar(w, -14, -38, -7, -29.5, 7);
      w.mover('ponte', -9, 6.4, -41, -6, 7, -38, { to: [16, -3, -12], speed: 8.5, waits: [0.6, 0.5], always: false, phase: 0.3 });
      pillar(w, 5, -62, 14, -53.5, 4);
      // 3) rampa com três pistões
      rampZ(w, 9.5, 5, -61.9, 4, -73.9, 11);
      const surf5 = (z) => 4 + ((-61.9 - z) * 7) / 12;
      [0, 0.4, 0.8].forEach((ph, i) => slopeCrusher(w, `p${i}`, 7, 12, -64.5 - i * 3.6, 1.6, surf5, { speed: 13, waits: [0.9, 0.4], phase: ph }));
      pillar(w, 4, -84, 14, -73.8, 11);
      // 4) elevador até a torre de mergulho
      w.mover('subida', 0.5, 10.4, -83, 3.5, 11, -80, { to: [0, 19, 0], speed: 4, waits: [1.5, 1.5] });
      pillar(w, -14, -84, 0, -78, 30);
      // 5) mergulho: a grade (abaixo do alto da torre) apaga os portais — abra os
      // dois no ar: no alvo lá embaixo e na placa da face norte da torre
      w.fizzler(-14, 25.9, -100, 14, 26.1, -79);
      w.box(-6, 4, -84.2, 2, 10, -84, 'white');
      pillar(w, -4, -91, 4, -85, 1, 'white');
      pillar(w, -6, -125, 6, -98, 2);
      w.exitElevator(0, 2, -118);
      sign(w, 13.97, 5, -2, -Math.PI / 2, 'H05', 'INFERNO', 'tudo junto · sem perdão');
      lamps(w, [
        [0, 34, 0],
        [-4, 34, -36],
        [8, 34, -68],
        [-6, 34, -92],
        [0, 20, -116],
      ], 420, 95);
      return {
        spawn: [0, 0, 6, 0],
        gun: 'both',
        intro: [
          ['Dona Cida', 'Último desafio, meu filho. A bola de energia no receptor lá do alto liga as plataformas.'],
          ['Dona Cida', 'Depois tem pistão, tem mergulho com grade, tem tudo. Respira, e usa o tempo lento.'],
        ],
        hints: [
          { after: 60, lines: [['Dona Cida', 'O receptor tá na parede de trás, lá no alto. Um portal onde a bola bate, outro no bloco branco apontando pra ele.']] },
          { after: 240, lines: [['Dona Cida', 'No mergulho: pula da torre, passa da grade e abre um portal no alvo lá embaixo e outro na placa branca da torre.']] },
        ],
      };
    },
  }),
];
