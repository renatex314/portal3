// Série Momento: testes enormes resolvidos com momento. Painéis diagonais de
// concreto claro (aceitam portal) arremessam você por cima da rocha fundida —
// e o próximo par de portais tem de ser aberto EM PLENO VOO: grades de
// desintegração no meio do caminho apagam os portais e barram os tiros, então
// não dá para deixar nada pronto. O que entra rápido sai rápido: a velocidade
// da queda vira o arremesso; cair de mais alto (ou numa queda infinita entre
// dois portais) é o que dá alcance.
//
// Coordenadas em metros; o chão "de referência" é y = 0 e a rocha fundida fica
// em y = −4. Ângulos dos painéis: a normal da face é para onde eles atiram.

import { lava, pillar, lamps } from './hard.js';

export const M = (n, def) => ({ ...def, id: 300 + n, n, code: `M${String(n + 1).padStart(2, '0')}`, series: 'momentum', music: def.music ?? 'labEpic', heat: def.heat ?? false });

export const D = Math.SQRT1_2;

export function sign(w, x, y, z, rotY, code, name, line2) {
  w.sign(x, y, z, rotY, [
    [`MOMENTO ${code}`, 104, 150],
    [name, 76, 270, '#7b1fa2'],
    [line2, 40, 380, '#55575c', 'Arial, sans-serif'],
    ['SÉRIE MOMENTO · LABORATÓRIO ANTÍPODA', 30, 455, '#8a8c90', 'Arial, sans-serif'],
  ]);
}

/** paredes de metal em volta de um retângulo (sem chão), do y0 ao teto */
export function walls(w, x0, x1, z0, z1, y0, top, open = {}) {
  if (!open.w) w.box(x0 - 1, y0, z0 - 1, x0, top, z1 + 1, 'metal');
  if (!open.e) w.box(x1, y0, z0 - 1, x1 + 1, top, z1 + 1, 'metal');
  if (!open.s) w.box(x0, y0, z1, x1, top, z1 + 1, 'metal');
  if (!open.n) w.box(x0, y0, z0 - 1, x1, top, z0, 'metal');
}

/** poço de queda: torre de metal com um furo quadrado e o fundo de concreto claro (y = 0) */
export function dropShaft(w, cx, cz, top, { size = 3, wall = 2.5, base = -4 } = {}) {
  const h = size / 2;
  const o = h + wall;
  w.box(cx - o, base, cz - o, cx + o, top, cz - h, 'metal');
  w.box(cx - o, base, cz + h, cx + o, top, cz + o, 'metal');
  w.box(cx - o, base, cz - h, cx - h, top, cz + h, 'metal');
  w.box(cx + h, base, cz - h, cx + o, top, cz + h, 'metal');
  w.box(cx - h, base, cz - h, cx + h, 0, cz + h, 'white');
  // frisos acesos na boca do poço
  const c = 0xffcc33;
  w.strip(cx - h, top + 0.005, cz - h - 0.12, cx + h, top + 0.02, cz - h, c, 1.6);
  w.strip(cx - h, top + 0.005, cz + h, cx + h, top + 0.02, cz + h + 0.12, c, 1.6);
}

