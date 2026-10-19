// Registro dos elementos do editor. Cada tipo:
//   label, group, color (cor do marcador no editor)
//   shape: 'box'  → item.p = centro, item.s = tamanho (esticável com o gizmo)
//          'point'→ item.p = base/posição; `hit` = caixa de seleção, `lift` = altura do centro da caixa
//   rot:   'yaw' (item.yaw em graus) | 'euler' (item.r em graus, ordem YXZ) | undefined
//   params: campos do painel { k, label, t:'num'|'text'|'select'|'bool'|'sig'|'v3'|'color', d, o, min, max, step }
//   build(w, item, ctx): chama a API do World (e preenche ctx.data: spawn, cubes, turrets, portals, …)
//
// Nada aqui sabe de editor: é só o que o jogo precisa para construir cada peça.

import * as THREE from 'three';
import { portalGun } from '../models.js';

const D2R = Math.PI / 180;

export const GROUPS = ['Estrutura', 'Mecanismos', 'Energia e luz', 'Movimento', 'Objetos', 'Ambiente'];

export const DIRS = [
  ['+x', '+X (leste)'],
  ['-x', '−X (oeste)'],
  ['+y', '+Y (cima)'],
  ['-y', '−Y (baixo)'],
  ['+z', '+Z (sul)'],
  ['-z', '−Z (norte)'],
];
export const dirVec = (d) => {
  const v = [0, 0, 0];
  v['xyz'.indexOf(d[1])] = d[0] === '-' ? -1 : 1;
  return v;
};

const MATS = [
  ['white', 'Concreto claro (aceita portal)'],
  ['metal', 'Metal'],
  ['rock', 'Rocha'],
  ['glass', 'Vidro'],
  ['grate', 'Grade (tiros de portal passam)'],
];
const num = (k, label, d, o = {}) => ({ k, label, t: 'num', d, ...o });
const sig = (k, label, d = '') => ({ k, label, t: 'sig', d });
const dir = (d) => ({ k: 'dir', label: 'Direção', t: 'select', o: DIRS, d });
const v3 = (k, label, d) => ({ k, label, t: 'v3', d });
/** tipo do cubo: comum, refletor de laser (o feixe sai pela face marcada) ou especial (coração) */
export const CUBE_KINDS = [
  ['normal', 'Comum'],
  ['laser', 'Redirecionamento de laser'],
  ['special', 'Especial (coração)'],
];
const cubeKind = { k: 'kind', label: 'Tipo de cubo', t: 'select', o: CUBE_KINDS, d: 'normal' };
const cubeOpts = (it) => ({ yaw: (it.yaw ?? 0) * D2R, laser: it.kind === 'laser', special: it.kind === 'special' });

/** caixa alinhada aos eixos a partir de centro/tamanho */
export const minmax = (it) => {
  const [x, y, z] = it.p;
  const [sx, sy, sz] = it.s;
  return [x - sx / 2, y - sy / 2, z - sz / 2, x + sx / 2, y + sy / 2, z + sz / 2];
};
/** quaternion de um item com `r` em graus (YXZ) */
export const quatOf = (it) => new THREE.Quaternion().setFromEuler(new THREE.Euler((it.r?.[0] ?? 0) * D2R, (it.r?.[1] ?? 0) * D2R, (it.r?.[2] ?? 0) * D2R, 'YXZ'));
/** caixa orientada de um item: { c, h (meia-medida), q } */
export function obbOf(it) {
  const T = ELEMENTS[it.type];
  if (T.shape === 'box') return { c: new THREE.Vector3(...it.p), h: new THREE.Vector3(it.s[0] / 2, it.s[1] / 2, it.s[2] / 2), q: T.rot === 'euler' ? quatOf(it) : new THREE.Quaternion() };
  const q = T.rot === 'yaw' ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (it.yaw ?? 0) * D2R) : new THREE.Quaternion();
  return { c: new THREE.Vector3(it.p[0], it.p[1] + (T.lift ?? 0), it.p[2]), h: new THREE.Vector3(T.hit[0] / 2, T.hit[1] / 2, T.hit[2] / 2), q };
}
const colorHex = (s, fallback = 0xfff4e6) => {
  const n = parseInt(String(s ?? '').replace('#', ''), 16);
  return Number.isFinite(n) ? n : fallback;
};

