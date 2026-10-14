// Série Fronteira: mapas enormes que juntam tudo — lasers e cubos refletores,
// torretas, placas de lançamento, funis de excursão, bolas de energia,
// arremessos de momento, viagem no tempo, antigravidade, buracos negros e,
// no fim, um portal para a Lua.
//
// Coordenadas em metros; o norte (saída) fica em −z. O chão de referência é
// y = 0 e a rocha fundida fica em y = −4.

import * as THREE from 'three';
import { lava, pillar, lamps, rampZ } from './hard.js';

const F = (n, def) => ({ ...def, id: 400 + n, n, code: `F${String(n + 1).padStart(2, '0')}`, series: 'frontier', music: def.music ?? 'labTense', heat: def.heat ?? false });

/** paredes e teto de um salão (sem chão) */
function shell(w, x0, x1, z0, z1, y0, top, mat = 'metal') {
  w.box(x0 - 1, y0, z0 - 1, x0, top, z1 + 1, mat);
  w.box(x1, y0, z0 - 1, x1 + 1, top, z1 + 1, mat);
  w.box(x0, y0, z1, x1, top, z1 + 1, mat);
  w.box(x0, y0, z0 - 1, x1, top, z0, mat);
  w.box(x0 - 1, top, z0 - 1, x1 + 1, top + 1, z1 + 1, 'metal');
}

/** quadrado aceso no chão (marca onde deixar algo) */
function marker(w, x, y, z, s = 0.65, color = 0xff5a3a) {
  const e = 0.06;
  w.strip(x - s, y + 0.005, z - s, x + s, y + 0.02, z - s + e, color, 1.4);
  w.strip(x - s, y + 0.005, z + s - e, x + s, y + 0.02, z + s, color, 1.4);
  w.strip(x - s, y + 0.005, z - s, x - s + e, y + 0.02, z + s, color, 1.4);
  w.strip(x + s - e, y + 0.005, z - s, x + s, y + 0.02, z + s, color, 1.4);
}

function sign(w, x, y, z, rotY, code, name, line2) {
  w.sign(x, y, z, rotY, [
    [`FRONTEIRA ${code}`, 100, 150],
    [name, 76, 270, '#00838f'],
    [line2, 38, 380, '#55575c', 'Arial, sans-serif'],
    ['SÉRIE FRONTEIRA · LABORATÓRIO ANTÍPODA', 30, 455, '#8a8c90', 'Arial, sans-serif'],
  ]);
}

