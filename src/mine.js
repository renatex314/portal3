// Cena "mina": canteiro do (fictício) Projeto Antípoda, no Quadrilátero
// Ferrífero (MG). Cava a céu aberto em bancadas, poço vertical com torre de
// extração, sonda com trado, guindaste, escavadeiras, caminhões, ventilação,
// geradores, escritório, a cozinha da Dona Cida e a equipe — com entrevistas.
// Escala: 1 unidade = 1 metro. Centro do poço na origem; fundo da cava em y = −18.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, noise2 } from './noise.js';
import { GLSL_NOISE } from './noise.js';
import { PEOPLE } from './documentary.js';

const FLOOR_Y = -18;
const FLOOR_R = 22;
const STEP_H = 6;
const FACE_W = 3;
const BENCH_W = 8;
const N_STEPS = 3;
export const SHAFT_R = 5;
const RIM_R = FLOOR_R + N_STEPS * FACE_W + (N_STEPS - 1) * BENCH_W; // 47
const ROAD_R = 52;
const SHAFT_LEN = 520;

let seed = 99;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const ss = THREE.MathUtils.smoothstep;

function pitY(r) {
  let y = FLOOR_Y;
  let edge = FLOOR_R;
  for (let k = 0; k < N_STEPS; k++) {
    if (r < edge) return y;
    if (r < edge + FACE_W) return y + STEP_H * ss(r, edge, edge + FACE_W);
    y += STEP_H;
    edge += FACE_W + BENCH_W;
  }
  return 0;
}
function onFace(r) {
  let edge = FLOOR_R;
  for (let k = 0; k < N_STEPS; k++) {
    if (r >= edge - 0.3 && r < edge + FACE_W + 0.3) return true;
    edge += FACE_W + BENCH_W;
  }
  return false;
}

export function groundY(x, z) {
  const r = Math.hypot(x, z);
  let y = pitY(r);
  if (r > RIM_R) {
    const hills = Math.max((fbm2(x * 0.0035 + 7, z * 0.0035 - 3, 5) - 0.36) * 110, -4);
    y += hills * ss(r, 85, 300);
    const m = fbm2(x * 0.0011 + 2, z * 0.0011 + 9, 4);
    y += m * m * 520 * ss(r, 700, 1700);
  }
  y += (noise2(x * 0.6, z * 0.6) - 0.5) * (onFace(r) ? 0.5 : 0.12);
  return y;
}