export const ELEMENTS = {
  // ------------------------------------------------------------------ estrutura
  block: {
    label: 'Bloco',
    group: 'Estrutura',
    color: 0x9fb4c8,
    shape: 'box',
    size: [4, 4, 4],
    params: [{ k: 'mat', label: 'Material', t: 'select', o: MATS, d: 'white' }, { k: 'portal', label: 'Aceita portal', t: 'bool', d: true }],
    build(w, it) {
      w.box(...minmax(it), it.mat, { noPortal: !it.portal });
    },
  },
  hazard: {
    label: 'Rocha fundida (mata)',
    group: 'Estrutura',
    color: 0xff6a20,
    shape: 'box',
    size: [6, 1, 6],
    build(w, it) {
      w.hazard(...minmax(it));
    },
  },
  ramp: {
    label: 'Rampa / bloco girado',
    group: 'Estrutura',
    color: 0x9fb4c8,
    shape: 'box',
    rot: 'euler',
    size: [4, 0.5, 6],
    params: [{ k: 'mat', label: 'Material', t: 'select', o: MATS.slice(0, 2), d: 'metal' }],
    build(w, it) {
      w.ramp(it.p[0], it.p[1], it.p[2], it.s[0], it.s[1], it.s[2], [(it.r[0] ?? 0) * D2R, (it.r[1] ?? 0) * D2R, (it.r[2] ?? 0) * D2R], it.mat);
    },
  },
  panel: {
    label: 'Painel diagonal (portal)',
    group: 'Estrutura',
    color: 0x8fe3ff,
    shape: 'box',
    rot: 'euler',
    size: [4, 5, 0.8],
    params: [num('stand', 'Coluna até o chão y (vazio = sem)', null, { step: 0.5 })],
    build(w, it) {
      const q = quatOf(it);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const at = new THREE.Vector3(...it.p).addScaledVector(n, it.s[2] / 2);
      w.panel(at.toArray(), n.toArray(), { w: it.s[0], h: it.s[1], t: it.s[2], up: u.toArray(), stand: Number.isFinite(it.stand) ? it.stand : null });
    },
  },
  strip: {
    label: 'Faixa de luz',
    group: 'Estrutura',
    color: 0x9fd8ff,
    shape: 'box',
    size: [2, 0.05, 0.1],
    params: [{ k: 'color', label: 'Cor', t: 'color', d: '#9fd8ff' }],
    build(w, it) {
      w.strip(...minmax(it), colorHex(it.color, 0x9fd8ff), 2);
    },
  },
  sign: {
    label: 'Placa de texto',
    group: 'Estrutura',
    place: 'wall',
    color: 0xf3f2ee,
    shape: 'point',
    rot: 'yaw',
    hit: [3.2, 1.6, 0.3],
    lift: 0,
    params: [{ k: 'text1', label: 'Título', t: 'text', d: 'CÂMARA' }, { k: 'text2', label: 'Subtítulo', t: 'text', d: 'meu nível' }],
    build(w, it) {
      w.sign(it.p[0], it.p[1], it.p[2], (it.yaw ?? 0) * D2R, [
        [it.text1 ?? '', 96, 190],
        [it.text2 ?? '', 56, 330, '#c0392b', 'Arial, sans-serif'],
      ]);
    },
  },

  // ------------------------------------------------------------------ mecanismos
  button: {
    label: 'Botão de piso',
    group: 'Mecanismos',
    place: 'floor',
    color: 0xff5a4a,
    shape: 'point',
    hit: [1.6, 0.4, 1.6],
    lift: 0.2,
    params: [sig('opens', 'Sinal que liga'), num('hold', 'Segue ligado após soltar (s)', 0, { min: 0, step: 0.5 })],
    build(w, it) {
      w.button(it.p[0], it.p[1], it.p[2], it.opens || null, { hold: it.hold || 0 });
    },
  },
  door: {
    label: 'Porta (célula inteira)',
    group: 'Mecanismos',
    place: 'face',
    color: 0xffb347,
    shape: 'box',
    size: [4, 4, 0.3],
    params: [
      sig('sig', 'Abre com o sinal', 'A'),
      { k: 'axis', label: 'Abre para', t: 'select', o: [['plain', 'Cima (porta comum)'], ['x', 'Lado X'], ['y', 'Cima/baixo (listrada)'], ['z', 'Lado Z']], d: 'plain' },
      num('dist', 'Curso (m)', 3.85, { min: 0.5, step: 0.5 }),
      num('speed', 'Velocidade', 1.4, { min: 0.2, step: 0.2 }),
      { k: 'latch', label: 'Fica aberta depois', t: 'bool', d: false },
    ],
    build(w, it) {
      const o = it.axis === 'plain' ? {} : { axis: it.axis, dist: it.dist };
      w.door(it.sig || null, ...minmax(it), { ...o, speed: it.speed, latch: it.latch });
    },
  },
  platform: {
    label: 'Plataforma (liga e vai)',
    group: 'Mecanismos',
    color: 0xffcc33,
    shape: 'box',
    size: [4, 0.4, 4],
    params: [
      sig('sig', 'Sinal', 'A'),
      { k: 'axis', label: 'Eixo', t: 'select', o: [['y', 'Vertical'], ['x', 'X'], ['z', 'Z']], d: 'y' },
      num('dist', 'Curso (m)', 4, { step: 0.5 }),
      num('speed', 'Velocidade (m/s)', 1.2, { min: 0.2, step: 0.2 }),
      num('loop', 'Vai e volta: espera (s, 0 = não)', 0, { min: 0, step: 0.5 }),
      { k: 'always', label: 'Sempre ligada', t: 'bool', d: false },
    ],
    build(w, it) {
      w.platform(it.sig || null, ...minmax(it), { axis: it.axis, dist: it.dist, speed: it.speed, loop: it.loop, always: it.always });
    },
  },
  mover: {
    label: 'Plataforma que vai e volta',
    group: 'Mecanismos',
    color: 0xffcc33,
    shape: 'box',
    size: [4, 0.4, 4],
    params: [
      v3('to', 'Deslocamento (x, y, z)', [0, 0, 10]),
      num('speed', 'Velocidade (m/s)', 3, { min: 0.2, step: 0.5 }),
      num('wait0', 'Espera no início (s)', 1, { min: 0, step: 0.5 }),
      num('wait1', 'Espera no fim (s)', 1, { min: 0, step: 0.5 }),
      num('phase', 'Fase (0 a 1)', 0, { min: 0, max: 1, step: 0.1 }),
      { k: 'crush', label: 'Esmaga (pistão)', t: 'bool', d: false },
    ],
    build(w, it) {
      w.mover(null, ...minmax(it), { to: it.to, speed: it.speed, waits: [it.wait0, it.wait1], phase: it.phase, crush: it.crush });
    },
  },
  fizzler: {
    label: 'Grade de desintegração',
    group: 'Mecanismos',
    place: 'face',
    color: 0x66d9ff,
    shape: 'box',
    size: [4, 4, 0.2],
    params: [
      sig('sig', 'Sinal do botão (vazio = sempre ligada)'),
      { k: 'mode', label: 'Quando o botão é apertado', t: 'select', o: [['off', 'Desativa a grade'], ['on', 'Ativa a grade']], d: 'off' },
    ],
    build(w, it) {
      w.fizzler(...minmax(it), { sig: it.sig || null, mode: it.mode });
    },
  },
  incinerator: {
    label: 'Fornalha',
    group: 'Mecanismos',
    color: 0xff7a2a,
    shape: 'box',
    size: [3, 2, 3],
    params: [sig('opens', 'Sinal que liga ao queimar')],
    build(w, it) {
      w.incinerator(...minmax(it), it.opens || null);
    },
  },

  // ------------------------------------------------------------------ energia e luz
  launcher: {
    label: 'Lançador de bola de energia',
    group: 'Energia e luz',
    place: 'wall',
    color: 0xffb347,
    shape: 'point',
    hit: [0.9, 0.9, 0.9],
    lift: 0,
    params: [dir('+x'), num('delay', 'Atraso (s)', 1, { min: 0, step: 0.5 }), num('life', 'Vida da bola (s)', 12, { min: 1 }), num('speed', 'Velocidade (m/s)', 6.5, { min: 1, step: 0.5 })],
    build(w, it) {
      w.launcher(it.p[0], it.p[1], it.p[2], dirVec(it.dir), { delay: it.delay, life: it.life, speed: it.speed });
    },
  },
  catcher: {
    label: 'Receptor de bola de energia',
    group: 'Energia e luz',
    place: 'wall',
    color: 0x6fc8ff,
    shape: 'point',
    hit: [0.9, 0.9, 0.9],
    lift: 0,
    params: [dir('-x'), sig('opens', 'Sinal que liga', 'A'), num('radius', 'Raio (m)', 0.8, { min: 0.3, step: 0.1 })],
    build(w, it) {
      w.catcher(it.p[0], it.p[1], it.p[2], dirVec(it.dir), it.opens || null, { radius: it.radius });
    },
  },
  laser: {
    label: 'Emissor de laser',
    group: 'Energia e luz',
    place: 'wall',
    color: 0xff3030,
    shape: 'point',
    hit: [0.9, 0.9, 0.9],
    lift: 0.1,
    params: [dir('+x'), sig('sig', 'Sinal que liga (vazio = sempre ligado)')],
    build(w, it) {
      w.laser(it.p[0], it.p[1], it.p[2], dirVec(it.dir), { sig: it.sig || null });
    },
  },
  laserCatcher: {
    label: 'Receptor de laser',
    group: 'Energia e luz',
    place: 'wall',
    color: 0xff9090,
    shape: 'point',
    hit: [0.9, 0.9, 0.9],
    lift: 0,
    params: [dir('-x'), sig('opens', 'Sinal que liga', 'A')],
    build(w, it) {
      w.laserCatcher(it.p[0], it.p[1], it.p[2], dirVec(it.dir), it.opens || null);
    },
  },
  light: {
    label: 'Luz',
    group: 'Energia e luz',
    place: 'ceiling',
    color: 0xfff4e6,
    shape: 'point',
    hit: [1.2, 0.4, 0.6],
    lift: 0,
    params: [num('intensity', 'Intensidade', 45, { min: 1, step: 5 }), { k: 'color', label: 'Cor', t: 'color', d: '#fff4e6' }, num('dist', 'Alcance (m)', 30, { min: 3 }), { k: 'fixture', label: 'Com luminária', t: 'bool', d: true }],
    build(w, it) {
      w.light(it.p[0], it.p[1], it.p[2], it.intensity, colorHex(it.color), it.dist, it.fixture);
    },
  },

  // ------------------------------------------------------------------ movimento
  plate: {
    label: 'Placa de lançamento',
    group: 'Movimento',
    place: 'floor',
    color: 0x66d9ff,
    shape: 'point',
    hit: [2.2, 0.4, 2.2],
    lift: 0.2,
    params: [
      { k: 'mode', label: 'Definir por', t: 'select', o: [['vel', 'Velocidade'], ['alvo', 'Ponto de pouso']], d: 'alvo' },
      v3('vel', 'Velocidade (x, y, z)', [0, 12, -6]),
      { ...v3('target', 'Pouso (x, y, z)', [0, 0, -12]), pick: 'alvo' }, // pick: dá para escolher no cenário (e põe mode = 'alvo')
      num('apex', 'Altura acima do mais alto (m)', 4, { min: 0.5, step: 0.5 }),
    ],
    build(w, it) {
      if (it.mode === 'alvo') w.faithPlateTo(it.p[0], it.p[1], it.p[2], ...it.target, it.apex);
      else w.faithPlate(it.p[0], it.p[1], it.p[2], it.vel);
    },
  },
  funnel: {
    label: 'Funil de excursão',
    group: 'Movimento',
    place: 'wall',
    color: 0x66d9ff,
    shape: 'point',
    hit: [1.2, 1.2, 1.2],
    lift: 0,
    params: [dir('+y'), num('speed', 'Velocidade (m/s)', 4, { min: 1, step: 0.5 }), sig('id', 'Inverte com o sinal'), sig('power', 'Só liga com o sinal'), { k: 'reversed', label: 'Começa invertido', t: 'bool', d: false }],
    build(w, it) {
      w.funnel(it.p[0], it.p[1], it.p[2], dirVec(it.dir), { id: it.id || null, power: it.power || null, reversed: it.reversed, speed: it.speed });
    },
  },
  gravzone: {
    label: 'Zona de gravidade',
    group: 'Movimento',
    color: 0xb06cff,
    shape: 'box',
    size: [8, 8, 8],
    params: [v3('g', 'Gravidade (x, y, z)', [0, 9.8, 0]), { k: 'color', label: 'Cor', t: 'color', d: '#b06cff' }],
    build(w, it) {
      w.gravZone(...minmax(it), it.g, colorHex(it.color, 0xb06cff));
    },
  },
  blackhole: {
    label: 'Buraco negro',
    group: 'Movimento',
    color: 0x7a3cff,
    shape: 'point',
    hit: [2.4, 2.4, 2.4],
    lift: 0,
    params: [num('strength', 'Força', 900, { min: 50, step: 50 }), num('horizon', 'Horizonte (m)', 1.2, { min: 0.3, step: 0.1 }), num('reach', 'Alcance (m)', 40, { min: 5 })],
    build(w, it) {
      w.blackHole(it.p[0], it.p[1], it.p[2], { strength: it.strength, horizon: it.horizon, reach: it.reach });
    },
  },

  // ------------------------------------------------------------------ objetos
  spawn: {
    label: 'Ponto de partida',
    group: 'Objetos',
    place: 'floor',
    color: 0x66ff99,
    shape: 'point',
    rot: 'yaw',
    hit: [0.8, 1.8, 0.8],
    lift: 0.9,
    unique: true,
    build(w, it, c) {
      c.data.spawn = [it.p[0], it.p[1], it.p[2], (it.yaw ?? 0) * D2R];
    },
  },
  exit: {
    label: 'Elevador de saída',
    group: 'Objetos',
    place: 'floor',
    color: 0x66ff99,
    shape: 'point',
    hit: [2.6, 3.4, 2.6],
    lift: 1.7,
    params: [{ k: 'flipped', label: 'De cabeça para baixo', t: 'bool', d: false }],
    build(w, it) {
      w.exitElevator(it.p[0], it.p[1], it.p[2], !!it.flipped);
    },
  },
  cube: {
    label: 'Cubo',
    group: 'Objetos',
    place: 'floor',
    color: 0xd9d9d9,
    shape: 'point',
    rot: 'yaw',
    hit: [0.7, 0.7, 0.7],
    lift: 0.35,
    params: [cubeKind],
    build(w, it, c) {
      c.data.cubes.push([it.p[0], it.p[1], it.p[2], cubeOpts(it)]);
    },
  },
  dispenser: {
    label: 'Dispensador de cubo',
    group: 'Objetos',
    place: 'ceiling',
    color: 0xcfe8ff,
    shape: 'point',
    rot: 'yaw',
    hit: [1.4, 2.4, 1.4],
    lift: -1.1,
    params: [cubeKind],
    build(w, it, c) {
      const [x, y, z] = w.dispenser(it.p[0], it.p[1], it.p[2]);
      c.data.cubes.push([x, y, z, cubeOpts(it)]);
    },
  },
  turret: {
    label: 'Torreta',
    group: 'Objetos',
    place: 'floor',
    color: 0xff5050,
    shape: 'point',
    rot: 'yaw',
    hit: [0.7, 1.4, 0.7],
    lift: 0.7,
    build(w, it, c) {
      c.data.turrets.push([it.p[0], it.p[1], it.p[2], (it.yaw ?? 0) * D2R]);
    },
  },
  pedestal: {
    label: 'Pedestal da arma de portais',
    group: 'Objetos',
    place: 'floor',
    color: 0xffd84a,
    shape: 'point',
    hit: [1.2, 1.9, 1.2],
    lift: 0.95,
    params: [{ k: 'gives', label: 'Entrega', t: 'select', o: [['blue', 'Só portal ciano'], ['both', 'Os dois portais']], d: 'both' }],
    build(w, it) {
      w.pedestal(it.p[0], it.p[1], it.p[2], it.gives, portalGun());
    },
  },
  portal: {
    label: 'Portal fixo',
    group: 'Objetos',
    place: 'wall',
    color: 0x3fa2ff,
    shape: 'point',
    hit: [1.4, 2.2, 0.4],
    lift: 0,
    params: [{ k: 'which', label: 'Cor', t: 'select', o: [['blue', 'Ciano'], ['orange', 'Vermelho']], d: 'blue' }, { ...dir('+z'), label: 'Aponta para' }],
    build(w, it, c) {
      const n = dirVec(it.dir);
      c.data.portals.push({ which: it.which, c: [...it.p], n, u: Math.abs(n[1]) > 0.5 ? [0, 0, -1] : [0, 1, 0] });
    },
  },
  crystal: {
    label: 'Cristal',
    group: 'Objetos',
    place: 'floor',
    color: 0xc77dff,
    shape: 'point',
    hit: [0.6, 0.8, 0.6],
    lift: 0.4,
    build(w, it, c) {
      c.data.crystals.push([it.p[0], it.p[1], it.p[2]]);
    },
  },
  trigger: {
    label: 'Gatilho de fala',
    group: 'Objetos',
    color: 0x99ccff,
    shape: 'box',
    size: [3, 2, 3],
    params: [{ k: 'who', label: 'Quem fala', t: 'text', d: 'Helena' }, { k: 'text', label: 'Fala', t: 'text', d: 'Bem-vindo ao meu nível.' }],
    build(w, it) {
      w.trigger(...minmax(it), { lines: [[it.who || 'Helena', it.text || '']] });
    },
  },
  dino: {
    label: 'Dinossauro',
    group: 'Objetos',
    place: 'floor',
    color: 0x8fd16f,
    shape: 'point',
    rot: 'yaw',
    hit: [1.2, 1.2, 1.2],
    lift: 0.6,
    params: [{ k: 'sp', label: 'Espécie', t: 'select', o: [['raptor', 'Raptor'], ['trice', 'Tricerátops'], ['ptero', 'Pterossauro']], d: 'raptor' }, num('scale', 'Tamanho', 0.6, { min: 0.1, step: 0.1 })],
    build(w, it, c) {
      c.data.dinos.push({ s: it.sp, scale: it.scale, x: it.p[0], y: it.p[1], z: it.p[2], rotY: (it.yaw ?? 0) * D2R });
    },
  },

  // ------------------------------------------------------------------ ambiente
  earth: {
    label: 'Terra no céu',
    group: 'Ambiente',
    color: 0x6fb0ff,
    shape: 'point',
    hit: [6, 6, 6],
    lift: 0,
    params: [num('r', 'Raio (m)', 70, { min: 5, step: 5 })],
    build(w, it) {
      w.earth(it.p[0], it.p[1], it.p[2], it.r);
    },
  },
  stars: {
    label: 'Céu estrelado',
    group: 'Ambiente',
    color: 0xffffff,
    shape: 'point',
    hit: [2, 2, 2],
    lift: 0,
    unique: true,
    params: [num('radius', 'Raio (m)', 900, { min: 100, step: 100 }), num('n', 'Estrelas', 3000, { min: 200, step: 200 })],
    build(w, it) {
      w.stars(it.p, it.radius, it.n);
    },
  },
};

export const typesByGroup = () => GROUPS.map((g) => [g, Object.entries(ELEMENTS).filter(([, T]) => T.group === g)]);
