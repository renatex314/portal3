// As seis câmaras de teste do Laboratório Antípoda — cada uma ligada a um
// personagem e a uma técnica do documentário (Parte II da visita).
// Coordenadas em metros; o chão "normal" de cada sala fica em y = 0.
// `dinos`: dinossauros decorativos da câmara (cada cabine ainda ganha um
// raptor-mascote automaticamente).

import * as THREE from 'three';
import { BIG_MAP } from './bigmap.js';
import { CLASSIC } from './classic.js';
import { HARD } from './hard.js';
import { MOMENTUM } from './momentum.js';

const G = 9.8;
const DIRS = {
  '+x': [1, 0],
  '-x': [-1, 0],
  '+z': [0, 1],
  '-z': [0, -1],
};

/** cabine de observação envidraçada presa numa parede, com o personagem dentro */
function booth(w, cx, cy, cz, facing, who, list) {
  const [dx, dz] = DIRS[facing];
  const lx = -dz;
  const lz = dx;
  const P = (lat, dep) => [cx + lx * lat + dx * dep, cz + lz * lat + dz * dep];
  const B = (lat0, dep0, y0, lat1, dep1, y1, mat) => {
    const [x0, z0] = P(lat0, dep0);
    const [x1, z1] = P(lat1, dep1);
    return w.box(x0, y0, z0, x1, y1, z1, mat);
  };
  B(-2.7, 0, cy - 0.4, 2.7, 2.6, cy, 'metal');
  B(-2.7, 0, cy + 3, 2.7, 2.6, cy + 3.4, 'metal');
  B(-2.7, 0, cy - 0.4, -2.5, 2.6, cy + 3.4, 'metal');
  B(2.5, 0, cy - 0.4, 2.7, 2.6, cy + 3.4, 'metal');
  B(-2.5, 2.45, cy, 2.5, 2.55, cy + 3, 'glass');
  B(-1.6, 1.7, cy, 1.6, 2.2, cy + 0.95, 'metal');
  const [sx, sz] = P(0, 2.25);
  w.strip(sx - (lx ? 1.4 : 0.02), cy + 0.97, sz - (lz ? 1.4 : 0.02), sx + (lx ? 1.4 : 0.02), cy + 1.0, sz + (lz ? 1.4 : 0.02), 0x8fe3ff, 2);
  const [lxp, lzp] = P(0, 1.2);
  w.light(lxp, cy + 2.6, lzp, 10, 0xfff0d8, 7);
  const [nx, nz] = P(0.6, 1.0);
  list.push({ who, x: nx, y: cy, z: nz, rotY: Math.atan2(dx, dz) });
}

/** parede norte (z = zIn, face interna) com nicho de saída e porta opcional */
export function northWallWithExit(w, x0, x1, top, zIn, doorId, yBase = 0) {
  w.box(x0 - 1, yBase, zIn - 1, -1.5, top, zIn, 'metal');
  w.box(1.5, yBase, zIn - 1, x1 + 1, top, zIn, 'metal');
  w.box(-1.5, yBase + 3.5, zIn - 1, 1.5, top, zIn, 'metal');
  w.box(-2.5, yBase - 2, zIn - 6, 2.5, yBase, zIn, 'metal');
  w.box(-2.5, yBase, zIn - 5, -1.5, yBase + 4, zIn - 1, 'metal');
  w.box(1.5, yBase, zIn - 5, 2.5, yBase + 4, zIn - 1, 'metal');
  w.box(-2.5, yBase, zIn - 6, 2.5, yBase + 4, zIn - 5, 'metal');
  w.box(-2.5, yBase + 4, zIn - 5, 2.5, yBase + 5, zIn - 1, 'metal');
  if (doorId) w.door(doorId, -1.5, yBase, zIn - 0.3, 1.5, yBase + 3.5, zIn - 0.02);
  w.exitElevator(0, yBase, zIn - 3);
}