export const MOMENTUM = [
  // ------------------------------------------------------------------ M01
  M(0, {
    name: 'Arremesso em Cadeia',
    who: 'Bigode',
    lesson: 'Caia pelo poço, saia voando pelo painel e abra o próximo par de portais no ar — duas vezes.',
    build(w) {
      // salão A (norte) e salão B (leste), em L, sobre rocha fundida
      walls(w, -26, 26, -100, 16, -6, 50, { e: true });
      w.box(26, -6, -64, 27, 50, 17, 'metal'); // parede leste do salão A, até o salão B
      walls(w, 27, 140, -100, -64, -6, 50, { w: true });
      w.box(-27, 50, -101, 141, 51, 17, 'metal');
      lava(w, -26, 26, -100, 16, -4);
      lava(w, 26, 140, -100, -64, -4);

      // torre de partida com o poço de 34 m
      dropShaft(w, 8, -27, 34, { size: 8, wall: 2 });
      // 1º painel: atira para o norte, a 45°
      w.panel([0, 2.5, -14], [0, D, -D], { w: 5, h: 5, stand: -4 });
      // grade 1: apaga os portais de quem passa e barra os tiros
      w.fizzler(-26, -4, -40.1, 26, 50, -39.9);
      // pega-voo do salão A (de frente para quem vem) e o painel que vira para o leste
      w.panel([0, 2.5, -82], [0, D, D], { w: 6, h: 7, stand: -4, color: 0xffb03a });
      w.panel([-8, 2.5, -90], [D, D, 0], { w: 5, h: 5, stand: -4 });
      // grade 2, no salão B
      w.fizzler(31.9, -4, -100, 32.1, 50, -64);
      w.panel([60, 2.5, -90], [-D, D, 0], { w: 6, h: 7, stand: -4, color: 0xffb03a });
      // último painel: quase deitado (70°), joga para cima da plataforma de saída
      w.panel([66, 2.5, -72], [0.342, 0.94, 0], { w: 5, h: 5, stand: -4 });
      pillar(w, 92, -84, 118, -64, 26);
      w.exitElevator(110, 26, -74);

      sign(w, 25.97, 40, -18, -Math.PI / 2, 'M01', 'ARREMESSO EM CADEIA', 'portais em pleno voo · duas grades');
      lamps(w, [
        [0, 46, 0],
        [0, 46, -30],
        [0, 46, -60],
        [0, 46, -88],
        [40, 46, -82],
        [80, 46, -82],
        [112, 46, -74],
      ], 520, 110);
      return {
        spawn: [8, 34, -22, 0.6],
        gun: 'both',
        dinos: [{ s: 'ptero', scale: 1.2, orbit: { cx: 0, cz: -50, rx: 10, rz: 36, y: 38, speed: 9, bank: 0.35, bob: 1 } }],
        intro: [
          ['Bigode', 'Lá embaixo do poço o chão é claro. Portal lá, outro no painel inclinado ali na frente, e pula no poço.'],
          ['Bigode', 'Você sai voando a noventa por hora. A grade no meio do salão apaga seus portais e não deixa atirar através dela.'],
          ['Bigode', 'Então é no ar: passou da grade, um portal no painel laranja onde você vai cair e outro no painel que te joga pro leste.'],
        ],
        hints: [
          { after: 60, lines: [['Bigode', 'Segura o botão do meio pro tempo lento logo depois da grade. Laranja onde vai cair, azul no próximo — ou o contrário, tanto faz.']] },
          { after: 150, lines: [['Bigode', 'No salão do leste é igual, só que a grade está mais perto. O último painel é deitado: ele te joga pra cima da plataforma.']] },
        ],
      };
    },
  }),
  // ------------------------------------------------------------------ M02
  M(1, {
    name: 'Queda Infinita',
    who: 'Seu Tião',
    lesson: 'Ganhe velocidade caindo entre o chão e o teto. Caindo a 115 km/h, abra o portal no painel lá fora.',
    build(w) {
      walls(w, -130, 12, -40, 40, -6, 62);
      w.box(-131, 62, -41, 13, 63, 41, 'metal');
      lava(w, -130, 12, -40, 40, -4);
      // câmara da queda: chão e teto claros, janela aberta para o norte
      w.box(-4, -4, -4, 4, 0, 4, 'white');
      w.box(-4, 24, -4, 4, 25, 4, 'white');
      w.box(-5, -4, -5, -4, 25, 5, 'metal');
      w.box(4, -4, -5, 5, 25, 5, 'metal');
      w.box(-4, -4, 4, 4, 25, 5, 'metal');
      w.box(-4, -4, -5, 4, 1, -4, 'metal');
      w.box(-4, 22, -5, 4, 25, -4, 'metal');
      w.box(-4, 11, 2.4, 4, 12, 4, 'metal'); // beiral de partida
      w.light(3.3, 19, 3.3, 45, 0xfff4e6, 30);
      // painel lá fora: atira para o oeste
      w.panel([0, 2.5, -16], [-D, D, 0], { w: 5, h: 5, stand: -4 });
      // duas grades no caminho
      w.fizzler(-25.1, -4, -40, -24.9, 62, 40);
      w.fizzler(-70.1, -4, -40, -69.9, 62, 40);
      // pega-voo e o painel quase em pé que joga para a plataforma alta
      w.panel([-104, 2.5, -16], [D, D, 0], { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([-113, 2.5, -16], [0, 0.966, 0.259], { w: 5, h: 5, stand: -4 });
      pillar(w, -122, 14, -104, 32, 40);
      w.exitElevator(-113, 40, 26);
      sign(w, -4.03, 18, 0, -Math.PI / 2, 'M02', 'QUEDA INFINITA', 'chão + teto = velocidade');
      lamps(w, [
        [0, 58, 0],
        [-30, 58, -10],
        [-60, 58, -10],
        [-90, 58, -10],
        [-113, 58, 20],
      ], 560, 120);
      return {
        spawn: [0, 12, 3.2, 0],
        gun: 'both',
        dinos: [{ s: 'ptero', scale: 1.3, orbit: { cx: -60, cz: 5, rx: 40, rz: 20, y: 48, speed: 10, bank: 0.35, bob: 1.5 } }],
        intro: [
          ['Seu Tião', 'Daqui até a plataforma lá do outro lado são mais de cem metros. Só chega quem estiver a toda.'],
          ['Seu Tião', 'Portal no chão, outro no teto, longe do beiral, e pula. Cada volta você cai mais rápido.'],
          ['Seu Tião', 'Quando estiver voando baixo, ainda caindo, troca o portal do teto pro painel lá fora, pela janela. E depois das grades, já sabe.'],
        ],
        hints: [
          { after: 70, lines: [['Seu Tião', 'Duas voltas bastam: a velocidade para de subir em 115 km/h. Tempo lento ajuda a mirar pela janela.']] },
          { after: 160, lines: [['Seu Tião', 'Depois da segunda grade: um portal no painel laranja, outro no painel deitado atrás dele. Esse te joga pra plataforma alta.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ M03
  M(2, {
    name: 'Zigue-Zague',
    who: 'Kelly',
    lesson: 'Quatro arremessos cruzando o salão na diagonal. Três grades: três pares de portais abertos no ar.',
    build(w) {
      walls(w, -40, 40, -200, 24, -6, 52);
      w.box(-41, 52, -201, 41, 53, 25, 'metal');
      lava(w, -40, 40, -200, 24, -4);
      dropShaft(w, -26, 12, 40, { size: 8, wall: 2 });
      const NE = [0.5, D, -0.5];
      const NW = [-0.5, D, -0.5];
      const SW = [-0.5, D, 0.5];
      const SE = [0.5, D, 0.5];
      w.panel([-28, 2.5, -4], NE, { w: 5, h: 5, stand: -4 });
      w.fizzler(-40, -4, -28.1, 40, 52, -27.9);
      w.panel([28.6, 2.5, -60.6], SW, { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([24, 2.5, -50], NW, { w: 5, h: 5, stand: -4 });
      w.fizzler(-40, -4, -80.1, 40, 52, -79.9);
      w.panel([-32.6, 2.5, -106.6], SE, { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([-28, 2.5, -96], NE, { w: 5, h: 5, stand: -4 });
      w.fizzler(-40, -4, -120.1, 40, 52, -119.9);
      w.panel([28.6, 2.5, -152.6], SW, { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([24, 2.5, -142], [0, 0.94, -0.342], { w: 5, h: 5, stand: -4 });
      pillar(w, 14, -198, 36, -172, 30);
      w.exitElevator(25, 30, -190);
      sign(w, -39.97, 30, 0, Math.PI / 2, 'M03', 'ZIGUE-ZAGUE', 'quatro arremessos · três grades');
      lamps(w, [
        [-20, 48, 10],
        [10, 48, -30],
        [-10, 48, -80],
        [10, 48, -120],
        [20, 48, -160],
        [25, 48, -190],
      ], 600, 120);
      return {
        spawn: [-26, 40, 6.6, 0.4],
        gun: 'both',
        dinos: [
          { s: 'ptero', scale: 1.2, orbit: { cx: 0, cz: -100, rx: 30, rz: 80, y: 42, speed: 11, bank: 0.35, bob: 1.5 } },
          { s: 'ptero', scale: 1, orbit: { cx: 0, cz: -60, rx: 22, rz: 30, y: 36, speed: 9, bank: 0.35, bob: 1, dir: -1 } },
        ],
        intro: [
          ['Kelly', 'Quarenta metros de poço. Você sai voando na diagonal e atravessa o salão inteiro, de parede a parede.'],
          ['Kelly', 'Depois de cada grade: um portal no painel laranja onde vai cair, outro no painel que joga pro lado de lá.'],
          ['Kelly', 'São quatro arremessos. Errou, é rocha fundida. Respira e usa o tempo lento.'],
        ],
        hints: [
          { after: 80, lines: [['Kelly', 'Os painéis brancos ficam do lado de cá do laranja, um pouco antes. A setinha mostra pra onde eles atiram.']] },
          { after: 200, lines: [['Kelly', 'O último painel é deitado: joga você pra cima da plataforma da saída, no fundo do salão.']] },
        ],
      };
    },
  }),
  // ------------------------------------------------------------------ M04
  M(3, {
    name: 'Gêiser',
    who: 'Rodrigo',
    lesson: 'Bata na parede em voo e saia por um portal no chão: a velocidade vira subida. Depois, mais um arremesso.',
    build(w) {
      walls(w, -30, 30, -150, 20, -6, 60);
      w.box(-31, 60, -151, 31, 61, 21, 'metal');
      lava(w, -30, 30, -150, 20, -4);
      // 1) torre de partida (36 m) e o painel baixo, de 30°
      dropShaft(w, 0, 10, 36, { size: 8, wall: 2 });
      w.panel([0, 2.5, -4], [0, 0.5, -0.866], { w: 5, h: 5, stand: -4 });
      // a parede clara que pega você no alto da trajetória
      w.box(-8, -4, -36, 8, 22, -35.2, 'white');
      // a base da torre do gêiser: chão claro colado na torre
      w.box(10, -4, -36, 16, 0, -28, 'white');
      // 2) torre do gêiser (20 m), com o segundo poço
      w.box(16, -4, -44, 28, 20, -32, 'metal');
      dropShaft(w, 22, -26, 20, { size: 7, wall: 2.5 });
      w.panel([22, 2.5, -50], [0, D, -D], { w: 5, h: 5, stand: -4 });
      w.fizzler(-30, -4, -66.1, 30, 60, -65.9);
      w.panel([22, 2.5, -90], [0, D, D], { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([14, 2.5, -102], [-0.259, 0.966, 0], { w: 5, h: 5, stand: -4 });
      pillar(w, -18, -118, 2, -88, 16);
      w.exitElevator(-9, 16, -110);
      sign(w, -29.97, 30, 0, Math.PI / 2, 'M04', 'GÊISER', 'parede → chão: o voo vira subida');
      lamps(w, [
        [0, 56, 8],
        [0, 56, -30],
        [20, 56, -40],
        [20, 56, -80],
        [0, 56, -110],
      ], 560, 110);
      return {
        spawn: [0, 36, 5, 0],
        gun: 'both',
        dinos: [{ s: 'ptero', scale: 1.2, orbit: { cx: 5, cz: -70, rx: 18, rz: 40, y: 48, speed: 9, bank: 0.35, bob: 1 } }],
        intro: [
          ['Rodrigo', 'Esse painel é baixo: te joga quase reto, a oitenta por hora. Lá no alto do voo você bate na parede clara.'],
          ['Rodrigo', 'Bate num portal, sai pelo outro no chão claro do pé da torre: a velocidade vira subida, e você chega lá em cima.'],
          ['Rodrigo', 'É rápido: um segundo e pouco de voo. Tempo lento, um portal na parede onde vai bater, outro no chão da torre.'],
        ],
        hints: [
          { after: 70, lines: [['Rodrigo', 'Subindo, anda em direção à torre: você encosta nela e sobe raspando até o topo.']] },
          { after: 180, lines: [['Rodrigo', 'Lá de cima é poço de novo, painel de 45° e, depois da grade, pega-voo e painel em pé. Ele te joga pra plataforma à esquerda.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ M05
  M(4, {
    name: 'Mergulho',
    who: 'Marquinho',
    lesson: 'Cem metros de queda. A grade apaga tudo: abra os portais caindo a 115 km/h.',
    build(w) {
      walls(w, -20, 135, -60, 30, -6, 112);
      w.box(-21, 112, -61, 136, 113, 31, 'metal');
      lava(w, -20, 135, -60, 30, -4);
      // plataforma lá no alto, presa na parede sul, com um tubo curto de queda
      w.box(-10, 99, -10, -3, 100, 30, 'metal');
      w.box(3, 99, -10, 10, 100, 30, 'metal');
      w.box(-3, 99, 3, 3, 100, 30, 'metal');
      w.box(-3, 99, -10, 3, 100, -3, 'metal');
      w.box(-4, 90, -4, -3, 99, 4, 'metal');
      w.box(3, 90, -4, 4, 99, 4, 'metal');
      w.box(-3, 90, -4, 3, 99, -3, 'metal');
      w.box(-3, 90, 3, 3, 99, 4, 'metal');
      w.strip(-3, 100.005, -3.1, 3, 100.02, -3, 0xffcc33, 1.6);
      w.strip(-3, 100.005, 3, 3, 100.02, 3.1, 0xffcc33, 1.6);
      // grade horizontal: apaga os portais e barra os tiros de cima
      w.fizzler(-20, 69.9, -60, 135, 70.1, 30);
      // lá embaixo: o chão claro e o painel que atira para o leste
      w.box(-4, -4, -4, 4, 0, 4, 'white');
      w.panel([8, 2.5, 0], [D, D, 0], { w: 5, h: 5, stand: -4 });
      w.fizzler(39.9, -4, -60, 40.1, 69.9, 30);
      w.panel([112, 2.5, 0], [-D, D, 0], { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([122, 2.5, -10], [0, 0.966, -0.259], { w: 5, h: 5, stand: -4 });
      pillar(w, 112, -58, 132, -32, 40);
      w.exitElevator(122, 40, -50);
      sign(w, 3.97, 105, 20, -Math.PI / 2, 'M05', 'MERGULHO', '100 metros · grade no meio da queda');
      lamps(w, [
        [0, 108, 15],
        [0, 60, 0],
        [40, 60, 0],
        [80, 60, 0],
        [118, 60, -20],
      ], 700, 140);
      return {
        spawn: [0, 100, 12, 0],
        gun: 'both',
        dinos: [
          { s: 'ptero', scale: 1.4, orbit: { cx: 0, cz: 0, rx: 14, rz: 14, y: 82, speed: 8, bank: 0.4, bob: 2 } },
          { s: 'ptero', scale: 1.2, orbit: { cx: 70, cz: -15, rx: 30, rz: 20, y: 50, speed: 10, bank: 0.35, bob: 2, dir: -1 } },
        ],
        intro: [
          ['Marquinho', 'Cem metros. Lá embaixo tem um chão claro e um painel que atira pro leste.'],
          ['Marquinho', 'A grade no meio da queda apaga qualquer portal e não deixa atirar através dela. Então é caindo: passou da grade, chão e painel.'],
          ['Marquinho', 'Você vai chegar a cento e quinze por hora. E do outro lado ainda tem mais uma grade.'],
        ],
        hints: [
          { after: 70, lines: [['Marquinho', 'Pula no tubo, segura o tempo lento assim que passar a grade. Primeiro o chão, que está bem embaixo de você.']] },
          { after: 170, lines: [['Marquinho', 'No fim: pega-voo laranja e o painel quase deitado atrás dele, que joga pra plataforma do norte.']] },
        ],
      };
    },
  }),

  // ------------------------------------------------------------------ M06
  M(5, {
    name: 'Do Outro Lado',
    who: 'Helena',
    lesson: 'Tudo junto: queda infinita, parede-gêiser e dois arremessos em zigue-zague. Quatro pares de portais no ar.',
    heat: true,
    build(w) {
      walls(w, -20, 110, -100, 30, -6, 62);
      w.box(-21, 62, -101, 111, 63, 31, 'metal');
      lava(w, -20, 110, -100, 30, -4);
      // A) câmara da queda infinita, janela para o norte
      w.box(-4, -4, -4, 4, 0, 4, 'white');
      w.box(-4, 24, -4, 4, 25, 4, 'white');
      w.box(-5, -4, -5, -4, 25, 5, 'metal');
      w.box(4, -4, -5, 5, 25, 5, 'metal');
      w.box(-4, -4, 4, 4, 25, 5, 'metal');
      w.box(-4, -4, -5, 4, 1, -4, 'metal');
      w.box(-4, 22, -5, 4, 25, -4, 'metal');
      w.box(-4, 11, 2.4, 4, 12, 4, 'metal');
      w.light(3.3, 19, 3.3, 45, 0xfff4e6, 30);
      w.panel([0, 2.5, -16], [D, D, 0], { w: 5, h: 5, stand: -4 });
      w.fizzler(19.9, -4, -40, 20.1, 62, 30);
      // B) a parede do alto do voo e o chão do gêiser, colado na torre
      w.box(52.2, 14, -24, 53, 40, -8, 'white');
      w.box(40, -4, 0, 48, 0, 8, 'white');
      // C) a torre (22 m) com o poço
      w.box(48, -4, -4, 60, 22, 4, 'metal');
      dropShaft(w, 54, 10, 22, { size: 7, wall: 2.5 });
      w.box(48, -4, 16, 60, 22, 20, 'metal');
      // D) zigue-zague: dois arremessos e o painel final
      w.panel([64, 2.5, 8], [0.5, D, -0.5], { w: 5, h: 5, stand: -4 });
      w.fizzler(77.9, -4, -20, 78.1, 62, 30);
      w.panel([95, 2.5, -23], [-0.5, D, 0.5], { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([88, 2.5, -14], [-0.5, D, -0.5], { w: 5, h: 5, stand: -4 });
      w.fizzler(40, -4, -30.1, 110, 62, -29.9);
      w.panel([57, 2.5, -45], [0.5, D, 0.5], { w: 7, h: 8, stand: -4, color: 0xffb03a });
      w.panel([66, 2.5, -54], [0, 0.94, -0.342], { w: 5, h: 5, stand: -4 });
      pillar(w, 56, -92, 76, -70, 16);
      w.exitElevator(66, 16, -85);
      w.sign(66, 22, -91.97, 0, [
        ['MOMENTO M06', 104, 150],
        ['DO OUTRO LADO', 76, 270, '#7b1fa2'],
        ['você atravessou a série inteira', 40, 380, '#55575c', 'Arial, sans-serif'],
        ['SÉRIE MOMENTO · LABORATÓRIO ANTÍPODA', 30, 455, '#8a8c90', 'Arial, sans-serif'],
      ]);
      sign(w, -4.03, 18, 0, -Math.PI / 2, 'M06', 'DO OUTRO LADO', 'tudo junto · quatro pares no ar');
      lamps(w, [
        [0, 58, 0],
        [30, 58, -16],
        [54, 58, 6],
        [80, 58, -10],
        [66, 58, -50],
        [66, 58, -85],
      ], 600, 120);
      return {
        spawn: [0, 12, 3.2, 0],
        gun: 'both',
        dinos: [
          { s: 'ptero', scale: 1.3, orbit: { cx: 50, cz: -30, rx: 40, rz: 30, y: 52, speed: 11, bank: 0.35, bob: 1.5 } },
          { s: 'rex', helmet: 0xf2c200, x: 70, y: 16, z: -78, rotY: Math.PI },
        ],
        intro: [
          ['Helena', 'Última da série. Tudo o que você aprendeu, em sequência, e sem chão no meio.'],
          ['Helena', 'Queda infinita pra pegar velocidade, painel pro leste. No alto do voo, parede e chão do gêiser pra subir na torre.'],
          ['Helena', 'Da torre, dois arremessos em zigue-zague e o painel final. O T-rex te espera lá do outro lado.'],
        ],
        hints: [
          { after: 90, lines: [['Helena', 'Depois da primeira grade: portal na parede clara lá no alto, outro no chão claro ao lado da torre. Você vai subir colado nela.']] },
          { after: 240, lines: [['Helena', 'Da torre: o primeiro painel joga pro nordeste, o seguinte volta pro noroeste. O último é deitado e joga pro norte.']] },
        ],
      };
    },
  }),
];