// ------------------------------------------------------------------ helpers de geometria
const _up = new THREE.Vector3(0, 1, 0);
function beam(a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function lattice(height, w, segs, t = 0.12) {
  // mastro treliçado vertical, base em y=0, seção quadrada w×w
  const g = [];
  const c = [V(-w / 2, 0, -w / 2), V(w / 2, 0, -w / 2), V(w / 2, 0, w / 2), V(-w / 2, 0, w / 2)];
  for (const p of c) g.push(beam(p, p.clone().setY(height), t * 1.4));
  const dh = height / segs;
  for (let s = 0; s <= segs; s++) {
    for (let i = 0; i < 4; i++) {
      const a = c[i].clone().setY(s * dh);
      const b = c[(i + 1) % 4].clone().setY(s * dh);
      g.push(beam(a, b, t));
      if (s < segs) g.push(beam(a, c[(i + 1) % 4].clone().setY((s + 1) * dh), t * 0.8));
    }
  }
  return mergeGeometries(g);
}

function helicoid(len, turns, rIn, rOut, steps = 600) {
  // a "rosca" do trado: superfície helicoidal
  const pos = [];
  const idx = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const y = -t * len;
    pos.push(Math.cos(a) * rIn, y, Math.sin(a) * rIn, Math.cos(a) * rOut, y - 0.05, Math.sin(a) * rOut);
    if (i < steps) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function softTex(color = '255,255,255') {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${color},0.9)`);
    gr.addColorStop(0.4, `rgba(${color},0.45)`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  });
}

const M = {
  yellow: new THREE.MeshStandardMaterial({ color: 0xe3a51a, roughness: 0.55, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x26272a, roughness: 0.8 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8b929b, roughness: 0.45, metalness: 0.7 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x7a3f24, roughness: 0.75, metalness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.1, metalness: 0.8 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.5 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x8e3c1c, roughness: 1 }),
  hose: new THREE.MeshStandardMaterial({ color: 0xb8662e, roughness: 0.7 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.95 }),
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 3) }),
};

function mesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ pessoas
const PROP = {
  pickaxe() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6).translate(0, -0.3, 0), M.rust));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.04).translate(0, -0.72, 0), M.steel));
    return g;
  },
  thermos() {
    return mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12).translate(0, -0.08, 0.03), M.steel);
  },
  tablet() {
    const m = mesh(new THREE.BoxGeometry(0.26, 0.18, 0.015), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x2a6fb0, emissiveIntensity: 0.6 }));
    m.position.set(0, -0.05, 0.06);
    m.rotation.x = -0.9;
    return m;
  },
  radio() {
    return mesh(new THREE.BoxGeometry(0.06, 0.14, 0.035).translate(0, -0.05, 0.02), M.dark);
  },
  hammer() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 6).translate(0, -0.12, 0), M.rust));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.035, 0.035).translate(0, -0.28, 0), M.steel));
    return g;
  },
};

export function makeWorker(look = {}, pose = 'idle') {
  if (!SOFT) SOFT = softTex();
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
  const skin = mat(look.skin ?? 0xb07a52, { roughness: 0.65 });
  const shirt = mat(look.shirt ?? 0x7d7462);
  const pants = mat(look.pants ?? 0x4a443a);
  const boots = mat(0x2a221c);
  const dark = mat(0x1a1410);
  const hairM = mat(look.hair ?? 0x1a1410);
  const g = new THREE.Group();
  const P = { pose };

  // pernas
  P.legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 0.92, 0);
    hip.add(mesh(new THREE.CapsuleGeometry(0.078, 0.34, 4, 10).translate(0, -0.22, 0), pants));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    knee.add(mesh(new THREE.CapsuleGeometry(0.068, 0.32, 4, 10).translate(0, -0.2, 0), pants));
    knee.add(mesh(new THREE.BoxGeometry(0.13, 0.13, 0.27).translate(0, -0.42, 0.04), boots)); // bota
    hip.add(knee);
    g.add(hip);
    P.legs.push({ hip, knee });
  }

  // tronco
  const torso = new THREE.Group();
  torso.position.y = 0.92;
  g.add(torso);
  P.torso = torso;
  torso.add(mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.16, 16).translate(0, 0.04, 0), pants));
  torso.add(mesh(new THREE.BoxGeometry(0.36, 0.04, 0.24).translate(0, 0.12, 0), dark)); // cinto
  torso.add(mesh(new THREE.CapsuleGeometry(0.175, 0.26, 6, 16).scale(1.08, 1, 0.78).translate(0, 0.32, 0), shirt));
  if (look.vest) {
    const refl = new THREE.MeshStandardMaterial({ color: 0xd8d8c0, emissive: 0x6a6a50, roughness: 0.3 });
    for (const y of [0.24, 0.38])
      torso.add(mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.035, 20, 1, true).scale(1, 1, 0.8).translate(0, y, 0), refl, false));
  }
  if (look.apron) torso.add(mesh(new THREE.BoxGeometry(0.34, 0.55, 0.02).translate(0, 0.16, 0.15), mat(0xf0ece2)));
  if (look.backpack) torso.add(mesh(new THREE.BoxGeometry(0.3, 0.38, 0.16).translate(0, 0.32, -0.2), mat(0x6b5034)));

  // braços
  P.arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.215, 0.47, 0);
    sh.add(mesh(new THREE.CapsuleGeometry(0.058, 0.24, 4, 10).translate(0, -0.15, 0), shirt));
    const el = new THREE.Group();
    el.position.y = -0.31;
    el.add(mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 10).translate(0, -0.13, 0), look.longSleeve === false ? skin : shirt));
    const hand = new THREE.Group();
    hand.position.y = -0.29;
    hand.add(mesh(new THREE.SphereGeometry(0.052, 10, 8), mat(look.gloves ? 0x8a7a4a : look.skin ?? 0xb07a52)));
    el.add(hand);
    sh.add(el);
    torso.add(sh);
    P.arms.push({ sh, el, hand, side: s });
  }

  // cabeça
  const neck = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10).translate(0, 0.6, 0), skin);
  torso.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.73;
  torso.add(head);
  P.head = head;
  head.add(mesh(new THREE.SphereGeometry(0.108, 24, 18).scale(0.92, 1.1, 1), skin));
  head.add(mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(0.5, 1, 0.7).translate(-0.1, 0, 0), skin)); // orelhas
  head.add(mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(0.5, 1, 0.7).translate(0.1, 0, 0), skin));
  const eyeW = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3 });
  const eyeB = new THREE.MeshStandardMaterial({ color: 0x140d08, roughness: 0.2 });
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.016, 10, 8).scale(1.2, 0.8, 0.6).translate(s * 0.036, 0.018, 0.094), eyeW, false));
    head.add(mesh(new THREE.SphereGeometry(0.009, 8, 6).translate(s * 0.036, 0.018, 0.103), eyeB, false));
    head.add(mesh(new THREE.BoxGeometry(0.036, 0.009, 0.01).translate(s * 0.037, 0.045, 0.1).rotateZ(s * -0.08), look.grey ? mat(0xb8b2a8) : hairM, false));
  }
  head.add(mesh(new THREE.ConeGeometry(0.017, 0.045, 8).rotateX(Math.PI / 2).translate(0, -0.006, 0.112), skin, false)); // nariz
  const mouth = mesh(new THREE.BoxGeometry(0.042, 0.01, 0.01).translate(0, -0.05, 0.096), mat(0x5a2a22), false);
  head.add(mouth);
  P.mouth = mouth;
  const beardM = mat(look.grey ? 0xa8a29a : 0x241a12);
  if (look.mustache) head.add(mesh(new THREE.BoxGeometry(0.07, 0.016, 0.02).translate(0, -0.033, 0.101), beardM, false));
  if (look.beard) {
    const b = mesh(new THREE.TorusGeometry(0.075, 0.026, 8, 24, Math.PI).rotateX(Math.PI / 2), beardM, false);
    b.position.set(0, -0.06, 0.005);
    b.rotation.x = -0.25;
    head.add(b);
  }
  if (look.female || look.hair) {
    head.add(mesh(new THREE.SphereGeometry(0.114, 20, 14).scale(0.95, 1.08, 1).translate(0, 0.012, -0.018), hairM));
    head.add(mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8).rotateX(0.35).translate(0, -0.06, -0.12), hairM));
    if (!look.helmet) head.add(mesh(new THREE.SphereGeometry(0.05, 12, 10).translate(0, 0.1, -0.06), hairM)); // coque
  }
  if (look.helmet) {
    const hm = new THREE.MeshStandardMaterial({ color: look.helmet, roughness: 0.35 });
    head.add(mesh(new THREE.SphereGeometry(0.132, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.05, 1.08).translate(0, 0.035, 0), hm));
    head.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 24).scale(1, 1, 1.15).translate(0, 0.035, 0.015), hm));
    // lanterna do capacete
    head.add(mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.045, 12).rotateX(Math.PI / 2).translate(0, 0.09, 0.14), M.dark, false));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12).translate(0, 0.09, 0.1635), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 3.6) }));
    head.add(lens);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xfff2c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    glow.position.set(0, 0.09, 0.18);
    glow.scale.setScalar(0.22);
    head.add(glow);
  }

  // objetos na mão
  const propName = { pickaxe: 'pickaxe', thermos: 'thermos', tablet: 'tablet', radio: 'radio', hammer: 'hammer' }[pose];
  if (propName) {
    const prop = PROP[propName]();
    P.arms[1].hand.add(prop);
    P.prop = prop;
  }

  P.phase = Math.random() * 10;
  P.talking = false;
  P.lookAt = null; // ponto (mundo) para onde virar a cabeça
  g.userData.worker = P;
  return { group: g, P };
}
let SOFT;

export function poseWorker(w, t, dt) {
  const P = w.P;
  const tt = t + P.phase;
  const [L, Rr] = P.arms;
  const breathe = Math.sin(tt * 1.6) * 0.012;
  P.torso.scale.y = 1 + breathe;
  // braços relaxados por padrão
  const set = (arm, sx, sz, ex) => {
    arm.sh.rotation.set(sx, 0, sz);
    arm.el.rotation.set(ex, 0, 0);
  };
  set(L, 0.05, -0.12, -0.15);
  set(Rr, 0.05, 0.12, -0.15);
  P.torso.rotation.x = 0;
  for (const l of P.legs) {
    l.hip.rotation.x = 0;
    l.knee.rotation.x = 0;
  }
  const talkAmp = P.talking ? 1 : 0.25;
  switch (P.pose) {
    case 'gesture':
      set(L, -0.45 + Math.sin(tt * 2.1) * 0.25 * talkAmp, -0.25, -1.3 + Math.sin(tt * 2.7) * 0.35 * talkAmp);
      set(Rr, -0.5 + Math.sin(tt * 1.7 + 1) * 0.3 * talkAmp, 0.3, -1.2 + Math.sin(tt * 2.3) * 0.4 * talkAmp);
      break;
    case 'handsHips':
      set(L, 0.15, -0.65, -1.9);
      set(Rr, 0.15, 0.65, -1.9);
      L.el.rotation.set(-0.3, 0, 1.5);
      Rr.el.rotation.set(-0.3, 0, -1.5);
      if (P.talking) set(Rr, -0.4 + Math.sin(tt * 2) * 0.25, 0.25, -1.1 + Math.sin(tt * 2.6) * 0.3);
      break;
    case 'pointing':
      set(Rr, -1.25 + Math.sin(tt * 0.7) * 0.08, 0.15, -0.1);
      if (P.talking) set(L, -0.45 + Math.sin(tt * 2.2) * 0.2, -0.25, -1.2 + Math.sin(tt * 2.8) * 0.3);
      break;
    case 'thermos':
      set(Rr, -0.45, 0.2, -1.45);
      if (P.talking) set(L, -0.4 + Math.sin(tt * 2) * 0.2, -0.3, -1.25 + Math.sin(tt * 2.6) * 0.3);
      break;
    case 'tablet':
      set(L, -0.35, -0.1, -1.25);
      set(Rr, -0.35, 0.1, -1.25);
      if (P.talking) set(L, -0.5 + Math.sin(tt * 2) * 0.25, -0.3, -1.2 + Math.sin(tt * 2.5) * 0.35);
      break;
    case 'radio':
      set(Rr, -0.75, -0.25, -2.05);
      if (P.talking) set(L, -0.45 + Math.sin(tt * 2) * 0.25, -0.25, -1.2 + Math.sin(tt * 2.6) * 0.3);
      break;
    case 'hammer':
      set(Rr, 0.05, 0.15, -0.35);
      if (P.talking) set(L, -0.5 + Math.sin(tt * 2.1) * 0.25, -0.3, -1.25 + Math.sin(tt * 2.7) * 0.35);
      break;
    case 'pickaxe': {
      const c = (Math.sin(tt * 1.6) + 1) / 2; // 0 = embaixo, 1 = em cima
      const k = Math.pow(c, 0.6);
      set(L, -0.4 - k * 2.2, -0.05, -0.4 - (1 - k) * 0.5);
      set(Rr, -0.4 - k * 2.2, 0.05, -0.4 - (1 - k) * 0.5);
      P.torso.rotation.x = 0.35 * (1 - k);
      break;
    }
    case 'walk': {
      const s = Math.sin(tt * 5);
      P.legs[0].hip.rotation.x = s * 0.45;
      P.legs[1].hip.rotation.x = -s * 0.45;
      P.legs[0].knee.rotation.x = Math.max(0, -s) * 0.6;
      P.legs[1].knee.rotation.x = Math.max(0, s) * 0.6;
      set(L, -s * 0.35, -0.1, -0.25);
      set(Rr, s * 0.35, 0.1, -0.25);
      break;
    }
    default:
      if (P.talking) set(Rr, -0.45 + Math.sin(tt * 2) * 0.25, 0.25, -1.2 + Math.sin(tt * 2.6) * 0.35);
  }
  // boca e cabeça
  P.mouth.scale.y = P.talking ? 1 + Math.abs(noise2(tt * 9, 3.3) - 0.35) * 9 : 1;
  P.head.rotation.x = Math.sin(tt * 0.7) * 0.04 + (P.talking ? Math.sin(tt * 3.1) * 0.05 : 0);
  let yaw = Math.sin(tt * 0.31) * 0.15;
  if (P.lookAt) {
    const local = w.group.worldToLocal(P.lookAt.clone());
    yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.7, 0.7);
  }
  P.head.rotation.y = THREE.MathUtils.lerp(P.head.rotation.y, yaw, 1 - Math.exp(-dt * 3));
}

// ------------------------------------------------------------------ máquinas
function makeExcavator() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.85, 4.4).translate(s * 1.3, 0.43, 0), M.dark));
    g.add(mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.8, 16).rotateZ(Math.PI / 2).translate(s * 1.3, 0.43, 2.2), M.dark));
    g.add(mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.8, 16).rotateZ(Math.PI / 2).translate(s * 1.3, 0.43, -2.2), M.dark));
  }
  const upper = new THREE.Group();
  upper.position.y = 1.0;
  g.add(upper);
  upper.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.25, 24).translate(0, 0.1, 0), M.dark));
  upper.add(mesh(new THREE.BoxGeometry(2.8, 1.1, 3.0).translate(0.1, 0.8, -0.4), M.yellow));
  upper.add(mesh(new THREE.BoxGeometry(2.6, 0.9, 0.7).translate(0.1, 0.9, -2.0), M.dark)); // contrapeso
  upper.add(mesh(new THREE.BoxGeometry(1.0, 1.5, 1.3).translate(-0.85, 1.85, 0.6), M.yellow)); // cabine
  upper.add(mesh(new THREE.BoxGeometry(0.92, 1.0, 1.32).translate(-0.85, 2.0, 0.6), M.glass, false));
  upper.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8).translate(0.9, 1.75, -1.3), M.dark));
  const boom = new THREE.Group();
  boom.position.set(0.35, 1.2, 0.9);
  upper.add(boom);
  boom.add(mesh(new THREE.BoxGeometry(0.5, 0.6, 4.6).translate(0, 0, 2.3), M.yellow));
  const stick = new THREE.Group();
  stick.position.z = 4.6;
  boom.add(stick);
  stick.add(mesh(new THREE.BoxGeometry(0.38, 0.45, 3.1).translate(0, 0, 1.55), M.yellow));
  const bucket = new THREE.Group();
  bucket.position.z = 3.1;
  stick.add(bucket);
  bucket.add(mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8).translate(0, -0.2, 0.35), M.dark));
  for (let i = -2; i <= 2; i++) bucket.add(mesh(new THREE.ConeGeometry(0.06, 0.2, 6).rotateX(Math.PI / 2).translate(i * 0.24, -0.6, 0.8), M.steel, false));
  g.userData = { upper, boom, stick, bucket, phase: Math.random() * 10 };
  return g;
}
function animExcavator(ex, t) {
  const { upper, boom, stick, bucket, phase } = ex.userData;
  const c = t * 0.35 + phase;
  const k = (Math.sin(c) + 1) / 2;
  upper.rotation.y = Math.sin(c * 0.5) * 0.9;
  boom.rotation.x = -0.55 + k * 0.55;
  stick.rotation.x = 0.9 + (1 - k) * 0.8;
  bucket.rotation.x = 0.4 + k * 1.1;
}

function makeTruck(cabColor = 0xe9e9e6) {
  const g = new THREE.Group();
  const cab = new THREE.MeshStandardMaterial({ color: cabColor, roughness: 0.5 });
  g.add(mesh(new THREE.BoxGeometry(2.4, 0.5, 7.2).translate(0, 1.15, 0), M.dark));
  g.add(mesh(new THREE.BoxGeometry(2.5, 1.7, 1.8).translate(0, 2.1, 2.7), cab));
  g.add(mesh(new THREE.BoxGeometry(2.3, 0.8, 0.05).translate(0, 2.5, 3.62), M.glass, false));
  const bed = new THREE.Group();
  bed.position.set(0, 1.45, -1.0);
  bed.add(mesh(new THREE.BoxGeometry(2.6, 0.12, 4.6).translate(0, 0, 0), M.yellow));
  bed.add(mesh(new THREE.BoxGeometry(0.12, 1.3, 4.6).translate(-1.24, 0.65, 0), M.yellow));
  bed.add(mesh(new THREE.BoxGeometry(0.12, 1.3, 4.6).translate(1.24, 0.65, 0), M.yellow));
  bed.add(mesh(new THREE.BoxGeometry(2.6, 1.6, 0.12).translate(0, 0.8, 2.25), M.yellow));
  bed.add(mesh(new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.75, 0.55, 1.3).translate(0, 0.9, -0.1), M.soil));
  g.add(bed);
  const wheels = [];
  for (const z of [2.5, -1.4, -2.8])
    for (const s of [-1, 1]) {
      const w = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 18).rotateZ(Math.PI / 2), M.dark);
      w.position.set(s * 1.2, 0.62, z);
      g.add(w);
      wheels.push(w);
    }
  g.userData.wheels = wheels;
  return g;
}

function makeDrillRig() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.9, 0.9, 5).translate(s * 1.4, 0.45, 0), M.dark));
  g.add(mesh(new THREE.BoxGeometry(3.4, 1.3, 4).translate(0, 1.5, -0.4), M.yellow));
  g.add(mesh(new THREE.BoxGeometry(1.2, 1.5, 1.3).translate(-1.0, 2.8, -0.6), M.yellow));
  g.add(mesh(new THREE.BoxGeometry(1.1, 1.0, 1.32).translate(-1.0, 3.0, -0.6), M.glass, false));
  const mast = mesh(lattice(19, 0.9, 16, 0.09), M.yellow);
  mast.position.set(0, 2.1, 2.2);
  g.add(mast);
  const head = mesh(new THREE.BoxGeometry(1.2, 1.1, 1.0).translate(0, 0, 0.85), M.dark);
  head.position.set(0, 15.5, 2.2);
  g.add(head);
  const auger = new THREE.Group();
  auger.position.set(0, 15, 3.05);
  auger.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 13.5, 10).translate(0, -6.75, 0), M.rust));
  const flight = new THREE.Mesh(helicoid(12.5, 15, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x6e3a22, roughness: 0.7, metalness: 0.5, side: THREE.DoubleSide }));
  flight.castShadow = true;
  flight.position.y = -0.8;
  auger.add(flight);
  g.add(auger);
  g.userData = { auger, head };
  return g;
}

function makeCrane(boomLen = 30, angle = 0.95) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(1.0, 1.0, 6).translate(s * 1.7, 0.5, 0), M.dark));
  const upper = new THREE.Group();
  upper.position.y = 1.0;
  g.add(upper);
  upper.add(mesh(new THREE.BoxGeometry(3.4, 1.8, 4.6).translate(0, 1.0, -0.8), M.yellow));
  upper.add(mesh(new THREE.BoxGeometry(1.1, 1.5, 1.4).translate(-1.4, 2.3, 1.0), M.yellow));
  upper.add(mesh(new THREE.BoxGeometry(1.0, 0.9, 1.42).translate(-1.4, 2.5, 1.0), M.glass, false));
  const boom = new THREE.Group();
  boom.position.set(0, 1.6, 1.5);
  boom.rotation.x = -angle; // eleva a lança
  upper.add(boom);
  const lat = mesh(lattice(boomLen, 1.1, 22, 0.08), M.rust);
  lat.rotation.x = Math.PI / 2;
  boom.add(lat);
  const tip = new THREE.Object3D();
  tip.position.set(0, 0, boomLen);
  boom.add(tip);
  // mastro de contra-lança (A-frame)
  upper.add(mesh(beam(V(0, 2, -2.5), V(0, 7, -0.5), 0.2), M.rust));
  const hook = new THREE.Group();
  hook.add(mesh(new THREE.BoxGeometry(0.5, 0.8, 0.35), M.rust));
  const auger = new THREE.Group();
  auger.position.y = -0.5;
  auger.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.5, 8).translate(0, -3.25, 0), M.rust));
  const fl = new THREE.Mesh(helicoid(5.6, 7, 0.1, 0.45), new THREE.MeshStandardMaterial({ color: 0x6a3420, roughness: 0.7, metalness: 0.5, side: THREE.DoubleSide }));
  fl.position.y = -0.6;
  auger.add(fl);
  hook.add(auger);
  const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: 0x222222 }));
  g.userData = { upper, tip, hook, cable, auger };
  return g;
}

function makeHeadframe() {
  const g = new THREE.Group();
  const H = 22;
  const geos = [];
  const base = 4.4;
  const top = 1.7;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (c, y) => {
    const k = y / H;
    const w = base + (top - base) * k;
    return V(c[0] * w, y, c[1] * w);
  };
  for (const c of corners) geos.push(beam(at(c, 0), at(c, H), 0.32));
  for (let y = 0; y <= H; y += 5.5) {
    for (let i = 0; i < 4; i++) {
      geos.push(beam(at(corners[i], y), at(corners[(i + 1) % 4], y), 0.2));
      if (y + 5.5 <= H) geos.push(beam(at(corners[i], y), at(corners[(i + 1) % 4], y + 5.5), 0.14));
    }
  }
  // pernas de apoio inclinadas, na direção do guincho (+x, +z)
  const dir = V(0.88, 0, 0.48).normalize();
  const side = V(-dir.z, 0, dir.x);
  for (const s of [-1, 1]) {
    const foot = dir.clone().multiplyScalar(13).add(side.clone().multiplyScalar(s * 2.2));
    geos.push(beam(foot, V(dir.x * 1.5 + side.x * s * 1.2, H - 1, dir.z * 1.5 + side.z * s * 1.2), 0.36));
  }
  const frame = mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: 0x3f5d72, roughness: 0.6, metalness: 0.5 }));
  g.add(frame);
  g.add(mesh(new THREE.BoxGeometry(4.2, 0.4, 4.2).translate(0, H + 0.2, 0), M.steel));
  // polias
  const sheaves = [];
  for (const z of [-0.8, 0.8]) {
    const w = new THREE.Group();
    w.position.set(0, H + 1.8, z);
    w.add(mesh(new THREE.TorusGeometry(1.4, 0.1, 8, 40), M.rust));
    for (let i = 0; i < 6; i++) w.add(mesh(new THREE.BoxGeometry(2.7, 0.08, 0.08).rotateZ((i / 6) * Math.PI), M.rust));
    w.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12).rotateX(Math.PI / 2), M.steel));
    w.rotation.y = Math.atan2(-dir.z, dir.x) * 0; // plano XY
    g.add(w);
    sheaves.push(w);
  }
  g.add(mesh(new THREE.BoxGeometry(0.3, 1.8, 2.4).translate(0, H + 1.1, 0), M.steel));
  g.userData = { sheaves, H };
  return g;
}

function makeBuilding(w, h, d, color, roofColor = 0x7d8288) {
  const g = new THREE.Group();
  const wallTex = canvasTex(256, 128, (x, W, Hh) => {
    x.fillStyle = '#' + new THREE.Color(color).getHexString();
    x.fillRect(0, 0, W, Hh);
    for (let i = 0; i < W; i += 8) {
      x.fillStyle = i % 16 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
      x.fillRect(i, 0, 4, Hh);
    }
    x.fillStyle = 'rgba(120,50,20,0.25)';
    x.fillRect(0, Hh - 18, W, 18);
  });
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(w / 4, 1);
  g.add(mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.2 })));
  g.add(mesh(new THREE.BoxGeometry(w + 0.4, 0.2, d + 0.4).translate(0, h + 0.1, 0), new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.6, metalness: 0.4 })));
  return g;
}

function signTex(lines, bg = '#f2f0ea', fg = '#1b1b1b', w = 1024, h = 300) {
  return canvasTex(w, h, (x) => {
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = fg;
    x.lineWidth = 10;
    x.strokeRect(10, 10, w - 20, h - 20);
    x.fillStyle = fg;
    x.textAlign = 'center';
    lines.forEach(([txt, size, y, font = 'Arial Black, Impact, sans-serif']) => {
      x.font = `bold ${size}px ${font}`;
      x.fillText(txt, w / 2, y);
    });
  });
}

// ------------------------------------------------------------------ cena
export class MineScene {
  constructor() {
    SOFT = softTex();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfcbd8, 220, 2600);
    this.anchors = {};
    this.workers = {};
    this.extras = [];
    this.trucks = [];
    this.excavators = [];
    this.smoke = [];
    this.time = 0;
    this.descent = { on: false, depth: 0, speed: 0 };

    this._sky();
    this._lights();
    this._terrain();
    this._shaft();
    this._headframe();
    this._machines();
    this._site();
    this._trees();
    this._people();
    this._particles();
    this._cage();
  }

  _sky() {
    const sun = new THREE.Vector3(-0.45, 0.62, 0.55).normalize();
    this.sunDir = sun;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(5000, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: sun } },
        vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun; varying vec3 vD;
          void main(){
            float h = max(vD.y, 0.0);
            vec3 c = mix(vec3(0.62,0.72,0.82), vec3(0.16,0.38,0.74), pow(h, 0.4));
            float s = max(dot(vD, uSun), 0.0);
            c += vec3(1.0,0.9,0.7) * pow(s, 10.0) * 0.25 + vec3(1.0) * pow(s, 800.0) * 5.0;
            if (vD.y < 0.0) c = vec3(0.55,0.6,0.62);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.scene.add(sky);
    // nuvens
    const cloudTex = canvasTex(256, 128, (g, w, h) => {
      for (let i = 0; i < 26; i++) {
        const x = 40 + Math.random() * (w - 80);
        const y = 50 + Math.random() * 40;
        const r = 18 + Math.random() * 30;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.75)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }
    });
    for (let i = 0; i < 34; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }));
      const a = rnd() * Math.PI * 2;
      const r = 500 + rnd() * 2200;
      sp.position.set(Math.cos(a) * r, 380 + rnd() * 420, Math.sin(a) * r);
      sp.scale.set(500 + rnd() * 600, 180 + rnd() * 160, 1);
      this.scene.add(sp);
    }
  }

  _lights() {
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
    sun.position.copy(this.sunDir).multiplyScalar(150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const c = sun.shadow.camera;
    c.left = c.bottom = -85;
    c.right = c.top = 85;
    c.near = 10;
    c.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x7a4630, 1.0));
  }

  _terrain() {
    const radii = [];
    for (let r = SHAFT_R; r < 70; r += 0.5) radii.push(r);
    for (let r = 70; r < 2800; r *= 1.045) radii.push(r);
    const nA = 288;
    const pos = [];
    const col = [];
    const idx = [];
    const c = new THREE.Color();
    const C = (h) => new THREE.Color(h);
    const laterite = C(0x9a3c1a);
    const laterite2 = C(0xb5532a);
    const floor = C(0x7a4a36);
    const hem = C(0x3f3c42);
    const ochre = C(0xa04a22);
    const road = C(0xb06a42);
    const grass = C(0x5d6b2a);
    const dry = C(0xa59650);
    const far = C(0x5f7360);
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i];
      for (let j = 0; j < nA; j++) {
        const a = (j / nA) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = i === 0 ? FLOOR_Y : groundY(x, z);
        pos.push(x, y, z);
        const n = fbm2(x * 0.08, z * 0.08, 3);
        if (r < FLOOR_R) {
          c.copy(floor).lerp(laterite, n * 0.6);
          if (r < SHAFT_R + 1.5) c.lerp(C(0x8c8a84), 0.5);
        } else if (onFace(r)) {
          // itabirito bandado na parede das bancadas
          const band = 0.5 + 0.5 * Math.sin(y * 5.2 + n * 4 + Math.sin(a * 3) * 0.6);
          c.copy(ochre).lerp(hem, Math.pow(band, 1.5));
        } else if (r < RIM_R + 2) {
          c.copy(laterite).lerp(laterite2, n);
        } else if (Math.abs(r - ROAD_R) < 4) {
          c.copy(road).lerp(laterite, n * 0.5);
        } else if (r < 110) {
          c.copy(laterite2).lerp(grass, ss(r, 70, 110) * (0.4 + n * 0.6));
        } else {
          c.copy(grass).lerp(dry, fbm2(x * 0.01, z * 0.01, 3));
          if (y > 40) c.lerp(far, 0.4);
          c.lerp(laterite, 0.12 * (1 - n));
        }
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < radii.length - 1; i++)
      for (let j = 0; j < nA; j++) {
        const a = i * nA + j;
        const b = i * nA + ((j + 1) % nA);
        const c2 = (i + 1) * nA + j;
        const d = (i + 1) * nA + ((j + 1) % nA);
        idx.push(a, b, c2, b, d, c2);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const t = mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), false);
    this.scene.add(t);
    this.anchors.benches = V(-30, -7, -28);
  }

  _shaft() {
    // parede do poço: rocha conforme a profundidade "virtual", luzes a cada 100 m
    this.shaftU = {
      uShift: { value: 0 },
      uLamp: { value: new THREE.Vector3(0, -1000, 0) },
      uLampOn: { value: 0 },
      uSpeed: { value: 0 },
      uTime: { value: 0 },
    };
    const geo = new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, SHAFT_LEN, 72, 260, true).translate(0, FLOOR_Y - SHAFT_LEN / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shaftU,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        uniform float uShift;
        ${GLSL_NOISE}
        void main(){
          vec3 p = position;
          float depth = uShift + (${FLOOR_Y.toFixed(1)} - p.y);
          float a = atan(p.z, p.x);
          // irregularidade da parede (escavada a fogo)
          float n = vnoise(vec3(cos(a) * 3.0, depth * 0.35, sin(a) * 3.0));
          p.xz *= 1.0 + (n - 0.5) * 0.08;
          vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uShift, uLampOn, uSpeed, uTime; uniform vec3 uLamp;
        varying vec3 vW;
        ${GLSL_NOISE}
        vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
        void main(){
          float realDepth = ${FLOOR_Y.toFixed(1)} - vW.y;
          float depth = uShift + realDepth;
          float a = atan(vW.z, vW.x);
          float blur = 1.0 / (1.0 + uSpeed * 0.06);
          vec3 p = vec3(cos(a) * 4.0, depth * 0.6 * blur, sin(a) * 4.0);
          float n = fbm3(p);
          float f = vnoise(p * 4.0);
          vec3 lat = mix(vec3(0.55,0.20,0.09), vec3(0.70,0.30,0.14), n);
          vec3 sap = mix(vec3(0.78,0.55,0.38), vec3(0.88,0.75,0.62), f) * (0.85 + 0.3 * n);
          float band = 0.5 + 0.5 * sin(depth * 7.0 * blur + n * 5.0);
          vec3 ita = mix(vec3(0.20,0.20,0.23), vec3(0.55,0.20,0.10), smoothstep(0.3, 0.7, band));
          float fol = 0.5 + 0.5 * sin((depth * 2.0 + a * 6.0) * blur + n * 3.0);
          vec3 xis = mix(vec3(0.36,0.42,0.36), vec3(0.50,0.54,0.48), fol);
          vec3 qtz = mix(vec3(0.82,0.78,0.68), vec3(0.92,0.90,0.84), f);
          float spk = step(0.8, vnoise(p * 9.0));
          float spk2 = step(0.9, vnoise(p * 11.0 + 5.0));
          vec3 gra = mix(vec3(0.42,0.42,0.44), vec3(0.62,0.50,0.46), spk);
          gra = mix(gra, vec3(0.08), spk2);
          vec3 rock = lat;
          rock = mix(rock, sap, smoothstep(26.0, 34.0, depth));
          rock = mix(rock, ita, smoothstep(112.0, 128.0, depth));
          rock = mix(rock, xis, smoothstep(580.0, 620.0, depth));
          rock = mix(rock, qtz, smoothstep(1470.0, 1530.0, depth));
          rock = mix(rock, gra, smoothstep(2470.0, 2530.0, depth));
          rock = lin(rock) * (0.75 + 0.5 * f);
          // concreto projetado nos primeiros metros do poço
          rock = mix(rock, lin(vec3(0.55,0.53,0.5)) * (0.8 + 0.4 * f), 1.0 - smoothstep(6.0, 8.0, realDepth));

          float sky = exp(-realDepth / 9.0) * 0.9;
          float d = length(vW - uLamp);
          float lamp = uLampOn * 2.6 / (1.0 + d * d * 0.1);
          float dm = abs(mod(depth + 50.0, 100.0) - 50.0);
          float wash = exp(-dm * 0.09) * 0.45;
          vec3 col = rock * (0.012 + sky + lamp + wash);
          col += vec3(1.0,0.85,0.6) * exp(-dm * 1.6) * 3.0 * step(fract(a * 3.0 / 3.14159), 0.12);
          // calor no fundo: brilho avermelhado na rocha muito funda
          col += rock * vec3(0.4,0.08,0.0) * smoothstep(3000.0, 4200.0, depth) * 0.5;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    this.shaft = new THREE.Mesh(geo, mat);
    this.scene.add(this.shaft);
    // anel de concreto na boca do poço
    const collar = mesh(new THREE.CylinderGeometry(SHAFT_R + 0.9, SHAFT_R + 0.9, 0.8, 64, 1, true).translate(0, FLOOR_Y + 0.25, 0), M.concrete);
    collar.material = M.concrete.clone();
    collar.material.side = THREE.DoubleSide;
    this.scene.add(collar);
    this.scene.add(mesh(new THREE.RingGeometry(SHAFT_R, SHAFT_R + 0.9, 64).rotateX(-Math.PI / 2).translate(0, FLOOR_Y + 0.65, 0), M.concrete));
    // guarda-corpo
    const rail = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      if (a > 0.2 && a < 0.75) continue; // passagem
      const p = V(Math.cos(a) * (SHAFT_R + 0.6), FLOOR_Y + 0.65, Math.sin(a) * (SHAFT_R + 0.6));
      rail.push(beam(p, p.clone().setY(FLOOR_Y + 1.75), 0.06));
      const a2 = ((i + 1) / 28) * Math.PI * 2;
      const p2 = V(Math.cos(a2) * (SHAFT_R + 0.6), FLOOR_Y + 1.7, Math.sin(a2) * (SHAFT_R + 0.6));
      rail.push(beam(p.clone().setY(FLOOR_Y + 1.7), p2, 0.05));
    }
    this.scene.add(mesh(mergeGeometries(rail), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 })));
    // escadas na parede
    for (const a of [2.2, 4.1]) {
      const lad = [];
      const cx = Math.cos(a) * (SHAFT_R - 0.25);
      const cz = Math.sin(a) * (SHAFT_R - 0.25);
      const t = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.25);
      for (const s of [-1, 1]) lad.push(beam(V(cx + t.x * s, FLOOR_Y + 1, cz + t.z * s), V(cx + t.x * s, FLOOR_Y - 45, cz + t.z * s), 0.05));
      for (let y = FLOOR_Y + 0.5; y > FLOOR_Y - 45; y -= 0.35) lad.push(beam(V(cx - t.x, y, cz - t.z), V(cx + t.x, y, cz + t.z), 0.03));
      this.scene.add(mesh(mergeGeometries(lad), M.rust, false));
    }
    // refletores na parede (como na foto)
    for (const [a, y] of [
      [0.8, -24],
      [2.9, -27],
      [5.0, -23],
    ]) {
      const lm = new THREE.Group();
      lm.add(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.2), M.dark));
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), M.lamp);
      lens.position.z = 0.11;
      lm.add(lens);
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xfff0c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      gl.scale.setScalar(2.2);
      gl.position.z = 0.3;
      lm.add(gl);
      lm.position.set(Math.cos(a) * (SHAFT_R - 0.2), y, Math.sin(a) * (SHAFT_R - 0.2));
      lm.lookAt(0, y - 4, 0);
      this.scene.add(lm);
    }
    const pl = new THREE.PointLight(0xffe2b0, 60, 40, 1.6);
    pl.position.set(0, -26, 0);
    this.scene.add(pl);
    this.anchors.shaft = V(0, FLOOR_Y - 2, 0);
  }

  _headframe() {
    const hf = makeHeadframe();
    hf.position.y = FLOOR_Y;
    this.scene.add(hf);
    this.headframe = hf;
    this.anchors.headframe = V(0, FLOOR_Y + 24, 0);
    // casa do guincho
    const wh = makeBuilding(6, 4, 5, 0x9fb3c0);
    wh.position.set(15.8, FLOOR_Y, 8.7);
    wh.rotation.y = -Math.atan2(0.48, 0.88) + Math.PI / 2;
    this.scene.add(wh);
    this.anchors.winch = V(15.8, FLOOR_Y + 5, 8.7);
    // skip (caçamba do poço)
    const skip = new THREE.Group();
    skip.add(mesh(new THREE.BoxGeometry(1.8, 2.8, 1.8).translate(0, 1.4, 0), M.steel));
    skip.add(mesh(new THREE.BoxGeometry(1.9, 0.15, 1.9).translate(0, 2.85, 0), M.rust));
    skip.position.set(-1.0, FLOOR_Y - 30, -0.8);
    this.scene.add(skip);
    this.skip = skip;
    const lm = new THREE.LineBasicMaterial({ color: 0x1c1c1c });
    this.cables = [0, 1, 2, 3].map(() => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), lm);
      this.scene.add(l);
      return l;
    });
  }

  _machines() {
    // sonda com trado
    const rig = makeDrillRig();
    rig.position.set(17.2, FLOOR_Y, -7.6);
    rig.rotation.y = -Math.PI / 2 - 0.35;
    this.scene.add(rig);
    this.rig = rig;
    this.anchors.rig = V(17.2, FLOOR_Y + 19, -7.6);
    // guindaste com trado pendurado sobre o poço
    const cr = makeCrane(30, 0.92);
    cr.position.set(-15.5, FLOOR_Y, 9.5);
    cr.userData.upper.rotation.y = Math.atan2(15.5, -9.5) - 0.12;
    this.scene.add(cr);
    this.scene.add(cr.userData.hook, cr.userData.cable);
    this.crane = cr;
    this.anchors.crane = V(-15.5, FLOOR_Y + 22, 9.5);
    // escavadeiras
    const ex1 = makeExcavator();
    ex1.position.set(-24.3, -12, 16.3);
    ex1.rotation.y = 2.4;
    const ex2 = makeExcavator();
    ex2.position.set(Math.cos(0.4) * 60, 0, Math.sin(0.4) * 60);
    ex2.rotation.y = -1.2;
    const ex3 = makeExcavator();
    ex3.position.set(Math.cos(-1.9) * 40, -6, Math.sin(-1.9) * 40);
    ex3.rotation.y = 0.3;
    for (const e of [ex1, ex2, ex3]) {
      this.scene.add(e);
      this.excavators.push(e);
    }
    this.anchors.excavator = V(-24.3, -6, 16.3);
    // caminhões na estrada da borda
    const colors = [0xe9e9e6, 0xe3a51a, 0xe9e9e6, 0xd8d2c0];
    for (let i = 0; i < 4; i++) {
      const tr = makeTruck(colors[i]);
      tr.userData.a0 = (i / 4) * Math.PI * 2;
      this.scene.add(tr);
      this.trucks.push(tr);
    }
    this.anchors.trucks = V(ROAD_R, 4, 0);
    // pilhas de estéril
    for (const [a, r, s] of [
      [0.15, 78, 9],
      [0.55, 82, 7],
      [-0.3, 80, 8],
    ]) {
      const p = mesh(new THREE.ConeGeometry(s * 1.6, s, 24), M.soil);
      p.position.set(Math.cos(a) * r, groundY(Math.cos(a) * r, Math.sin(a) * r) + s / 2 - 0.5, Math.sin(a) * r);
      this.scene.add(p);
    }
  }

  _site() {
    // ventilação: ventilador + duto flexível amarelo descendo no poço
    const fan = new THREE.Group();
    fan.add(mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.2, 24).rotateZ(Math.PI / 2).translate(0, 1.3, 0), M.yellow));
    fan.add(mesh(new THREE.BoxGeometry(1.6, 0.4, 1.4).translate(0, 0.2, 0), M.dark));
    fan.position.set(-15.2, FLOOR_Y, -1.6);
    fan.rotation.y = 0.1;
    this.scene.add(fan);
    this.anchors.vent = V(-15.2, FLOOR_Y + 3.5, -1.6);
    const ductPath = new THREE.CatmullRomCurve3([
      V(-14.0, FLOOR_Y + 1.3, -1.5),
      V(-10.5, FLOOR_Y + 1.0, -2.2),
      V(-6.9, FLOOR_Y + 1.6, -2.4),
      V(-5.2, FLOOR_Y + 0.4, -2.1),
      V(-4.4, FLOOR_Y - 4, -1.9),
      V(-4.4, FLOOR_Y - 60, -1.9),
    ]);
    const duct = mesh(new THREE.TubeGeometry(ductPath, 200, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0xf0b21a, roughness: 0.6 }));
    this.scene.add(duct);
    const ribs = new THREE.InstancedMesh(new THREE.TorusGeometry(0.47, 0.035, 6, 20), M.dark, 160);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 160; i++) {
      const t = i / 160;
      const p = ductPath.getPointAt(t);
      const tg = ductPath.getTangentAt(t);
      q.setFromUnitVectors(V(0, 0, 1), tg);
      m.compose(p, q, V(1, 1, 1));
      ribs.setMatrixAt(i, m);
    }
    this.scene.add(ribs);

    // geradores com chaminé
    this.stacks = [];
    for (const [x, z, ry] of [
      [-17.5, -8.5, 0.6],
      [8.5, -17.8, 1.4],
    ]) {
      const gen = new THREE.Group();
      gen.add(mesh(new THREE.BoxGeometry(3.2, 1.9, 1.5).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x2f6f7a, roughness: 0.5, metalness: 0.3 })));
      gen.add(mesh(new THREE.BoxGeometry(3.3, 0.25, 1.6).translate(0, 0.12, 0), M.dark));
      gen.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 10).translate(1.1, 2.8, 0), M.dark));
      gen.position.set(x, FLOOR_Y, z);
      gen.rotation.y = ry;
      this.scene.add(gen);
      this.stacks.push(gen.localToWorld(V(1.1, 3.5, 0)));
    }

    // torres de iluminação
    for (const [x, z] of [
      [6, 16],
      [-12, -15],
    ]) {
      const lt = new THREE.Group();
      lt.add(mesh(new THREE.BoxGeometry(1.4, 0.8, 2.4).translate(0, 0.6, 0), M.yellow));
      lt.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 7.5, 8).translate(0, 4.6, 0), M.steel));
      for (let i = 0; i < 4; i++) {
        const lamp = mesh(new THREE.BoxGeometry(0.45, 0.45, 0.15).translate((i - 1.5) * 0.5, 8.3, 0.1), M.dark, false);
        lt.add(lamp);
        const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4).translate((i - 1.5) * 0.5, 8.3, 0.18), M.lamp);
        lt.add(lens);
      }
      lt.position.set(x, FLOOR_Y, z);
      lt.lookAt(0, FLOOR_Y, 0);
      this.scene.add(lt);
    }

    // mangueiras no chão
    const hoseGeos = [];
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const r0 = SHAFT_R + 1.2 + rnd() * 3;
      const pts = [];
      let x = Math.cos(a) * r0;
      let z = Math.sin(a) * r0;
      let dirA = a + (rnd() - 0.5);
      for (let k = 0; k < 7; k++) {
        pts.push(V(x, FLOOR_Y + 0.08 + (k === 0 ? 0.6 : 0), z));
        dirA += (rnd() - 0.5) * 1.2;
        x += Math.cos(dirA) * 2.2;
        z += Math.sin(dirA) * 2.2;
        if (Math.hypot(x, z) > FLOOR_R - 1) break;
      }
      if (pts.length < 3) continue;
      hoseGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05 + rnd() * 0.06, 8));
    }
    this.scene.add(mesh(mergeGeometries(hoseGeos), M.hose, false));

    // pedras soltas
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color: 0x8a3e22, roughness: 1 }), 260);
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2;
      const r = SHAFT_R + 1.5 + rnd() * (FLOOR_R - SHAFT_R - 1);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = 0.3 + rnd() * 1.4;
      m.compose(V(x, FLOOR_Y + 0.1, z), q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), V(s, s * 0.7, s));
      rocks.setMatrixAt(i, m);
    }
    rocks.castShadow = rocks.receiveShadow = true;
    this.scene.add(rocks);

    // frente de desmonte: furos carregados na bancada (y = −6)
    this.blastCenter = V(-9.5, -6, 40.5);
    const holes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), new THREE.MeshBasicMaterial({ color: 0x0a0806 }), 40);
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 }), 4);
    let k = 0;
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 5; j++) {
        const a = Math.atan2(this.blastCenter.z, this.blastCenter.x) + (i - 3.5) * 0.06;
        const r = 37.2 + j * 1.6;
        m.compose(V(Math.cos(a) * r, -5.96, Math.sin(a) * r), q.identity(), V(1, 1, 1));
        holes.setMatrixAt(k++, m);
      }
    for (let i = 0; i < 4; i++) {
      const a = Math.atan2(this.blastCenter.z, this.blastCenter.x) + (i < 2 ? -0.32 : 0.32);
      const r = i % 2 ? 43 : 37;
      m.compose(V(Math.cos(a) * r, -5.8, Math.sin(a) * r), q.identity(), V(1, 1, 1));
      cones.setMatrixAt(i, m);
    }
    this.scene.add(holes, cones);
    this.anchors.blast = this.blastCenter.clone().add(V(0, 3, 0));

    // escritório da obra + placa + cozinha
    const office = makeBuilding(7, 2.7, 2.6, 0xf1efe6, 0x3c6e9e);
    office.position.set(73, 0, 23);
    office.rotation.y = -Math.atan2(23, 73) - Math.PI / 2;
    this.scene.add(office);
    this.anchors.office = V(73, 4.5, 23);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 1.9),
      new THREE.MeshStandardMaterial({
        map: signTex([
          ['PROJETO ANTÍPODA', 92, 120],
          ['FRENTE MINAS GERAIS · POÇO 1', 46, 190, 'Arial, sans-serif'],
          ['FALTAM 12.741,99 km', 50, 262, 'Arial, sans-serif'],
        ]),
        roughness: 0.8,
      }),
    );
    sign.position.set(0, 1.5, 1.32);
    office.add(sign);
    const epi = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.0),
      new THREE.MeshStandardMaterial({
        map: signTex(
          [
            ['USO OBRIGATÓRIO', 100, 120],
            ['CAPACETE · BOTA · ÓCULOS · MÁSCARA', 56, 210, 'Arial, sans-serif'],
          ],
          '#1565c0',
          '#ffffff',
          1024,
          300,
        ),
        roughness: 0.8,
      }),
    );
    epi.position.set(2.6, 1.5, 1.33);
    epi.scale.setScalar(0.8);
    office.add(epi);
    // mesa do café
    const table = new THREE.Group();
    table.add(mesh(new THREE.BoxGeometry(2.2, 0.06, 0.9).translate(0, 0.78, 0), new THREE.MeshStandardMaterial({ color: 0x8a6440 })));
    for (const [x, z] of [
      [-1, -0.4],
      [1, -0.4],
      [-1, 0.4],
      [1, 0.4],
    ])
      table.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.78, 6).translate(x, 0.39, z), M.steel));
    table.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.34, 14).translate(-0.6, 0.98, 0), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4 })));
    table.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.34, 14).translate(-0.35, 0.98, 0.15), M.steel));
    table.add(mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.05, 20).translate(0.45, 0.83, 0), new THREE.MeshStandardMaterial({ color: 0xe8e2d4 })));
    const pdq = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.75, 1), new THREE.MeshStandardMaterial({ color: 0xd9a64a, roughness: 0.7 }), 22);
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.24;
      m.compose(V(0.45 + Math.cos(a) * r, 0.88 + (i > 14 ? 0.06 : 0), Math.sin(a) * r), q.identity(), V(1, 1, 1));
      pdq.setMatrixAt(i, m);
    }
    table.add(pdq);
    for (let i = 0; i < 5; i++) table.add(mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 10).translate(0.9 - i * 0.12, 0.85, -0.3), M.white));
    table.position.set(67.2, 0, 33.6);
    table.rotation.y = -0.5;
    this.scene.add(table);
    this.anchors.kitchen = V(67.2, 2.2, 33.6);
  }

  _trees() {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 3.2, 6).translate(0, 1.6, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.6, 1).scale(1.3, 0.55, 1.3);
    const n = 520;
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 }), n);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x4f6327, roughness: 0.9 }), n * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    let kc = 0;
    while (k < n) {
      const a = rnd() * Math.PI * 2;
      const r = 72 + Math.pow(rnd(), 1.4) * 900;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (x > 55 && x < 95 && z > 5 && z < 50) continue; // escritório
      const y = groundY(x, z);
      const s = 0.7 + rnd() * 1.1;
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.25, rnd() * 6, (rnd() - 0.5) * 0.25));
      m.compose(V(x, y - 0.2, z), q, V(s, s, s));
      trunks.setMatrixAt(k++, m);
      for (let c = 0; c < 2; c++) {
        const off = V((rnd() - 0.5) * 2 * s, 3.1 * s + c * 0.7 * s, (rnd() - 0.5) * 2 * s);
        m.compose(V(x, y, z).add(off), q, V(s * (0.8 + rnd() * 0.5), s, s * (0.8 + rnd() * 0.5)));
        crowns.setMatrixAt(kc++, m);
      }
    }
    trunks.castShadow = crowns.castShadow = true;
    this.scene.add(trunks, crowns);
  }

  _people() {
    for (const [key, p] of Object.entries(PEOPLE)) {
      const w = makeWorker(p.look, p.pose);
      w.group.position.set(...p.pos);
      w.group.position.y = p.pos[1] === 0 ? groundY(p.pos[0], p.pos[2]) : p.pos[1];
      w.group.rotation.y = p.facing;
      w.key = key;
      this.scene.add(w.group);
      this.workers[key] = w;
    }
    // figurantes
    const extras = [
      { pos: [3.8, FLOOR_Y, -9.2], facing: 3.6, pose: 'pickaxe', look: { helmet: 0xffffff, shirt: 0x6e6452, vest: true, beard: true } },
      { pos: [-2.6, FLOOR_Y, -12.4], facing: 0.4, pose: 'gesture', look: { helmet: 0xffffff, shirt: 0x7a7060, mustache: true, vest: true } },
      { pos: [-1.2, FLOOR_Y, -11.2], facing: 3.6, pose: 'idle', look: { helmet: 0x2e7d32, shirt: 0x3d5a80, backpack: true } },
      { pos: [6.4, FLOOR_Y, 7.2], facing: 2.6, pose: 'thermos', look: { helmet: 0xffffff, shirt: 0x8a7d64, beard: true, skin: 0x6b4430 } },
      { pos: [-6.0, FLOOR_Y, 9.0], facing: 0.9, pose: 'idle', look: { helmet: 0xff7a1a, shirt: 0x6e7a8a, vest: true, skin: 0x8d5a3b } },
      { pos: [1.5, FLOOR_Y, 13.8], facing: 3.3, pose: 'hammer', look: { helmet: 0xffffff, shirt: 0x7d6e5a, skin: 0xc58c64, mustache: true } },
    ];
    for (const e of extras) {
      const w = makeWorker(e.look, e.pose);
      w.group.position.set(...e.pos);
      w.group.rotation.y = e.facing;
      this.scene.add(w.group);
      this.extras.push(w);
    }
    // gente andando na borda e na bancada
    this.walkers = [];
    for (const [r, y, a0, sp] of [
      [ROAD_R + 5.5, 0, 1.2, 0.012],
      [ROAD_R + 5.8, 0, 3.9, -0.01],
    ]) {
      const w = makeWorker({ helmet: 0xffffff, shirt: 0x7a705e, vest: true }, 'walk');
      w.walk = { r, y, a0, sp };
      this.scene.add(w.group);
      this.walkers.push(w);
    }
  }

  _particles() {
    // poeira suspensa na cava
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 60;
      pos.set([Math.cos(a) * r, FLOOR_Y + rnd() * 30, Math.sin(a) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8b890, size: 0.12, transparent: true, opacity: 0.5, depthWrite: false }));
    this.scene.add(this.dust);

    // fumaça dos geradores e poeira das máquinas
    const smokeTex = softTex('200,200,205');
    for (const s of this.stacks) {
      for (let i = 0; i < 14; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
        sp.userData = { origin: s, t: i / 14, life: 7 };
        this.scene.add(sp);
        this.smoke.push(sp);
      }
    }
    const dustTex = softTex('190,120,80');
    this.dustTex = dustTex;
    this.truckDust = [];
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData = { t: i / 40, truck: i % 4 };
      this.scene.add(sp);
      this.truckDust.push(sp);
    }

    // explosão
    this.blast = { t: -1, parts: [] };
    for (let i = 0; i < 110; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0, color: 0xffffff }));
      sp.visible = false;
      this.scene.add(sp);
      this.blast.parts.push({ sp, v: V(), p: V() });
    }
    const flashTex = softTex('255,210,140');
    this.blastFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.blastFlash.position.copy(this.blastCenter).add(V(0, 2, 0));
    this.blastFlash.scale.setScalar(30);
    this.scene.add(this.blastFlash);
    this.blastLight = new THREE.PointLight(0xffb070, 0, 120, 1.5);
    this.blastLight.position.copy(this.blastFlash.position);
    this.scene.add(this.blastLight);
  }

  _cage() {
    // gaiola de descida (usada no capítulo da descida)
    const g = new THREE.Group();
    const bars = [];
    const w = 1.6;
    const h = 2.6;
    for (const [x, z] of [
      [-w, -w],
      [w, -w],
      [w, w],
      [-w, w],
    ])
      bars.push(beam(V(x, 0, z), V(x, h, z), 0.08));
    for (const y of [0, 1.1, h])
      for (let i = 0; i < 4; i++) {
        const c = [V(-w, y, -w), V(w, y, -w), V(w, y, w), V(-w, y, w)];
        bars.push(beam(c[i], c[(i + 1) % 4], 0.06));
      }
    for (let i = -3; i <= 3; i++) bars.push(beam(V(i * 0.45, 0, -w), V(i * 0.45, h, -w), 0.025));
    g.add(mesh(mergeGeometries(bars), M.steel, false));
    g.add(mesh(new THREE.BoxGeometry(2 * w, 0.1, 2 * w), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.5 }), false));
    const lamp = new THREE.PointLight(0xfff0d0, 9, 18, 1.4);
    lamp.position.set(0, 2.4, 0.6);
    g.add(lamp);
    const crew = [];
    for (const [x, z, f, look] of [
      [-0.65, -0.55, 0.35, { helmet: 0x1e88e5, shirt: 0x2f5d8a, skin: 0x4a2f22, vest: true }],
      [0.7, -0.75, -0.3, { helmet: 0xffffff, shirt: 0x7d6e5a, skin: 0xc58c64, beard: true, vest: true }],
      [1.05, 0.3, -1.3, { helmet: 0xff7a1a, shirt: 0x8a8578, skin: 0xb07a52, mustache: true }],
    ]) {
      const wk = makeWorker(look, 'idle');
      wk.group.position.set(x, 0.05, z);
      wk.group.rotation.y = f;
      g.add(wk.group);
      crew.push(wk);
    }
    g.visible = false;
    this.scene.add(g);
    this.cage = g;
    this.cageCrew = crew;
  }

  // ------------------------------------------------------------------ API
  interviewShot(key) {
    const w = this.workers[key];
    const head = w.group.localToWorld(V(0, 1.62, 0));
    const f = w.group.rotation.y;
    const fwd = V(Math.sin(f), 0, Math.cos(f));
    const right = V(Math.cos(f), 0, -Math.sin(f));
    const pos = head.clone().addScaledVector(fwd, 3.2).addScaledVector(right, -0.75).add(V(0, -0.12, 0));
    const target = head.clone().addScaledVector(right, -0.62).add(V(0, -0.3, 0));
    return { pos, target, focus: pos.distanceTo(head), head };
  }

  setTalking(key, camPos) {
    for (const [k, w] of Object.entries(this.workers)) {
      w.P.talking = k === key;
      // olha para o entrevistador (um pouco ao lado da câmera)
      w.P.lookAt = k === key && camPos ? camPos.clone() : null;
    }
  }

  triggerBlast() {
    this.blast.t = 0;
    for (const p of this.blast.parts) {
      p.p.copy(this.blastCenter).add(V((rnd() - 0.5) * 8, rnd() * 1.5, (rnd() - 0.5) * 6));
      const up = 6 + rnd() * 18;
      const out = V(this.blastCenter.x, 0, this.blastCenter.z).normalize().multiplyScalar(-(2 + rnd() * 6));
      p.v.set(out.x + (rnd() - 0.5) * 8, up, out.z + (rnd() - 0.5) * 8);
      p.sp.visible = true;
      p.size = 2 + rnd() * 4;
    }
  }

  setDescent(on) {
    this.descent.on = on;
    this.cage.visible = on;
    this.shaftU.uLampOn.value = on ? 1 : 0;
    if (!on) {
      this.shaftU.uShift.value = 0;
      this.shaftU.uSpeed.value = 0;
    }
  }

  /** profundidade virtual (m) da gaiola; a gaiola fica parada em y fixo e a parede "rola" */
  updateDescent(depth, speed) {
    const cageY = -140;
    this.cage.position.set(0, cageY, 0);
    const realDepth = FLOOR_Y - cageY;
    this.shaftU.uShift.value = depth - realDepth;
    this.shaftU.uSpeed.value = speed;
    this.shaftU.uLamp.value.set(0, cageY + 2.4, 0.6);
    return cageY;
  }

  update(t, dt) {
    this.time = t;
    this.shaftU.uTime.value = t;
    // caminhões
    this.trucks.forEach((tr, i) => {
      const a = tr.userData.a0 + t * 0.06;
      const x = Math.cos(a) * ROAD_R;
      const z = Math.sin(a) * ROAD_R;
      tr.position.set(x, groundY(x, z) + 0.02, z);
      tr.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      for (const w of tr.userData.wheels) w.rotation.x += dt * 5;
    });
    for (const ex of this.excavators) animExcavator(ex, t);
    // sonda e trado
    this.rig.userData.auger.rotation.y += dt * 3.5;
    this.rig.userData.auger.position.y = 15 + Math.sin(t * 0.15) * 1.2;
    // guindaste: balança devagar
    const cr = this.crane.userData;
    cr.upper.rotation.y += Math.sin(t * 0.12) * 0.0006;
    this.crane.updateMatrixWorld(true);
    const tip = cr.tip.getWorldPosition(V());
    const hookY = FLOOR_Y + 9 + Math.sin(t * 0.25) * 1.5;
    cr.hook.position.set(tip.x, hookY, tip.z);
    cr.auger.rotation.y += dt * 0.6;
    cr.cable.geometry.setFromPoints([tip, cr.hook.position.clone().add(V(0, 0.4, 0))]);
    // poço: polias e skip
    const H = this.headframe.userData.H;
    const cyc = (Math.sin(t * 0.18) + 1) / 2;
    const skipY = THREE.MathUtils.lerp(FLOOR_Y - 85, FLOOR_Y + 3, Math.pow(cyc, 1.4));
    const prevY = this.skip.position.y;
    this.skip.position.y = skipY;
    for (const s of this.headframe.userData.sheaves) s.rotation.z += (skipY - prevY) / 1.4;
    const top = FLOOR_Y + H + 1.8;
    const winch = V(15.8 - 2.2, FLOOR_Y + 2.6, 8.7 - 1.2);
    this.cables[0].geometry.setFromPoints([V(-1.4, top, -0.8), V(-1.0, skipY + 2.9, -0.8)]);
    this.cables[1].geometry.setFromPoints([V(1.4, top, -0.8), winch]);
    this.cables[2].geometry.setFromPoints([V(-1.4, top, 0.8), V(-1.4, FLOOR_Y - 120, 0.8)]);
    this.cables[3].geometry.setFromPoints([V(1.4, top, 0.8), winch.clone().add(V(0, 0, 0.6))]);
    // pessoas
    for (const w of Object.values(this.workers)) poseWorker(w, t, dt);
    for (const w of this.extras) poseWorker(w, t, dt);
    for (const w of this.cageCrew) poseWorker(w, t, dt);
    for (const w of this.walkers) {
      const { r, y, a0, sp } = w.walk;
      const a = a0 + t * sp;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      w.group.position.set(x, y === 0 ? groundY(x, z) : y, z);
      w.group.rotation.y = Math.atan2(-Math.sin(a) * Math.sign(sp), Math.cos(a) * Math.sign(sp));
      poseWorker(w, t, dt);
    }
    // fumaça
    for (const s of this.smoke) {
      const u = s.userData;
      u.t = (u.t + dt / u.life) % 1;
      s.position.copy(u.origin).add(V(u.t * 3, u.t * 9, u.t * 1.5));
      s.scale.setScalar(0.6 + u.t * 4.5);
      s.material.opacity = Math.sin(u.t * Math.PI) * 0.35;
    }
    // poeira atrás dos caminhões
    for (const s of this.truckDust) {
      const u = s.userData;
      u.t = (u.t + dt / 3) % 1;
      if (u.t < dt / 3 + 0.001) u.from = this.trucks[u.truck].position.clone();
      if (!u.from) u.from = this.trucks[u.truck].position.clone();
      s.position.copy(u.from).add(V(0, 0.8 + u.t * 3, 0));
      s.scale.setScalar(2 + u.t * 7);
      s.material.opacity = Math.sin(u.t * Math.PI) * 0.3;
    }
    this.dust.rotation.y = t * 0.01;
    // explosão
    const b = this.blast;
    if (b.t >= 0) {
      b.t += dt;
      const ft = b.t;
      this.blastFlash.material.opacity = Math.max(0, 1 - ft * 2.5);
      this.blastLight.intensity = Math.max(0, 1 - ft * 2) * 4000;
      for (const p of b.parts) {
        p.v.y -= 9.8 * dt * 0.35;
        p.v.multiplyScalar(1 - dt * 0.6);
        p.p.addScaledVector(p.v, dt);
        p.sp.position.copy(p.p);
        p.sp.scale.setScalar(p.size + ft * 4);
        p.sp.material.opacity = Math.max(0, Math.min(1, ft * 6)) * Math.max(0, 1 - ft / 9) * 0.75;
        p.sp.material.color.setRGB(1, Math.min(1, 0.55 + ft * 0.3), Math.min(1, 0.4 + ft * 0.35));
      }
      if (ft > 9) {
        b.t = -1;
        for (const p of b.parts) p.sp.visible = false;
      }
    }
  }
}
