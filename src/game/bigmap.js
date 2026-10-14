// Mapa livre "A Mina": um mapa grande para explorar (sozinho ou em grupo),
// com obstáculos, rocha fundida, torretas de segurança, 12 cristais e
// dinossauros: o T-rex do pátio (empurra quem fica na frente), raptores,
// um estegossauro pastando e pterossauros no teto.
//
// Planta (vista de cima, norte = +z):
//   norte  → pátio de chegada, salão com torres de rocha, sacada alta (oeste)
//   meio   → rio de rocha fundida com uma ponte estreita vigiada
//   sul-oeste → galerias (labirinto) e o poço de 30 m
//   sul-leste → a cava em degraus, com uma ilha no meio da rocha fundida

export const BIG_MAP = {
  id: 7,
  name: 'A Mina',
  who: 'Helena',
  music: 'doc',
  free: true,
  lesson: 'Encontre os 12 cristais. Cuidado com as torretas.',
  build(w) {
    const booths = [];
    // ---- chão norte (acima do rio) e chão sul (galerias), 4 m de espessura
    w.box(-50, -4, -4, 50, 0, 50, 'white');
    // sul-oeste, recortado em volta do poço (x −38..−32, z −38..−32)
    w.box(-50, -4, -50, -38, 0, -10, 'white');
    w.box(-32, -4, -50, 10, 0, -10, 'white');
    w.box(-38, -4, -50, -32, 0, -38, 'white');
    w.box(-38, -4, -32, -32, 0, -10, 'white');
    // ---- rio de rocha fundida (z −10..−4) e a ponte
    w.box(-50, -8, -10, 50, -6, -4, 'rock');
    w.hazard(-50, -6, -10, 50, -5.4, -4);
    w.box(-1.6, -1, -10, 1.6, 0, -4, 'metal');
    w.strip(-1.6, 0.01, -10, -1.5, 0.08, -4, 0xffcc33, 1.2);
    w.strip(1.5, 0.01, -10, 1.6, 0.08, -4, 0xffcc33, 1.2);
    // ---- paredes externas: metal embaixo, concreto claro em cima
    w.box(-51, -8, -51, -50, 8, 51, 'metal');
    w.box(-51, 8, -51, -50, 28, 51, 'white');
    w.box(50, -8, -51, 51, 8, 51, 'metal');
    w.box(50, 8, -51, 51, 28, 51, 'white');
    w.box(-50, -8, 50, 50, 8, 51, 'metal');
    w.box(-50, 8, 50, 50, 28, 51, 'white');
    w.box(-50, -8, -51, 50, 8, -50, 'metal');
    w.box(-50, 8, -51, 50, 28, -50, 'white');
    w.box(-51, 28, -51, 51, 29, 51, 'metal');
    // painéis claros no teto (dá para "cair do teto" em cima das coisas)
    w.box(-30, 27.6, 0, 30, 28, 26, 'white');
    w.box(14, 27.6, -46, 46, 28, -14, 'white');

    // ---- pátio de chegada (norte)
    w.box(-12, 0, 44, 12, 4, 50, 'white'); // degrau alto com cristal
    w.sign(0, 6.2, 49.97, Math.PI, [
      ['MAPA LIVRE', 100, 150],
      ['A MINA', 76, 265, '#c0392b'],
      ['12 cristais · torretas · rocha fundida', 40, 380, '#55575c', 'Arial, sans-serif'],
      ['LABORATÓRIO ANTÍPODA · NOVA LIMA (MG)', 30, 455, '#8a8c90', 'Arial, sans-serif'],
    ], 4.6, 2.3);

    // ---- salão com torres de rocha (topos claros aceitam portal)
    const tower = (x0, z0, x1, z1, h) => {
      w.box(x0, 0, z0, x1, h, z1, 'rock');
      w.box(x0, h, z0, x1, h + 0.4, z1, 'white');
    };
    tower(-24, 8, -20, 12, 10);
    tower(-6, 14, -2, 18, 14);
    tower(14, 6, 18, 10, 6);
    tower(24, 18, 28, 22, 18);
    tower(-38, 2, -35, 5, 8);
    // paredes soltas de concreto claro
    w.box(-36, 0, 20, -34, 9, 32, 'white');
    w.box(30, 0, 0, 32, 9, 12, 'white');
    w.box(6, 0, 26, 18, 6, 27, 'white');
    // caixotes de metal (obstáculos)
    for (const [x, z, s] of [
      [-14, 20, 2],
      [-12, 22, 1.4],
      [10, 16, 2],
      [36, 26, 2.4],
      [-28, 30, 1.6],
      [20, 36, 2],
    ])
      w.box(x - s / 2, 0, z - s / 2, x + s / 2, s, z + s / 2, 'metal');

    // ---- sacada alta (oeste), com vidro de proteção
    w.box(-50, 12, -2, -44, 13, 30, 'metal');
    w.box(-44, 13, -2, -43.8, 14.3, 30, 'glass');
    booth(w, 50, 10, 24, '-x', 'helena', booths);

    // ---- o poço (30 m), paredes claras para escapar com portais
    w.box(-39, -34, -39, -38, -4, -31, 'white');
    w.box(-32, -34, -39, -31, -4, -31, 'white');
    w.box(-38, -34, -39, -32, -4, -38, 'white');
    w.box(-38, -34, -32, -32, -4, -31, 'white');
    w.box(-38, -36, -38, -32, -30, -32, 'white');
    for (let y = -8; y > -30; y -= 6) w.strip(-37.98, y, -37.98, -32.02, y + 0.1, -37.92, 0xffd27a, 1.4);
    w.light(-35, -26, -35, 25, 0xffd9a0, 18);

    // ---- galerias (labirinto) no sudoeste
    const wall = (x0, z0, x1, z1, mat = 'metal') => w.box(x0, 0, z0, x1, 7, z1, mat);
    wall(-46, -20, -20, -19.2);
    wall(-30, -30, -29.2, -20, 'white');
    wall(-46, -28, -36, -27.2);
    wall(-28, -42, -20, -41.2);
    wall(-20, -48, -19.2, -30, 'white');
    wall(-46, -44, -40, -43.2);
    wall(-14, -30, -6, -29.2);
    wall(-44, -36, -43.2, -30, 'white');

    // ---- a cava em degraus (sudeste)
    w.box(10, -4, -50, 50, 0, -44, 'white');
    w.box(10, -4, -16, 50, 0, -10, 'white');
    w.box(10, -4, -44, 16, 0, -16, 'white');
    w.box(44, -4, -44, 50, 0, -16, 'white');
    w.box(16, -8, -44, 44, -4, -38, 'white');
    w.box(16, -8, -22, 44, -4, -16, 'white');
    w.box(16, -8, -38, 22, -4, -22, 'white');
    w.box(38, -8, -38, 44, -4, -22, 'white');
    w.box(22, -12, -38, 38, -8, -34, 'white');
    w.box(22, -12, -26, 38, -8, -22, 'white');
    w.box(22, -12, -34, 26, -8, -26, 'white');
    w.box(34, -12, -34, 38, -8, -26, 'white');
    w.box(26, -14, -34, 34, -11, -26, 'rock');
    w.hazard(26, -11, -34, 34, -10.4, -26);
    w.box(29, -11, -31, 31, -8, -29, 'rock'); // ilha no meio

    // ---- luzes (poucas e fortes: o mapa é grande)
    for (const [x, y, z] of [
      [-20, 26, 30],
      [20, 26, 30],
      [-20, 26, 6],
      [20, 26, 6],
      [-30, 20, -30],
      [30, 20, -30],
      [0, 20, -20],
    ])
      w.light(x, y, z, 230, 0xfff2e2, 70);

    return {
      spawn: [0, 0, 40, 0],
      booths,
      cubes: [
        [6, 0, 36],
        [-6, 0, 36],
        [-26, 0, -16],
        [12, 0, -12],
      ],
      turrets: [
        [0, 0, -13, 0], // ponte (olha para o norte)
        [-24, 0, -24, 0],
        [-40, 0, -36, Math.PI / 2],
        [-16, 0, -46, -Math.PI / 2],
        [46, 0, -12, -Math.PI / 2],
        [30, -8, -23, Math.PI],
        [-12, 0, 0, Math.PI / 2],
        [-47, 13, 24, Math.PI],
        [24, 18.4, 21, -Math.PI / 2],
      ],
      crystals: [
        [-22, 10.4, 10],
        [-4, 14.4, 16],
        [26, 18.4, 19.2],
        [0, 4, 47],
        [-47, 13, 10],
        [-35, -30, -35],
        [-44, 0, -47],
        [-24, 0, -36],
        [24, -8, -36],
        [42, -4, -18],
        [30, -8, -30],
        [47, 0, -47],
      ],
      dinos: [
        { s: 'rex', helmet: 0xf2c200, rex: true, orbit: { cx: 0, cz: 32, rx: 24, rz: 4, speed: 3 } },
        { s: 'raptor', helmet: 0xffffff, pose: 'run', orbit: { cx: -2, cz: -21, rx: 5, rz: 4, speed: 6.5 } },
        { s: 'raptor', helmet: 0xff7a1a, pose: 'run', orbit: { cx: -2, cz: -21, rx: 5, rz: 4, speed: 6.5, phase: 0.9 } },
        { s: 'stego', x: 42, y: 0, z: 42, rotY: -Math.PI / 2, pose: 'graze' },
        { s: 'ptero', scale: 0.8, orbit: { cx: 0, cz: 14, rx: 22, rz: 14, y: 22, speed: 7, bank: 0.35, bob: 1 } },
        { s: 'ptero', scale: 0.8, orbit: { cx: 28, cz: -30, rx: 12, rz: 10, y: 16, speed: 6, bank: 0.35, bob: 1, dir: -1 } },
      ],
      intro: [
        ['Helena', 'Mapa livre: a mina inteira é sua. Tem doze cristais de quartzo rosa escondidos por aí.'],
        ['Marquinho', 'E cuidado com as torretas de segurança. Elas não perdoam.'],
        ['Marquinho', 'Chega por trás e aperta E pra desligar, ou derruba com uma amostra, ou abre um portal embaixo delas.'],
        ['Marquinho', 'E o T-rex do pátio é da equipe. Só não fica na frente dele.'],
      ],
      hints: [{ after: 90, lines: [['Helena', 'Dica: um portal no topo de uma torre e outro na parede aqui embaixo levam você lá pra cima.']] }],
    };
  },
};

// cópia local da cabine (evita dependência circular com levels.js)
function booth(w, cx, cy, cz, facing, who, list) {
  const DIRS = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
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
  const [nx, nz] = P(0.6, 1.0);
  list.push({ who, x: nx, y: cy, z: nz, rotY: Math.atan2(dx, dz) });
}