export const FRONTIER = [
  // ------------------------------------------------------------------ F01
  F(0, {
    name: 'Feixe e Fé',
    who: 'Rodrigo',
    lesson: 'Desvie o laser com o cubo refletor, voe na placa, queime as torretas e pegue o funil até o outro lado.',
    build(w) {
      shell(w, -20, 20, -130, 14, -6, 36);
      lava(w, -20, 20, -130, 14, -4);

      // ---- 1. plataforma de partida: o laser cruza o chão; o receptor abre a porta
      w.box(-8, -6, -12, 8, 0, 14, 'metal');
      w.box(-8, 0, -4, -1.5, 5, -3, 'metal');
      w.box(1.5, 0, -4, 8, 5, -3, 'metal');
      w.box(-1.5, 3.5, -4, 1.5, 5, -3, 'metal');
      w.door('c1', -1.5, 0, -3.6, 1.5, 3.5, -3.3, { latch: true });
      w.laser(-20, 0.32, 6, [1, 0, 0]);
      w.laserCatcher(6, 0.75, -3, [0, 0, 1], 'c1');
      marker(w, 6, 0, 6);
      // placa de lançamento até a ilha das torretas
      w.faithPlateTo(0, 0, -9, 0, 4, -31, 5);

      // ---- 2. ilha das torretas: o vidro protege (torreta não enxerga através dele,
      // mas o laser passa); segure o cubo baixo, dentro do feixe, e mire
      pillar(w, -6, -41, 6, -27, 4);
      w.box(-6, 4, -37, -1.5, 8, -36.9, 'glass');
      w.box(1.5, 4, -37, 6, 8, -36.9, 'glass');
      w.box(-1.5, 7.5, -37, 1.5, 8, -36.9, 'glass');
      w.door('g2', -1.5, 4, -37, 1.5, 7.5, -36.9, { mat: 'glass', latch: true });
      w.laser(-20, 4.55, -36.6, [1, 0, 0]);
      w.box(3, 4, -41, 5, 6, -39.5, 'metal');
      w.laserCatcher(4, 4.75, -39.5, [0, 0, 1], 'g2');
      // funil apontando para o teto (com um painel branco lá em cima)
      w.funnel(-4, 4, -39.2, [0, 1, 0], { speed: 6 });
      w.box(-7, 35.8, -42, -1, 36, -36, 'white');
      // painel alto na parede sul: o funil sai dele indo para o norte
      w.box(-4, 17, 13.8, 4, 23, 14, 'white');

      // ---- 3. plataforma norte: bola de energia, receptor no chão e a gaiola da placa final
      pillar(w, -10, -96, 10, -70, 18);
      w.launcher(-20, 18.6, -82, [1, 0, 0], { life: 30, speed: 6 });
      w.box(19.8, 17.4, -83, 20, 20.4, -81, 'white');
      w.catcher(6, 18, -76, [0, 1, 0], 'e1');
      w.box(4.7, 35.8, -77.3, 7.3, 36, -74.7, 'white');
      // gaiola de vidro com a porta (aberta para o norte, sobre a beirada: a placa joga por cima do rebordo)
      w.box(4, 18, -96, 4.2, 22, -90, 'glass');
      w.box(7.8, 18, -96, 8, 22, -90, 'glass');
      w.box(4.2, 18, -96, 7.8, 18.5, -95.8, 'glass');
      w.box(4.2, 21.5, -90.3, 7.8, 22, -90, 'glass');
      w.door('e1', 4.2, 18, -90.3, 7.8, 21.5, -90, { latch: true });
      w.faithPlateTo(6, 18, -92, 0, 24, -121, 4);

      // ---- saída
      pillar(w, -8, -128, 8, -114, 24);
      w.exitElevator(0, 24, -124);

      sign(w, -7.97, 3.2, 8, Math.PI / 2, 'F01', 'FEIXE E FÉ', 'laser · placa · torretas · funil');
      lamps(w, [
        [0, 32, 6],
        [0, 32, -20],
        [0, 32, -45],
        [0, 32, -65],
        [0, 32, -85],
        [0, 32, -105],
        [0, 32, -122],
      ]);
      return {
        spawn: [0, 0, 11, 0],
        cubes: [
          [-4, 0, 11, { laser: true }],
          [2, 4, -30, { laser: true }],
        ],
        turrets: [
          [-1.2, 4, -39.6, 0],
          [1.4, 4, -39.6, 0],
        ],
        intro: [
          ['Rodrigo', 'Bem-vindo à Fronteira. Aqui tem de tudo junto. Começa pelo laser: ele atravessa o chão bem na sua frente.'],
          ['Rodrigo', 'Esse cubo de lente é refletor. Segura ele virado para onde quer mandar o feixe e solta na marca vermelha.'],
        ],
        hints: [
          { after: 70, lines: [['Rodrigo', 'Solta o cubo na marca, olhando para o receptor na parede. O feixe sai pela lente.']] },
          { after: 200, lines: [['Rodrigo', 'Na ilha: torreta não enxerga através do vidro, mas o laser passa. Segura o cubo baixinho dentro do feixe e mira nelas, depois no receptor.']] },
          { after: 330, lines: [['Rodrigo', 'O funil sobe até o teto. Portal no painel do teto e outro no painel alto da parede de trás.']] },
          { after: 480, lines: [['Rodrigo', 'A bola de energia: portal na parede leste, no caminho dela, e outro no teto bem em cima do receptor.']] },
        ],
      };
    },
  }),
  // ------------------------------------------------------------------ F02
  F(1, {
    name: 'Ecos do Tempo',
    who: 'Dona Cida',
    lesson: 'Aperte T para pular entre o passado e o futuro da mesma sala. O que existe numa época some na outra.',
    build(w) {
      shell(w, -16, 16, -130, 14, -6, 30);
      lava(w, -16, 16, -130, 14, -4);
      const P = 'past';
      const Fu = 'future';

      // ---- 1. o muro (inteiro no passado, rachado no futuro) e o chão que só existe no passado
      w.box(-8, -6, -7, 8, 0, 14, 'metal');
      w.box(-8, 0, -7, 8, 6, -6, 'white', { era: P });
      w.box(-8, 0, -7, -2, 6, -6, 'rock', { era: Fu });
      w.box(2, 0, -7, 8, 6, -6, 'rock', { era: Fu });
      w.box(-2, 4.5, -7, 2, 6, -6, 'rock', { era: Fu });
      w.box(-8, -6, -10, 8, 0, -7, 'metal'); // beirada (as duas épocas)
      w.box(-8, -1, -36, 8, 0, -10, 'metal', { era: P });
      marker(w, 4, 0, -8.5, 1.9, 0x7fe3c4);
      // ---- 2. rampa (só no passado) até a plataforma alta; no futuro o chão dela tem um buraco
      const ramp = rampZ(w, 4, 4, -9.6, 0, -36.2, 16);
      w.inEra(ramp, P);
      w.box(0, 15, -44, 8, 16, -35.8, 'metal');
      w.box(0, 15, -56, 8, 16, -50, 'metal');
      w.box(0, 15, -50, 1, 16, -44, 'metal');
      w.box(7, 15, -50, 8, 16, -44, 'metal');
      w.box(1, 15, -50, 7, 16, -44, 'metal', { era: P }); // tampa do buraco
      // fundo do poço: chão branco (portal) 16 m abaixo
      w.box(1, -6, -50, 7, 0, -44, 'white');
      // painel na parede leste: quem sai dele voa para o oeste
      w.box(15.8, 11, -50, 16, 15, -42, 'white');

      // ---- 3. beirada oeste e o salão das torretas (vidro só no passado)
      w.box(-16, -6, -64, -9, 2, -36, 'metal');
      w.box(-16, -6, -101, 16, 2, -64, 'metal');
      w.box(-16, 2, -70.2, 16, 9, -70, 'glass', { era: P });
      w.button(8, 2, -88, 'x');
      // painéis para chegar por trás das torretas
      w.box(-16, 2, -56, -15.8, 6, -52, 'white');
      w.box(-12, 2, -100, -8, 6, -99.8, 'white');
      // parede norte com a porta e a sala de saída
      w.box(-16, 2, -101, -1.5, 9, -100, 'metal');
      w.box(1.5, 2, -101, 16, 9, -100, 'metal');
      w.box(-1.5, 5.5, -101, 1.5, 9, -100, 'metal');
      w.door('x', -1.5, 2, -100.7, 1.5, 5.5, -100.4, { latch: true });
      w.box(-6, -6, -112, 6, 2, -101, 'metal');
      w.exitElevator(0, 2, -108);

      // ---- cara de cada época: no futuro, ruína (pedra, trepadeiras, luz vermelha)
      for (const [x, z] of [
        [-6, 4],
        [6, -2],
        [-13, -90],
        [12, -76],
      ])
        w.box(x - 0.8, x === -6 || x === 6 ? 0 : 2, z - 0.8, x + 0.8, (x === -6 || x === 6 ? 0 : 2) + 1.1, z + 0.8, 'rock', { era: Fu });
      for (const x of [-15.9, 15.7])
        for (const z of [-20, -60, -90]) w.inEra(w.strip(x, 4, z - 4, x + 0.2, 22, z - 3.7, 0x4caf50, 0.9), Fu);
      lamps(w, [
        [0, 26, 6],
        [0, 26, -24],
        [4, 26, -46],
        [-8, 26, -60],
        [0, 26, -84],
        [0, 26, -106],
      ], 260, 80);
      for (const [x, z] of [
        [0, -10],
        [0, -50],
        [0, -85],
      ]) {
        w.inEra(w.light(x, 20, z, 300, 0xfff4e0, 70), P);
        w.inEra(w.light(x, 20, z, 120, 0xff4a2a, 60), Fu);
      }
      sign(w, -7.97, 3, 8, Math.PI / 2, 'F02', 'ECOS DO TEMPO', 'T · passado e futuro');
      return {
        spawn: [0, 0, 10, 0],
        timeTravel: true,
        eraNames: ['PASSADO · 2009', 'FUTURO · 2187'],
        cubes: [[-12, 2, -44]],
        turrets: [
          [-4, 2, -96, 0],
          [4, 2, -96, 0],
        ],
        intro: [
          ['Dona Cida', 'Esse laboratório existe em duas épocas ao mesmo tempo. Aperta T e você pula entre o passado e o futuro.'],
          ['Dona Cida', 'O que existe numa época pode não existir na outra. E se você ficaria dentro de uma parede, o salto não acontece.'],
        ],
        hints: [
          { after: 40, lines: [['Dona Cida', 'O muro está rachado no futuro. Passa pela rachadura e volta pro passado na beirada.']] },
          { after: 150, lines: [['Dona Cida', 'Lá de cima, no futuro, o chão tem um buraco. Portal no fundo dele e outro no painel da parede leste.']] },
          { after: 300, lines: [['Dona Cida', 'No passado o vidro protege; no futuro, não. Dá para chegar por trás das torretas pelos painéis.']] },
        ],
      };
    },
  }),
  // ------------------------------------------------------------------ F03
  F(2, {
    name: 'Horizonte de Eventos',
    who: 'Seu Tião',
    lesson: 'Ande pelo teto na gravidade invertida, mande o laser pelos portais, pegue o funil por cima do buraco negro e suba na torre sem peso.',
    build(w) {
      shell(w, -20, 20, -120, 14, -6, 50);
      lava(w, -20, 20, -120, 14, -4);

      // ---- A. corredor de gravidade invertida (anda-se no teto) com uma bola de energia cruzando
      w.box(-14, -6, 4, -2, 0, 14, 'metal');
      w.gravZone(-12, 0, -30, -4, 10, 4, [0, 9.8, 0]);
      w.box(-12, 10, -30, -4, 11, 4, 'white');
      w.launcher(-20, 9, -15, [1, 0, 0], { life: 40, speed: 6 });

      // ---- B. o salão do buraco negro
      w.box(-14, -6, -46, 14, 0, -30, 'metal');
      w.blackHole(6, 8, -66, { strength: 900, horizon: 1.5, reach: 35 });
      // laser: atravessa a plataforma alto (passa-se por baixo) e bate no painel leste
      w.laser(-20, 2.2, -36, [1, 0, 0]);
      w.box(19.8, 1, -36.8, 20, 3.4, -35.2, 'white');
      // painel alto na parede sul: o laser sai dele para o norte, por cima de tudo, até o receptor
      w.box(9.2, 28.7, 13.8, 10.8, 31.3, 14, 'white');
      w.laserCatcher(10, 30, -120, [0, 0, 1], 'fx');
      // funil (liga com o receptor) apontando para o teto + painéis do teto e da parede sul
      w.funnel(10, 0, -42, [0, 1, 0], { power: 'fx', speed: 6 }).latch = true;
      w.box(7, 49.8, -45, 13, 50, -39, 'white');
      w.box(1, 16, 13.8, 7, 20, 14, 'white'); // (longe da coluna do funil: o feixe não cruza consigo mesmo)

      // ---- C. plataforma norte: torre sem gravidade e a saída lá em cima
      w.box(2, -6, -100, 18, 16, -86, 'metal');
      // a zona começa acima da cabeça de quem está no chão: só a placa leva para dentro dela
      w.gravZone(6, 18, -96, 14, 44, -88, [0, 0, 0], 0x6fd8ff);
      w.box(6, 44, -96, 14, 45, -88, 'metal');
      // poço de vidro em volta (sem peso, ninguém "vaza" pelos lados); só abre embaixo (oeste) e em cima (leste)
      w.box(5.8, 18.6, -96, 6, 44, -88, 'glass');
      w.box(5.8, 16, -96, 6, 18.6, -93, 'glass');
      w.box(5.8, 16, -91, 6, 18.6, -88, 'glass');
      w.box(14, 16, -96, 14.2, 40, -88, 'glass');
      w.box(6, 16, -96.2, 14, 44, -96, 'glass');
      w.box(6, 16, -88, 14, 44, -87.8, 'glass');
      w.faithPlate(10, 16, -92, [0, 12, 0]);
      w.box(14, -6, -98, 20, 40, -86, 'metal');
      w.exitElevator(17, 40, -92);

      sign(w, -13.97, 3, 9, Math.PI / 2, 'F03', 'HORIZONTE DE EVENTOS', 'antigravidade · buraco negro · funil');
      lamps(w, [
        [-8, 46, 8],
        [-8, 46, -14],
        [0, 46, -38],
        [-6, 46, -66],
        [10, 46, -92],
        [17, 46, -110],
      ], 520, 110);
      return {
        spawn: [-8, 0, 10, 0],
        intro: [
          ['Seu Tião', 'Daqui pra frente a gravidade obedece a gente. No corredor roxo ela aponta pra cima: você cai no teto e anda nele.'],
          ['Seu Tião', 'Lá no meio do salão tem um buraco negro de laboratório. Não chega perto: o que passa da borda não volta.'],
        ],
        hints: [
          { after: 60, lines: [['Seu Tião', 'A bola de energia corta o corredor. Espera ela passar antes de atravessar.']] },
          { after: 180, lines: [['Seu Tião', 'O laser passa por cima da sua cabeça. Portal no painel leste onde ele bate e outro no painel alto da parede sul: o receptor está lá no fundo, na mesma altura.']] },
          { after: 320, lines: [['Seu Tião', 'Com o funil ligado: portal no teto em cima dele e outro no painel do meio da parede sul. Ele te leva por cima do buraco negro.']] },
          { after: 460, lines: [['Seu Tião', 'Na torre sem peso, a placa te joga pra cima. Lá no alto, vai de lado para a plataforma da saída.']] },
        ],
      };
    },
  }),
  // ------------------------------------------------------------------ F04
  F(3, {
    name: 'Mar da Tranquilidade',
    who: 'Helena',
    music: 'labEpic',
    lesson: 'Abra a claraboia, atire um portal na Lua e atravesse o cânion lunar — no passado e no futuro.',
    build(w) {
      // ================= laboratório =================
      const X0 = -24;
      const X1 = 24;
      const Z0 = -90;
      const Z1 = 16;
      const TOP = 60;
      w.box(X0 - 1, -6, Z0 - 1, X0, TOP, Z1 + 1, 'metal');
      w.box(X1, -6, Z0 - 1, X1 + 1, TOP, Z1 + 1, 'metal');
      w.box(X0, -6, Z1, X1, TOP, Z1 + 1, 'metal');
      w.box(X0, -6, Z0 - 1, X1, TOP, Z0, 'metal');
      // teto com a claraboia (x −8..8, z −60..−44) e a persiana que abre de lado
      w.box(X0 - 1, TOP, -44, X1 + 1, TOP + 1, Z1 + 1, 'metal');
      w.box(X0 - 1, TOP, Z0 - 1, X1 + 1, TOP + 1, -60, 'metal');
      w.box(X0 - 1, TOP, -60, -8, TOP + 1, -44, 'metal');
      w.box(8, TOP, -60, X1 + 1, TOP + 1, -44, 'metal');
      w.door('gd', -8, TOP, -60, 8, TOP + 0.9, -44, { axis: 'x', dist: 17, mat: 'metal', latch: true, speed: 0.2 });
      lava(w, X0, X1, Z0, Z1, -4);
      // a Lua no céu, a Terra (vista da Lua) e as estrelas
      w.moon(0, 420, -150, 60, { c: [0, 1002.4, 19], n: [0, 0, -1], u: [0, 1, 0] });
      w.stars([0, 500, -100], 1600, 4000);

      // ---- 1. plataforma de partida: bola de energia pelos portais até o receptor; a gaiola da placa abre
      w.box(-10, -6, 4, 10, 0, Z1, 'metal');
      w.launcher(X1, 3, 10, [-1, 0, 0], { life: 40, speed: 6 });
      w.box(X0, 1.9, 9.2, X0 + 0.2, 4.1, 10.8, 'white');
      w.box(6.5, 1.9, Z1 - 0.2, 8.1, 4.1, Z1, 'white');
      w.box(6, 0, 4, 8.6, 4, 5, 'metal');
      w.catcher(7.3, 3, 5, [0, 0, 1], 'fp');
      // gaiola da placa (aberta para o norte sobre a beirada)
      w.box(-8, 0, 4, -7.8, 4, 9.2, 'glass');
      w.box(-4.2, 0, 4, -4, 4, 9.2, 'glass');
      w.box(-7.8, 0, 4, -4.2, 0.5, 4.2, 'glass');
      w.box(-7.8, 3.5, 9, -4.2, 4, 9.2, 'glass');
      w.door('fp', -7.8, 0, 9, -4.2, 3.5, 9.2, { latch: true });
      w.faithPlateTo(-6, 0, 6.5, 0, 24, -40, 6);

      // ---- 2. varanda alta: vidro (o laser passa, as torretas não enxergam), receptor e a parede branca
      w.box(-12, -6, -66, 12, 24, -36, 'metal');
      w.box(-12, 24, -51, -1.5, 30, -50.9, 'glass');
      w.box(1.5, 24, -51, 12, 30, -50.9, 'glass');
      w.box(-1.5, 29.5, -51, 1.5, 30, -50.9, 'glass');
      w.door('gd', -1.5, 24, -51, 1.5, 29.5, -50.9, { mat: 'glass', latch: true });
      w.laser(X0, 24.55, -50.6, [1, 0, 0]);
      w.box(3, 24, -56, 5, 26, -54.5, 'metal');
      w.laserCatcher(4, 24.75, -54.5, [0, 0, 1], 'gd');
      w.box(-3, 24, -64, 3, 30, -63, 'white');

      // ================= a Lua (gravidade lunar acima de y = 900) =================
      const Y = 1000;
      // chão: sul e norte do cânion (regolito não aceita portal aqui: só o painel de pouso)
      w.box(-80, Y - 50, -40, 80, Y, 40, 'moon', { noPortal: true });
      w.box(-80, Y - 50, -130, 80, Y, -70, 'moon', { noPortal: true });
      w.box(-80, Y - 50, -70, 80, Y - 40, -40, 'rock');
      w.hazard(-80, Y - 40, -70, 80, Y - 38, -40);
      // bordas da área (cristas de rocha)
      const ridge = { noPortal: true };
      w.box(-84, Y - 40, -134, -80, Y + 10, 44, 'moon', ridge);
      w.box(80, Y - 40, -134, 84, Y + 10, 44, 'moon', ridge);
      w.box(-80, Y - 40, 40, 80, Y + 10, 44, 'moon', ridge);
      w.box(-80, Y - 40, -134, 80, Y + 10, -130, 'moon', ridge);
      // painel de pouso (onde o portal da Lua abre), virado para o norte
      w.box(-3, Y, 19, 3, Y + 6, 20, 'white');
      // ponte da missão de 2031 (só no passado), com corrimão de vidro
      w.box(-2, Y - 1.5, -72, 2, Y, -38, 'metal', { era: 'past' });
      w.box(-2.2, Y, -72, -2, Y + 1.2, -38, 'glass', { era: 'past' });
      w.box(2, Y, -72, 2.2, Y + 1.2, -38, 'glass', { era: 'past' });
      // anomalia: um buraco negro pequeno flutuando sobre o cânion
      w.blackHole(18, Y + 12, -55, { strength: 500, horizon: 1.6, reach: 30 });
      // base lunar de 2187 (só no futuro): paredes, teto, mezanino e o funil até a saída
      const fut = { era: 'future' };
      w.box(-10, Y, -100, -9.6, Y + 14, -84, 'white', fut);
      w.box(9.6, Y, -100, 10, Y + 14, -84, 'white', fut);
      w.box(-10, Y, -100.4, 10, Y + 14, -100, 'white', fut);
      w.box(-10, Y, -84.4, -2, Y + 14, -84, 'white', fut);
      w.box(2, Y, -84.4, 10, Y + 14, -84, 'white', fut);
      w.box(-2, Y + 4, -84.4, 2, Y + 14, -84, 'white', fut);
      w.box(-10, Y + 14, -100.4, 10, Y + 14.5, -84, 'metal', fut);
      w.box(-9.6, Y + 7.5, -100, 1, Y + 8, -88, 'metal', fut);
      w.funnel(4, Y, -92, [0, 1, 0], { speed: 4 });
      w.exitElevator(-5, Y + 8, -95, false, fut);
      for (const [x, z] of [
        [0, -92],
        [-6, -88],
      ])
        w.inEra(w.light(x, Y + 12.5, z, 120, 0xdfe8ff, 30), 'future');
      // luz do Sol na Lua e a Terra no céu
      for (const [x, z] of [
        [-30, 20],
        [30, 0],
        [0, -55],
        [-30, -100],
        [30, -110],
      ])
        w.light(x, Y + 40, z, 900, 0xfff6e8, 140, false);
      w.earth(-60, Y + 260, -420, 70);

      sign(w, -9.97, 3, 12, Math.PI / 2, 'F04', 'MAR DA TRANQUILIDADE', 'tudo junto · portal para a Lua');
      lamps(w, [
        [0, 56, 8],
        [0, 56, -20],
        [-12, 56, -50],
        [12, 56, -70],
      ], 600, 120);
      const G = 9.8;
      return {
        spawn: [0, 0, 12, 0],
        timeTravel: true,
        eraNames: ['MISSÃO 2031', 'BASE LUNAR 2187'],
        gravityAt: (p, out = new THREE.Vector3()) => out.set(0, p.y > 900 ? -1.62 : -G, 0),
        cubes: [[2, 24, -40, { laser: true }]],
        turrets: [
          [-1.2, 24, -54, 0],
          [1.4, 24, -54, 0],
        ],
        intro: [
          ['Helena', 'A última câmara da Fronteira. Lá em cima tem uma claraboia, e atrás dela, a Lua.'],
          ['Helena', 'Dizem que a rocha lunar conduz portais. Se você abrir um lá... segura firme, porque o vácuo puxa tudo.'],
        ],
        moonLines: [
          ['Helena', 'Você está na Lua! A gravidade aqui é um sexto da nossa: cada pulo vai longe.'],
          ['Helena', 'A ponte sobre o cânion é da missão de 2031. A base, com a saída, só vai existir em 2187. Aperta T na hora certa.'],
        ],
        hints: [
          { after: 70, lines: [['Helena', 'A bola de energia corre na altura da cabeça. Portal no painel da parede oeste, no caminho dela, e outro no painel da parede sul, de frente para o receptor.']] },
          { after: 240, lines: [['Helena', 'Na varanda: o vidro te protege das torretas e o laser atravessa. Segura o cubo baixo dentro do feixe e mira nelas, depois no receptor.']] },
          { after: 400, lines: [['Helena', 'Com a claraboia aberta: um portal na parede branca da varanda e o outro... na Lua.']] },
        ],
      };
    },
  }),
];
