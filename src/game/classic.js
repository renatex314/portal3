// Bateria clássica: a sequência de testes que todo laboratório de portais do
// gênero faz — do primeiro botão com cubo até a fornalha — refeita aqui
// embaixo de Nova Lima. Os quebra-cabeças seguem a progressão dos testes
// clássicos (sem arma → portal que muda de lugar → arma só com o azul →
// celas de vidro → cubo pelo teto → dois botões → bola de energia →
// elevador de energia → voo → arma completa → torretas → a amostra rosa),
// com cenário, nomes e falas próprios.
//
// Coordenadas em metros; chão em y = 0; o norte (saída) fica em −z.

import { northWallWithExit } from './levels.js';
import { portalGun } from './models.js';

function sign(w, x, y, z, rotY, code, name, line2) {
  w.sign(x, y, z, rotY, [
    [`TESTE ${code}`, 110, 150],
    [name, 76, 270, '#1565c0'],
    [line2, 40, 380, '#55575c', 'Arial, sans-serif'],
    ['BATERIA CLÁSSICA · LABORATÓRIO ANTÍPODA', 30, 455, '#8a8c90', 'Arial, sans-serif'],
  ]);
}

/** sala retangular: chão, teto e quatro paredes de 1 m (material por lado; false = sem parede) */
function room(w, x0, x1, z0, z1, h, m = {}) {
  w.box(x0, -1, z0, x1, 0, z1, m.floor ?? 'white');
  w.box(x0 - 1, h, z0 - 1, x1 + 1, h + 1, z1 + 1, m.ceil ?? 'metal');
  if (m.w !== false) w.box(x0 - 1, -1, z0 - 1, x0, h, z1 + 1, m.w ?? 'white');
  if (m.e !== false) w.box(x1, -1, z0 - 1, x1 + 1, h, z1 + 1, m.e ?? 'white');
  if (m.n !== false) w.box(x0, -1, z0 - 1, x1, h, z0, m.n ?? 'white');
  if (m.s !== false) w.box(x0, -1, z1, x1, h, z1 + 1, m.s ?? 'white');
}

/** parede com janela de vidro (base de metal, vidro no meio, metal em cima) ao longo de x ou z */
function glassWall(w, axis, a0, a1, c0, c1, h, glassTo = 4) {
  const B = (y0, y1, mat) => (axis === 'x' ? w.box(a0, y0, c0, a1, y1, c1, mat) : w.box(c0, y0, a0, c1, y1, a1, mat));
  B(-1, 1, 'metal');
  B(1, glassTo, 'glass');
  if (glassTo < h) B(glassTo, h, 'metal');
}

const lights = (w, pts, y, k = 45) => pts.forEach(([x, z]) => w.light(x, y, z, k));

const C = (n, def) => ({ ...def, id: 100 + n, n, code: `C${String(n).padStart(2, '0')}`, series: 'classic', music: def.music ?? 'doc' });