export function chamberSign(w, x, y, z, rotY, num, name, line2) {
  w.sign(x, y, z, rotY, [
    [`CÂMARA ${String(num).padStart(2, '0')}`, 110, 150],
    [name, 76, 270, '#c0392b'],
    [line2, 40, 380, '#55575c', 'Arial, sans-serif'],
    ['LABORATÓRIO ANTÍPODA · NOVA LIMA (MG)', 30, 455, '#8a8c90', 'Arial, sans-serif'],
  ]);
}

export const LEVELS = [
  // ------------------------------------------------------------------ 1
  {
    id: 1,
    name: 'A Bancada',
    who: 'Helena',
    music: 'lab',
    lesson: 'Atravesse o vão usando dois portais.',
    build(w) {
      const booths = [];
      w.box(-6, -6, -4, 6, 0, 6, 'white');
      w.box(-6, -6, -24, 6, 0, -10, 'white');
      w.box(-6, -8, -10, 6, -6, -4, 'rock');
      w.hazard(-6, -6, -10, 6, -5.4, -4);
      w.box(-7, -8, -4, -6, 9, 6, 'white');
      w.box(-7, -8, -10, -6, 9, -4, 'rock');
      w.box(-7, -8, -25, -6, 9, -10, 'white');
      w.box(6, -8, -4, 7, 9, 6, 'white');
      w.box(6, -8, -10, 7, 9, -4, 'rock');
      w.box(6, -8, -25, 7, 9, -10, 'white');
      w.box(-7, -8, 6, 7, 10, 7, 'metal');
      w.box(-7, -8, -25, 7, 10, -24, 'metal');
      w.box(-7, 9, -25, 7, 10, 7, 'metal');
      w.exitElevator(0, 0, -20);
      booth(w, 0, 4.6, -24, '+z', 'helena', booths);
      chamberSign(w, -5.97, 3.2, 1.5, Math.PI / 2, 1, 'A BANCADA', 'portais · vãos · lama quente');
      for (const z of [2, -7, -17]) w.light(0, 8.5, z, 45);
      w.trigger(-6, 0, -4, 6, 4, -1.5, {
        lines: [
          ['Seu Tião', 'Pula não, sô. Esse vão é largo demais.'],
          ['Seu Tião', 'Atira um portal na parede branca daqui e outro na parede branca do outro lado. Aí é só entrar.'],
        ],
      });
      return {
        spawn: [0, 0, 3.5, 0],
        booths,
        intro: [
          ['Helena', 'Bem-vindo ao Laboratório Antípoda. Aqui embaixo de Nova Lima a gente testa o que não dá pra testar no poço.'],
          ['Helena', 'Essa é a arma de portais: botão esquerdo abre o portal azul, botão direito abre o laranja.'],
          ['Helena', 'Portal só gruda em concreto claro. Rocha e metal, não. Leva você até o elevador do outro lado.'],
          ['Helena', 'Ah: o raptor de capacete aqui do lado é o Pipoca, nosso mascote. Ele não morde. Muito.'],
        ],
        dinos: [{ s: 'ptero', scale: 0.5, orbit: { cx: 0, cz: -7, rx: 3.5, rz: 5, y: 6, speed: 4, bank: 0.3, bob: 0.5 } }],
        hints: [{ after: 50, lines: [['Helena', 'Dica: mira a parede branca da esquerda, perto de você, e depois a parede branca da esquerda, depois do vão.']] }],
      };
    },
  },
  // ------------------------------------------------------------------ 2
  {
    id: 2,
    name: 'Itabirito',
    who: 'Luciana',
    music: 'lab',
    lesson: 'Busque a amostra lá no alto e coloque-a no botão.',
    build(w) {
      const booths = [];
      w.box(-8, -2, -16, 8, 0, 8, 'white');
      w.box(-9, 0, -17, -8, 12, 9, 'white');
      w.box(8, 0, -17, 9, 7, 9, 'metal');
      w.box(8, 7, -17, 9, 12, 9, 'white');
      w.box(-9, 0, 8, 9, 12, 9, 'rock');
      w.box(-9, 12, -17, 9, 13, 9, 'metal');
      w.box(4, 0, -7, 8, 7, 1, 'rock'); // pilar de itabirito com a amostra no topo
      northWallWithExit(w, -8, 8, 12, -16, 'd1');
      w.button(-4, 0, -6, 'd1');
      booth(w, -8, 4.5, -2, '+x', 'luciana', booths);
      chamberSign(w, -7.97, 3, 5, Math.PI / 2, 2, 'ITABIRITO', 'amostras · botões · alturas');
      for (const [x, z] of [
        [-3, 3],
        [3, -6],
        [-3, -12],
      ])
        w.light(x, 11.5, z, 50);
      return {
        spawn: [0, 0, 5, 0],
        cubes: [[6.2, 7, -3]],
        booths,
        dinos: [{ s: 'trice', scale: 0.3, x: -6, y: 0, z: 4.5, rotY: Math.PI / 2 }],
        intro: [
          ['Luciana', 'Lá em cima daquele pilar listrado tem uma amostra de itabirito. Ferro e quartzo de 2,4 bilhões de anos.'],
          ['Luciana', 'Eu preciso dela no botão vermelho pra liberar a porta. A tecla E pega e solta a amostra.'],
        ],
        hints: [{ after: 45, lines: [['Luciana', 'A parede branca acima do pilar aceita portal. Vai lá pro outro lado da sala que dá pra mirar nela por cima do pilar.']] }],
      };
    },
  },
  // ------------------------------------------------------------------ 3
  {
    id: 3,
    name: 'Fogo!',
    who: 'Bigode',
    music: 'lab',
    lesson: 'Velocidade que entra, velocidade que sai.',
    build(w) {
      const booths = [];
      w.box(-6, -2, -2, 6, 12, 6, 'metal'); // plataforma de partida
      w.box(-6, -8, -10, 6, 0, -2, 'white'); // piso de baixo
      w.box(-6, -10, -18, 6, -8, -10, 'rock');
      w.hazard(-6, -8, -18, 6, -7.4, -10);
      w.box(-6, -10, -34, 6, 0, -18, 'white'); // borda de chegada
      w.box(-7, -10, -35, -6, 22, 7, 'metal');
      w.box(6, -10, -35, 7, 22, 7, 'metal');
      w.box(-7, -2, 6, 7, 15, 7, 'metal');
      w.box(-7, 15, 6, 7, 22, 7, 'white');
      w.box(-7, -10, -35, 7, 22, -34, 'metal');
      w.box(-7, 22, -35, 7, 23, 7, 'metal');
      w.exitElevator(0, 0, -29);
      booth(w, -6, 13, -15, '+x', 'bigode', booths);
      chamberSign(w, 5.97, 15, 1.5, -Math.PI / 2, 3, 'FOGO!', 'lançamento · momento · coragem');
      for (const z of [2, -10, -22]) w.light(0, 21.5, z, 90, 0xfff4e6, 45);
      w.strip(-6, 12.0, -2.04, 6, 12.03, -1.98, 0xffcc33, 1);
      return {
        spawn: [0, 12, 3.5, 0],
        booths,
        dinos: [{ s: 'ptero', scale: 0.6, orbit: { cx: 0, cz: -14, rx: 4, rz: 10, y: 16, speed: 5, bank: 0.3, bob: 0.6 } }],
        intro: [
          ['Bigode', 'Aqui a regra é a mesma do explosivo: velocidade que entra, velocidade que sai.'],
          ['Bigode', 'Vai até a beirada, põe um portal no chão logo abaixo dela e outro bem alto na parede atrás de você. Depois é só dar um passinho pra frente.'],
        ],
        hints: [{ after: 50, lines: [['Bigode', 'Vira pra trás e mira a parede branca lá no alto. Quanto mais alto você cair, mais longe você voa.']] }],
      };
    },
  },
  // ------------------------------------------------------------------ 4
  {
    id: 4,
    name: 'O Poço',
    who: 'Seu Tião',
    music: 'labTense',
    lesson: 'Use a queda do poço para atravessar o abismo.',
    build(w) {
      const booths = [];
      w.box(-12, -2, 3, 12, 0, 10, 'metal');
      w.box(-12, -10, -6, 12, 0, -3, 'metal');
      w.box(-12, -2, -3, -3, 0, 3, 'metal');
      w.box(3, -2, -3, 12, 0, 3, 'metal');
      w.box(-4, -44, -4, -3, -2, 4, 'rock');
      w.box(3, -44, -4, 4, -2, 4, 'rock');
      w.box(-3, -44, -4, 3, -2, -3, 'rock');
      w.box(-3, -44, 3, 3, -2, 4, 'rock');
      w.box(-3, -46, -3, 3, -40, 3, 'white'); // fundo do poço
      for (let y = -6; y > -40; y -= 6) w.strip(-2.98, y, -2.98, 2.98, y + 0.12, -2.92, 0xffd27a, 1.6);
      w.light(0, -36, 0, 30, 0xffd9a0, 20);
      w.light(0, -18, 0, 20, 0xffd9a0, 20);
      w.box(-12, -12, -22, 12, -10, -6, 'rock');
      w.hazard(-12, -10, -22, 12, -9.4, -6);
      w.box(-12, -12, -30, 12, 0, -22, 'white');
      w.box(-13, -12, -31, -12, 14, 11, 'metal');
      w.box(12, -12, -31, 13, 14, 11, 'metal');
      w.box(-13, -2, 10, 13, 8, 11, 'metal');
      w.box(-13, 8, 10, 13, 14, 11, 'white');
      w.box(-13, -12, -31, 13, 14, -30, 'metal');
      w.box(-13, 14, -31, 13, 15, 11, 'metal');
      w.exitElevator(0, 0, -27);
      booth(w, 12, 5, -12, '-x', 'tiao', booths);
      chamberSign(w, -11.97, 3, 6, Math.PI / 2, 4, 'O POÇO', 'queda livre · 40 metros');
      for (const z of [6, -8, -24]) w.light(0, 13.5, z, 70, 0xfff4e6, 40);
      return {
        spawn: [0, 0, 7, 0],
        booths,
        fossils: [{ x: -2.96, y: -24, z: 0, rotY: Math.PI / 2, len: 4.6 }],
        intro: [
          ['Seu Tião', 'Esse poço tem quarenta metros. Quarenta! Lá embaixo a gaiola chega a doze metros por segundo.'],
          ['Seu Tião', 'Você vai chegar mais rápido que a gaiola. Um portal lá no fundo, outro na parede branca do alto, e pula.'],
          ['Seu Tião', 'E repara no esqueleto na parede do poço. A paleontóloga jura que foi alguém que pôs ali de brincadeira.'],
        ],
        hints: [{ after: 55, lines: [['Seu Tião', 'O fundo do poço é branco. Mira lá embaixo. E o outro portal na parede branca atrás de você, em cima.']] }],
        stuck: { below: -30, lines: [['Seu Tião', 'Caiu sem portal, né? Segura que eu te puxo de volta no guincho.']] },
      };
    },
  },
  // ------------------------------------------------------------------ 5
  {
    id: 5,
    name: 'Calor',
    who: 'Marquinho',
    music: 'labTense',
    lesson: 'Leve a amostra até a ilha do meio sem tocar na rocha fundida.',
    heat: true,
    build(w) {
      const booths = [];
      w.box(-10, -4, -24, 10, -2, 8, 'rock');
      w.hazard(-10, -2, -24, 10, -1.4, 8);
      w.box(-10, -2, 0, 10, 0, 8, 'white');
      w.box(-3, -2, -12, 3, 0, -6, 'white');
      w.box(-10, -2, -24, 10, 0, -18, 'white');
      w.box(-11, -4, -25, -10, 10, 9, 'white');
      w.box(10, -4, -25, 11, 10, 9, 'white');
      w.box(-11, -4, 8, 11, 10, 9, 'metal');
      w.box(-11, 10, -25, 11, 11, 9, 'white');
      northWallWithExit(w, -10, 10, 10, -24, 'd1');
      w.button(0, 0, -9, 'd1');
      booth(w, 6, 5.5, 8, '-z', 'marquinho', booths);
      chamberSign(w, -9.97, 3, 4, Math.PI / 2, 5, 'CALOR', 'rocha fundida · ventilação');
      for (const z of [4, -9, -21]) w.light(0, 9.5, z, 40, 0xffe6cc, 28);
      return {
        spawn: [0, 0, 6, 0],
        cubes: [[5, 0, 3]],
        booths,
        fossils: [{ x: 6, y: -1.42, z: -15, rotX: -Math.PI / 2, rotZ: 0.5, len: 6 }],
        intro: [
          ['Marquinho', 'Aqui embaixo o chão é rocha fundida. Encostou, já era. Eu sou da segurança, então presta atenção.'],
          ['Marquinho', 'O botão que abre a porta tá na ilha do meio. Leva a amostra até lá pelos portais.'],
        ],
        hints: [{ after: 50, lines: [['Marquinho', 'Dá pra carregar a amostra através do portal. Um portal na parede branca daqui, outro no teto em cima da ilha.']] }],
      };
    },
  },
  // ------------------------------------------------------------------ 6
  {
    id: 6,
    name: 'Antípoda',
    who: 'Dona Cida',
    music: 'space',
    lesson: 'Abra a escotilha e atravesse a Terra.',
    final: true,
    build(w) {
      const booths = [];
      // sala A (Minas Gerais)
      w.box(-8, -2, 2, 8, 0, 8, 'white');
      w.box(-8, -2, -12, 8, 0, -2, 'white');
      w.box(-8, -2, -2, -2, 0, 2, 'white');
      w.box(2, -2, -2, 8, 0, 2, 'white');
      w.door('hatch', -2, -0.45, -2, 2, -0.02, 2, { axis: 'x', dist: 4.3 });
      w.box(-9, 0, -13, -8, 10, 9, 'white');
      w.box(8, 0, -13, 9, 6, 9, 'metal');
      w.box(8, 6, -13, 9, 10, 9, 'white');
      w.box(-9, 0, 8, 9, 10, 9, 'metal');
      w.box(-9, 0, -13, 9, 10, -12, 'metal');
      w.box(-9, 10, -13, 9, 11, 9, 'metal');
      w.box(5, 0, -12, 8, 6, -6, 'rock');
      w.button(-5, 0, -6, 'hatch');
      booth(w, -8, 4.5, 2, '+x', 'helena', booths);
      w.sign(0, 4.2, 7.97, Math.PI, [
        ['CÂMARA 06', 110, 150],
        ['ANTÍPODA', 76, 270, '#c0392b'],
        ['túnel de 160 m · gravidade que inverte', 40, 380, '#55575c', 'Arial, sans-serif'],
        ['LABORATÓRIO ANTÍPODA · NOVA LIMA (MG)', 30, 455, '#8a8c90', 'Arial, sans-serif'],
      ]);
      for (const [x, z] of [
        [-4, 4],
        [4, -8],
      ])
        w.light(x, 9.5, z, 45);
      // o túnel
      w.box(-3, -160, -3, -2, -2, 3, 'metal');
      w.box(2, -160, -3, 3, -2, 3, 'metal');
      w.box(-2, -160, -3, 2, -2, -2, 'metal');
      w.box(-2, -160, 2, 2, -2, 3, 'metal');
      for (let y = -6; y > -160; y -= 6) {
        const c = Math.abs(y + 80) < 4 ? 0xff4a3a : 0x6fc8ff;
        w.strip(-1.98, y, -1.98, -1.92, y + 0.3, 1.98, c, 2.2);
        w.strip(1.92, y, -1.98, 1.98, y + 0.3, 1.98, c, 2.2);
      }
      for (let y = -20; y > -160; y -= 35) w.light(0, y, 0, 25, 0x9fd8ff, 24);
      // sala B (do outro lado do mundo: tudo de cabeça para baixo)
      w.box(-9, -160, 2, 9, -158, 9, 'rock');
      w.box(-9, -160, -9, 9, -158, -2, 'rock');
      w.box(-9, -160, -2, -2, -158, 2, 'rock');
      w.box(2, -160, -2, 9, -158, 2, 'rock');
      w.box(-9, -170, -9, 9, -168, 9, 'white');
      w.box(-9, -168, -9, -8, -160, 9, 'white');
      w.box(8, -168, -9, 9, -160, 9, 'white');
      w.box(-8, -168, 8, 8, -160, 9, 'white');
      w.box(-8, -168, -9, 8, -160, -8, 'white');
      for (const [x, z] of [
        [-4, 4],
        [4, -4],
        [4, 4],
      ])
        w.light(x, -167.4, z, 40, 0x5fb0ff, 22);
      w.sign(0, -163.2, 7.97, Math.PI, [
        ['VOCÊ CHEGOU', 100, 150],
        ['AO OUTRO LADO', 76, 260, '#1565c0'],
        ['Mar das Filipinas · 19,99° N, 136,15° L', 40, 370, '#55575c', 'Arial, sans-serif'],
        ['(aqui, "para baixo" é na direção de Minas)', 32, 445, '#8a8c90', 'Arial, sans-serif'],
      ], 3.2, 1.6, Math.PI);
      const exitT = w.exitElevator(0, -160, -5.5, true);
      exitT.final = true;
      return {
        spawn: [0, 0, 6, 0],
        cubes: [[6.5, 6, -9]],
        booths,
        npcs: [{ who: 'cida', x: 4.5, y: -160, z: 4.5, rotY: -2.4, flipped: true }],
        dinos: [{ s: 'trice', scale: 0.28, x: -4.5, y: -160, z: 4, rotY: 2.3, flipped: true }],
        portalsAllowed: (p) => p.y > -1,
        gravityAt(p, out) {
          const inTube = Math.abs(p.x) < 2.6 && Math.abs(p.z) < 2.6;
          if (p.y >= 0 || (!inTube && p.y > -100)) return out.set(0, -G, 0);
          if (p.y <= -160) return out.set(0, G, 0);
          if (inTube) return out.set(0, (-G * (p.y + 80)) / 80, 0);
          return out.set(0, G, 0);
        },
        tube: { top: 0, bottom: -160, center: -80 },
        intro: [
          ['Helena', 'Última câmara. Embaixo dessa escotilha tem um túnel reto, sem ar.'],
          ['Helena', 'É uma maquete do túnel até o outro lado do mundo: a gravidade diminui até zero no meio e depois inverte.'],
          ['Helena', 'A amostra em cima do pilar abre a escotilha. Depois é só pular. Boa viagem.'],
        ],
        hints: [{ after: 50, lines: [['Helena', 'Igual à câmara do itabirito: portal na parede branca acima do pilar.']] }],
      };
    },
  },
];

// bateria clássica: os testes do gênero refeitos no laboratório
LEVELS.push(...CLASSIC);
// desafios hardcore: salas enormes, plataformas diagonais, pistões
LEVELS.push(...HARD);
// série Momento: arremessos encadeados com portais abertos em pleno voo
LEVELS.push(...MOMENTUM);
// mapa livre de exploração (com torretas), também jogável em grupo
LEVELS.push(BIG_MAP);

export const SPEAKER_NPC = {
  Helena: 'helena',
  Luciana: 'luciana',
  Kelly: 'kelly',
  Bigode: 'bigode',
  'Seu Tião': 'tiao',
  Rodrigo: 'rodrigo',
  Marquinho: 'marquinho',
  'Dona Cida': 'cida',
};

export const DEFAULT_GRAVITY = (p, out = new THREE.Vector3()) => out.set(0, -G, 0);