export const CLASSIC = [
  // ------------------------------------------------------------------ C00
  C(0, {
    name: 'Despertar',
    who: 'Helena',
    lesson: 'Ponha a amostra no botão para abrir a porta.',
    build(w) {
      room(w, -6, 6, -14, 4, 6, { n: false, w: 'metal', e: 'metal', s: 'metal' });
      northWallWithExit(w, -6, 6, 6, -14, 'd0');
      const [dx, dy, dz] = w.dispenser(3, 6, -3);
      w.button(-3, 0, -8, 'd0');
      w.fizzler(-1.5, 0, -15.35, 1.5, 3.5, -15.15);
      sign(w, -5.97, 3, -1, Math.PI / 2, 'C00', 'DESPERTAR', 'botão · amostra · grade');
      lights(w, [[0, 1], [0, -9]], 5.5, 40);
      return {
        spawn: [0, 0, 2, 0],
        gun: 'none',
        cubes: [[dx, dy - 0.3, dz]],
        intro: [
          ['Helena', 'Bom dia. Antes de mexer na arma, todo mundo passa pela bateria clássica. É tradição de laboratório.'],
          ['Helena', 'Pega a amostra que caiu do tubo com a tecla E e põe no botão vermelho. A porta abre.'],
        ],
        hints: [
          { after: 35, lines: [['Helena', 'A grade azul na saída desintegra o que você estiver carregando. A amostra não vai junto, só você.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ C01
  C(1, {
    name: 'Portal Automático',
    who: 'Helena',
    lesson: 'Sem arma: entre no portal azul quando o laranja estiver no lugar certo.',
    build(w) {
      w.box(-6, -1, -14, 14, 0, 4, 'metal');
      w.box(-7, 6, -15, 15, 7, 5, 'metal');
      // sala A (onde você começa)
      w.box(-7, -1, -8, -6, 6, 4, 'white');
      w.box(-7, -1, 4, 15, 6, 5, 'white');
      glassWall(w, 'x', 6, 8, -6, 4, 6); // A | B
      glassWall(w, 'z', -8, -6, -6, 6, 6); // A | C
      // sala B (a amostra)
      w.box(8, -1, -6, 15, 6, -4, 'metal');
      w.box(8, -1, 2, 15, 6, 4, 'metal');
      w.box(14, -1, -4, 15, 6, 2, 'white');
      // sala C (botão e saída)
      w.box(-7, -1, -15, -6, 6, -8, 'white');
      w.box(6, -1, -15, 7, 6, -8, 'metal');
      northWallWithExit(w, -6, 6, 6, -14, 'd1');
      w.button(2, 0, -11, 'd1');
      sign(w, -2, 3.2, 3.97, Math.PI, 'C01', 'PORTAL AUTOMÁTICO', 'o laranja troca de lugar sozinho');
      lights(w, [[0, -1], [11, -1], [0, -11]], 5.5, 35);
      return {
        spawn: [0, 0, 2, 0],
        gun: 'none',
        cubes: [[11, 0, -1]],
        portals: [{ which: 'blue', c: [-6, 1.09, -1], n: [1, 0, 0], u: [0, 1, 0] }],
        cycle: {
          which: 'orange',
          every: 4,
          spots: [
            { c: [14, 1.09, -1], n: [-1, 0, 0] },
            { c: [2, 1.09, 4], n: [0, 0, -1] },
            { c: [-6, 1.09, -11], n: [1, 0, 0] },
          ],
        },
        intro: [
          ['Helena', 'Ainda sem arma. O portal azul na parede é fixo; o laranja muda de sala a cada quatro segundos.'],
          ['Helena', 'A amostra está na sala da direita, o botão na sala do fundo. Entra no azul na hora certa.'],
        ],
        hints: [{ after: 60, lines: [['Helena', 'Dá para atravessar segurando a amostra. Espera o laranja aparecer na sala do botão.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ C02
  C(2, {
    name: 'A Arma',
    who: 'Helena',
    lesson: 'Pegue a arma e chegue à sala de saída pelo portal laranja fixo.',
    build(w) {
      room(w, -5, 5, -2, 8, 6, { n: false });
      glassWall(w, 'z', -4, -2, -5, 5, 6);
      // sala B (fechada, só se chega pelo portal)
      w.box(-6, -1, -14, -5, 6, -4, 'white');
      w.box(5, -1, -14, 6, 6, -4, 'metal');
      w.box(-5, -1, -14, 5, 0, -4, 'metal');
      w.box(-6, 6, -15, 6, 7, -2, 'metal');
      northWallWithExit(w, -5, 5, 6, -14, null);
      w.fizzler(-1.5, 0, -15.35, 1.5, 3.5, -15.15);
      w.pedestal(0, 0, 3, 'blue', portalGun());
      sign(w, 4.97, 3, 5, -Math.PI / 2, 'C02', 'A ARMA', 'portal azul · portal fixo');
      lights(w, [[0, 3], [0, -9]], 5.5, 40);
      return {
        spawn: [0, 0, 7, 0],
        gun: 'none',
        portals: [{ which: 'orange', c: [-5, 1.09, -9], n: [1, 0, 0], u: [0, 1, 0] }],
        intro: [
          ['Helena', 'Ali no pedestal: a arma de portais. Por enquanto ela só abre o azul.'],
          ['Helena', 'O laranja já está aceso do outro lado do vidro. Põe o azul numa parede branca daqui e passa.'],
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ C03
  C(3, {
    name: 'Celas de Vidro',
    who: 'Luciana',
    lesson: 'Busque a amostra num poço e leve até o botão no outro.',
    build(w) {
      // salão no meio (chão grosso) e dois poços de 3 m dos lados
      w.box(-6, -4, -6, 6, 0, 6, 'metal');
      w.box(-12, -4, -6, -6, -3, 6, 'white');
      w.box(6, -4, -6, 12, -3, 6, 'white');
      // vidro com uma fresta (0,9–2,2 m): dá para ver e atirar no poço, não para passar
      for (const [a, b] of [
        [-6, -5.7],
        [5.7, 6],
      ]) {
        w.box(a, 0, -6, b, 0.9, 6, 'glass');
        w.box(a, 2.2, -6, b, 7, 6, 'glass');
      }
      w.box(-13, -4, -7, -12, 7, 7, 'metal');
      w.box(12, -4, -7, 13, 7, 7, 'metal');
      w.box(-13, -4, 6, -6, 7, 7, 'metal');
      w.box(-6, -4, 6, 6, 7, 7, 'white');
      w.box(6, -4, 6, 13, 7, 7, 'metal');
      w.box(-13, -4, -7, -6, 7, -6, 'metal');
      w.box(6, -4, -7, 13, 7, -6, 'metal');
      w.box(-13, 7, -7, 13, 8, 7, 'metal');
      northWallWithExit(w, -6, 6, 7, -6, 'd1');
      w.button(9, -3, 0, 'd1');
      sign(w, -5.6, 2.6, -5.97, 0, 'C03', 'CELAS DE VIDRO', 'só o azul · poços · amostra');
      lights(w, [[0, 0], [-9, 0], [9, 0]], 6.5, 45);
      return {
        spawn: [0, 0, 4, 0],
        gun: 'blue',
        cubes: [[-9, -3, 0]],
        portals: [{ which: 'orange', c: [0, 1.09, 6], n: [0, 0, -1], u: [0, 1, 0] }],
        intro: [
          ['Luciana', 'Dois poços de vidro: a amostra está no da esquerda, o botão no da direita.'],
          ['Luciana', 'O laranja fixo está na parede de trás. Mira o azul no fundo do poço e entra no laranja.'],
        ],
        hints: [
          { after: 40, lines: [['Luciana', 'Chega bem perto do vidro e mira pela fresta, lá no fundo do poço.']] },
          { after: 80, lines: [['Luciana', 'Pra voltar do poço é só pisar no azul, lá embaixo mesmo. Você cai e sai pela parede.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ C04
  C(4, {
    name: 'Pelo Teto',
    who: 'Bigode',
    lesson: 'O botão está numa ilha. Faça a amostra cair do teto em cima dele.',
    heat: true,
    build(w) {
      w.box(-7, -2, -3, 7, 0, 6, 'white');
      w.box(-7, -2, -12, 7, 0, -9, 'white');
      w.box(-7, -2, -9, -3, 0, -3, 'white');
      w.box(3, -2, -9, 7, 0, -3, 'white');
      w.box(-3, -4, -9, 3, -2, -3, 'rock');
      w.hazard(-3, -2, -9, 3, -1.4, -3);
      w.box(-1.2, -2, -7.2, 1.2, 0, -4.8, 'metal');
      w.button(0, 0, -6, 'd1');
      w.box(-8, -4, -13, -7, 8, 7, 'metal');
      w.box(7, -4, -13, 8, 8, 7, 'metal');
      w.box(-8, -4, 6, 8, 8, 7, 'metal');
      w.box(-8, 8, -13, 8, 9, -9, 'metal');
      w.box(-8, 8, -3, 8, 9, 7, 'metal');
      w.box(-8, 8, -9, -3, 9, -3, 'metal');
      w.box(3, 8, -9, 8, 9, -3, 'metal');
      w.box(-3, 8, -9, 3, 9, -3, 'white');
      northWallWithExit(w, -7, 7, 8, -12, 'd1');
      // gaiola de vidro com a amostra
      w.box(-6.5, 0, 0.5, -3.5, 1.5, 0.7, 'glass');
      w.box(-6.5, 0, 3.3, -3.5, 1.5, 3.5, 'glass');
      w.box(-6.5, 0, 0.7, -6.3, 1.5, 3.3, 'glass');
      w.box(-3.7, 0, 0.7, -3.5, 1.5, 3.3, 'glass');
      sign(w, 6.97, 3.2, 2, -Math.PI / 2, 'C04', 'PELO TETO', 'gravidade · amostra · ilha');
      lights(w, [[-4, 2], [4, -6], [-4, -10]], 7.5, 45);
      w.trigger(-1.2, 0, -7.2, 1.2, 2, -4.8, { lines: [['Bigode', 'Ficou ilhado, né? Aperta R que eu te tiro daí.']] });
      return {
        spawn: [3, 0, 4, 0],
        gun: 'blue',
        cubes: [[-5, 0, 2]],
        portals: [{ which: 'orange', c: [0, 8, -6], n: [0, -1, 0], u: [0, 0, -1] }],
        intro: [
          ['Bigode', 'O botão tá na ilha, no meio da rocha fundida. O laranja tá no teto bem em cima dele.'],
          ['Bigode', 'A amostra tá presa naquela gaiola de vidro. Pensa no que cai.'],
        ],
        hints: [{ after: 50, lines: [['Bigode', 'Põe o azul no chão da gaiola, embaixo da amostra.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ C05
  C(5, {
    name: 'Dois Botões',
    who: 'Kelly',
    lesson: 'A porta só abre com os dois botões apertados.',
    build(w) {
      room(w, -8, 8, -12, 6, 9, { n: false, e: 'white', w: 'white', s: 'white' });
      northWallWithExit(w, -8, 8, 9, -12, 'd1');
      w.box(4, 0, -2, 8, 5, 4, 'metal'); // plataforma alta
      w.button(-4, 0, -6, 'd1');
      w.button(4, 0, -7, 'd1');
      sign(w, -7.97, 3, 0, Math.PI / 2, 'C05', 'DOIS BOTÕES', 'duas amostras · uma plataforma');
      lights(w, [[0, 2], [0, -8], [6, 1]], 8.5, 50);
      return {
        spawn: [-2, 0, 4, 0],
        gun: 'blue',
        cubes: [
          [-6, 0, 3],
          [6, 5, 1],
        ],
        portals: [{ which: 'orange', c: [8, 6.09, 1], n: [-1, 0, 0], u: [0, 1, 0] }],
        intro: [
          ['Kelly', 'Dois botões, duas amostras. Uma tá aqui no chão, a outra lá em cima daquela plataforma.'],
          ['Kelly', 'O laranja tá na parede, em cima da plataforma. Você sabe o que fazer.'],
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ C06
  C(6, {
    name: 'Bola de Energia',
    who: 'Rodrigo',
    lesson: 'Leve a bola de energia até o receptor. Não encoste nela.',
    build(w) {
      room(w, -8, 8, -10, 6, 7, { n: false, w: 'metal', s: 'metal', e: 'white' });
      northWallWithExit(w, -8, 8, 7, -10, 'd1');
      w.launcher(-8, 1.09, -2, [1, 0, 0]);
      w.catcher(-5, 4, 6, [0, 0, -1], 'd1');
      w.box(-8, 0, -1.2, 8, 0.05, -1.1, 'stripe', { solid: false });
      w.box(-8, 0, -2.9, 8, 0.05, -2.8, 'stripe', { solid: false });
      sign(w, 7.97, 3.5, 3, -Math.PI / 2, 'C06', 'BOLA DE ENERGIA', 'quica · atravessa portal · queima');
      lights(w, [[0, 2], [0, -6]], 6.5, 45);
      return {
        spawn: [0, 0, 4, -Math.PI / 2],
        gun: 'blue',
        portals: [{ which: 'orange', c: [-5, 4, -10], n: [0, 0, 1], u: [0, 1, 0] }],
        intro: [
          ['Rodrigo', 'Isso aí é uma bola de energia. Quica em tudo e passa por portal. Encostou, queima.'],
          ['Rodrigo', 'O receptor tá lá no alto, na parede de trás. O laranja fixo aponta pra ele.'],
        ],
        hints: [{ after: 45, lines: [['Rodrigo', 'Põe o azul na parede onde a bola bate, bem na altura dela.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ C07
  C(7, {
    name: 'Elevador de Energia',
    who: 'Rodrigo',
    lesson: 'Ligue a plataforma com a bola de energia e atravesse a rocha fundida.',
    heat: true,
    build(w) {
      w.box(-7, -2, -2, 7, 0, 6, 'white');
      w.box(-7, -2, -20, 7, 0, -14, 'white');
      w.box(-7, -4, -14, 7, -2, -2, 'rock');
      w.hazard(-7, -2, -14, 7, -1.4, -2);
      w.platform('lift', -1.5, -0.6, -5, 1.5, 0, -2, { axis: 'z', dist: -9, speed: 1.5, loop: 2 });
      w.box(-8, -4, -2, -7, 8, 6, 'white');
      w.box(-8, -4, -21, -7, 8, -2, 'metal');
      w.box(7, -4, -21, 8, 8, 7, 'metal');
      w.box(-8, -4, 6, 8, 8, 7, 'metal');
      w.box(-8, 8, -21, 8, 9, 7, 'metal');
      northWallWithExit(w, -7, 7, 8, -20, null);
      w.launcher(-4, 8, 2.5, [0, -1, 0]);
      w.catcher(7, 2.4, -0.5, [-1, 0, 0], 'lift');
      sign(w, 6.97, 4.2, 3.5, -Math.PI / 2, 'C07', 'ELEVADOR DE ENERGIA', 'bola · receptor · plataforma');
      lights(w, [[0, 2], [0, -8], [0, -17]], 7.5, 50);
      return {
        spawn: [3, 0, 4, 0],
        gun: 'blue',
        portals: [{ which: 'orange', c: [-7, 2.4, -0.5], n: [1, 0, 0], u: [0, 1, 0] }],
        intro: [
          ['Rodrigo', 'Essa bola cai do teto e quica no chão. A plataforma só anda com energia no receptor.'],
          ['Rodrigo', 'Azul no chão, onde a bola bate. Ela sai do laranja e vai direto no receptor.'],
        ],
        hints: [{ after: 50, lines: [['Rodrigo', 'Depois que ligar, a plataforma vai e volta. Sobe nela quando chegar perto.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ C08
  C(8, {
    name: 'Voo',
    who: 'Bigode',
    lesson: 'Caia de bem alto no portal azul e voe por cima da rocha fundida.',
    heat: true,
    build(w) {
      w.box(-7, -1, 4, 7, 12, 10, 'metal'); // torre de saída
      w.box(-2, 4.6, 3.8, 2, 7.6, 4, 'white'); // placa branca na face da torre
      w.box(-7, -2, -4, 7, 0, 3.8, 'white'); // chão de baixo
      w.box(-7, -6, -11, 7, -4, -4, 'rock');
      w.hazard(-7, -4, -11, 7, -3.4, -4);
      w.box(-7, -2, -24, 7, 0, -11, 'white'); // chegada
      w.box(-8, -6, -25, -7, 16, 11, 'metal');
      w.box(7, -6, -25, 8, 16, 11, 'metal');
      w.box(-8, -6, 10, 8, 16, 11, 'metal');
      w.box(-8, 16, -25, 8, 17, 11, 'metal');
      northWallWithExit(w, -7, 7, 16, -24, null);
      // elevador para voltar ao alto da torre
      w.platform('volta', 4.6, -0.6, 1.4, 6.6, 0, 3.6, { axis: 'y', dist: 12, speed: 3, loop: 2, always: true });
      sign(w, -6.97, 14, 6, Math.PI / 2, 'C08', 'VOO', 'o que entra rápido sai rápido');
      lights(w, [[0, 7], [0, -2], [0, -9], [0, -18]], 15.5, 70);
      return {
        spawn: [0, 12, 8, 0],
        gun: 'blue',
        portals: [{ which: 'orange', c: [0, 6, 3.8], n: [0, 0, -1], u: [0, 1, 0] }],
        intro: [
          ['Bigode', 'Daqui de cima até lá embaixo são doze metros. Lembra da regra: velocidade que entra, velocidade que sai.'],
          ['Bigode', 'O laranja tá na frente da torre, olhando pro outro lado. Azul no chão lá embaixo, perto da torre, e pula.'],
        ],
        hints: [{ after: 50, lines: [['Bigode', 'Põe o azul bem pertinho da torre e desce devagar da beirada, sem correr.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ C09
  C(9, {
    name: 'Arma Completa',
    who: 'Helena',
    lesson: 'Pegue a melhoria da arma e leve a amostra até o botão lá em cima.',
    build(w) {
      room(w, -8, 8, -14, 6, 10, { n: false });
      w.box(-8, -1, -14, 8, 6, -8, 'metal'); // patamar alto
      northWallWithExit(w, -8, 8, 10, -14, 'd1', 6);
      w.button(4, 6, -11, 'd1');
      w.pedestal(0, 0, 2, 'both', portalGun());
      sign(w, -7.97, 3, 1, Math.PI / 2, 'C09', 'ARMA COMPLETA', 'azul e laranja · patamar');
      lights(w, [[0, 2], [0, -11]], 9.5, 55);
      return {
        spawn: [0, 0, 5, 0],
        gun: 'blue',
        cubes: [[-5, 0, 0]],
        intro: [
          ['Helena', 'Agora sim: a melhoria da arma. Com ela você abre os dois portais, onde quiser.'],
          ['Helena', 'A amostra está aqui embaixo, o botão e a saída lá em cima do patamar.'],
        ],
        hints: [{ after: 50, lines: [['Helena', 'Um portal na parede lá em cima, acima do patamar; o outro aqui embaixo. Leva a amostra junto.']] }],
      };
    },
  }),

  // ------------------------------------------------------------------ C10
  C(10, {
    name: 'Torretas',
    who: 'Marquinho',
    lesson: 'Passe pelas torretas: use as amostras como escudo ou derrube-as.',
    music: 'descent',
    build(w) {
      room(w, -8, 8, -24, 6, 8, { n: false, w: 'white', e: 'white', s: 'metal', ceil: 'white' });
      northWallWithExit(w, -8, 8, 8, -24, null);
      // antessala: parede com janela de vidro (dá para ver o salão; as torretas
      // não enxergam através) e a passagem deslocada para a direita, fora da mira delas
      w.box(-8, -1, -1, -6, 8, 0, 'metal');
      w.box(-6, -1, -1, 2, 1, 0, 'metal');
      w.box(-6, 1, -1, 2, 2.6, 0, 'glass');
      w.box(-6, 2.6, -1, 2, 8, 0, 'metal');
      w.box(2, -1, -1, 5, 8, 0, 'metal');
      w.box(5, 3, -1, 8, 8, 0, 'metal');
      // anteparo logo depois da passagem (entrada em L): de dentro da antessala não se vê o salão
      w.box(3.5, 0, -3.4, 8, 2.6, -3, 'metal');
      // pilares altos para se esconder no caminho
      for (const [x, z] of [
        [5.5, -6.5],
        [-1, -7.5],
        [4, -11],
        [-4.5, -13],
      ])
        w.box(x - 0.7, 0, z - 0.7, x + 0.7, 2.6, z + 0.7, 'metal');
      sign(w, 7.97, 3, 3, -Math.PI / 2, 'C10', 'TORRETAS', 'mira laser · escudo · queda');
      lights(w, [[0, 3], [0, -9], [0, -19]], 7.5, 50);
      return {
        spawn: [0, 0, 4, 0],
        cubes: [
          [-5, 0, 2],
          [3, 0, 2.5],
        ],
        turrets: [
          [-4, 0, -18, 0],
          [0, 0, -20, 0],
          [4, 0, -18, 0],
        ],
        intro: [
          ['Marquinho', 'Agora é comigo. Três torretas de segurança guardando a saída. Olha pela janela antes de entrar.'],
          ['Marquinho', 'Amostra na frente vira escudo. Portal embaixo delas, elas caem. Empurrão por trás, elas tombam.'],
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ C11
  C(11, {
    name: 'A Amostra Rosa',
    who: 'Dona Cida',
    lesson: 'Leve a amostra rosa até a fornalha no fim do teste.',
    build(w) {
      // R1 + R2 (uma sala comprida) com um degrau de 1,6 m no fundo
      room(w, -6, 6, -16, 6, 8, { n: false });
      const [dx, dy, dz] = w.dispenser(0, 8, 2);
      w.box(-6, 0, -17, 6, 1.6, -10, 'metal');
      w.button(3, 1.6, -13, 'b1');
      // parede norte do degrau com porta para a fornalha (R3)
      w.box(-7, 1.6, -17, -1.5, 8, -16, 'white');
      w.box(1.5, 1.6, -17, 7, 8, -16, 'white');
      w.box(-1.5, 5.1, -17, 1.5, 8, -16, 'metal');
      w.door('b1', -1.5, 1.6, -16.3, 1.5, 5.1, -16.02);
      // R3: sala da fornalha (piso no mesmo nível do degrau, com o buraco do forno)
      w.box(-6, 0, -28, 2, 1.6, -17, 'metal');
      w.box(5, 0, -28, 6, 1.6, -17, 'metal');
      w.box(2, 0, -28, 5, 1.6, -24, 'metal');
      w.box(2, 0, -21, 5, 1.6, -17, 'metal');
      w.box(2, -2, -24, 5, -1, -21, 'rock');
      w.box(-7, 0, -29, -6, 8, -17, 'white');
      w.box(6, 0, -29, 7, 8, -17, 'white');
      w.box(-7, 8, -29, 7, 9, -16, 'metal');
      northWallWithExit(w, -6, 6, 8, -28, 'exit', 1.6);
      // fornalha: o buraco no chão de R3
      w.incinerator(2.05, -1, -23.95, 4.95, 0.9, -21.05, 'exit');
      sign(w, 5.97, 3.5, 0, -Math.PI / 2, 'C11', 'A AMOSTRA ROSA', 'cuide bem dela até o fim');
      lights(w, [[0, 2], [0, -12], [0, -23]], 7.5, 50);
      return {
        spawn: [0, 0, 5, 0],
        cubes: [[dx, dy - 0.3, dz, { special: true }]],
        intro: [
          ['Dona Cida', 'Essa amostra rosa é de quartzo, achada lá no fundo da mina. Trata ela com carinho, viu?'],
          ['Dona Cida', 'No fim do teste ela vai pro forno. Regra do laboratório, não fui eu que inventei.'],
        ],
        hints: [
          { after: 40, lines: [['Dona Cida', 'O degrau é alto. Sobe em cima da amostra que dá.']] },
          { after: 110, lines: [['Dona Cida', 'A porta só fica aberta com a amostra no botão. Enquanto ela tá aberta, põe um portal lá dentro.']] },
        ],
      };
    },
  }),
];
