// Dinossauros procedurais (Three.js): articulados, animados e reaproveitados
// em todas as partes da visita e no jogo. Nada de arquivos de modelo — cada
// bicho é montado com elipsoides e cilindros, com pivôs nas articulações.
//
// Escala natural: 1 unidade = 1 metro. O bicho olha para +Z e pisa em y = 0.
// API:
//   const d = makeDino('rex', { helmet: 0xf2c200 });   // { group, P, ... }
//   d.P.pose = 'walk';                                  // idle | walk | run | graze | fly
//   poseDino(d, t, dt);                                 // a cada quadro
//   orbit(d, t, { cx, cz, rx, rz, speed });             // anda em elipse
//   roar(d);                                            // abre a bocarra

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// ------------------------------------------------------------------ materiais e peças
const matCache = new Map();
function mat(color, o = {}) {
  const key = `${color}|${JSON.stringify(o)}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...o }));
  return matCache.get(key);
}

function part(parent, geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function pivot(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const ell = (rx, ry, rz, w = 16, h = 12) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
/** tronco de cone ao longo de +Z, de z = 0 (raio r0) a z = len (raio r1) */
const seg = (r0, r1, len, sides = 12) => new THREE.CylinderGeometry(r1, r0, len, sides).rotateX(Math.PI / 2).translate(0, 0, len / 2);
/** tronco de cone pendurado para baixo, de y = 0 (raio r0) a y = −len (raio r1) */
const hang = (r0, r1, len, sides = 10) => new THREE.CylinderGeometry(r0, r1, len, sides).translate(0, -len / 2, 0);
/** cone com a ponta em +Z, base em z = 0 */
const spike = (r, len, sides = 8) => new THREE.ConeGeometry(r, len, sides).rotateX(Math.PI / 2).translate(0, 0, len / 2);

const _up = new THREE.Vector3(0, 1, 0);
/** cilindro entre dois pontos (para ossos e garras) */
function bone(a, b, r0, r1 = r0) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), 6);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, d.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ partes do corpo
function addLeg(d, parent, x, y, z, o) {
  const { L1, r0, r1 = r0 * 0.62, foot, footH = foot * 0.28, rest1 = 0, rest2 = 0, offset = 0, amp = 0.45, toes = 3, sickle = false, front = false } = o;
  // comprimento da canela calculado para o pé tocar o chão
  const hy = d.hipH + y;
  const L2 = o.L2 ?? Math.max((hy - L1 * Math.cos(rest1) - footH) / Math.cos(rest1 + rest2), 0.1);
  const hip = pivot(parent, x, y, z);
  part(hip, ell(r0 * 1.1, r0 * 1.15, r0 * 1.15), d.skin);
  part(hip, hang(r0, r0 * 0.72, L1), d.skin);
  const knee = pivot(hip, 0, -L1, 0);
  part(knee, ell(r0 * 0.72, r0 * 0.72, r0 * 0.72, 10, 8), d.skin, 0, 0, 0, false);
  part(knee, hang(r1, r1 * 0.8, L2), d.skin);
  const ankle = pivot(knee, 0, -L2, 0);
  part(ankle, ell(foot * (front ? 0.5 : 0.42), footH, foot * (front ? 0.5 : 0.62), 10, 8), d.skin, 0, -footH * 0.35, front ? 0 : foot * 0.35);
  const claws = [];
  for (let i = 0; i < toes; i++) {
    const a = toes === 1 ? 0 : (i / (toes - 1) - 0.5) * (front ? 1.6 : 0.9);
    const c = new THREE.ConeGeometry(foot * 0.09, foot * 0.32, 6).rotateX(Math.PI / 2 + 0.4).translate(0, 0, foot * 0.16);
    c.rotateY(a).translate(Math.sin(a) * foot * 0.4, -footH * 0.55, (front ? 0.3 : 0.75) * foot + Math.cos(a) * foot * 0.2);
    claws.push(c);
  }
  if (sickle) claws.push(new THREE.ConeGeometry(foot * 0.07, foot * 0.45, 6).rotateX(-0.6).translate(0, -footH * 0.1 + foot * 0.12, foot * 0.25));
  part(ankle, mergeGeometries(claws), d.claw, 0, 0, 0, false);
  const L = { hip, knee, ankle, rest1, rest2, offset, amp, L1, L2 };
  hip.rotation.x = rest1;
  knee.rotation.x = rest2;
  ankle.rotation.x = -(rest1 + rest2);
  d.legs.push(L);
  return L;
}

/** cadeia de segmentos (cauda ou pescoço); o primeiro pivô fica em `base` */
function addChain(parent, base, { n, len, r0, r1, bend = 0, sway = 1, material, rotY = 0, pitch = 0, sides = 12 }) {
  const out = [];
  let p = pivot(parent, ...base);
  p.rotation.y = rotY;
  p.rotation.x = pitch;
  for (let i = 0; i < n; i++) {
    const ra = THREE.MathUtils.lerp(r0, r1, i / n);
    const rb = THREE.MathUtils.lerp(r0, r1, (i + 1) / n);
    part(p, seg(ra, rb, len * 1.04, sides), material);
    if (i > 0) part(p, ell(ra, ra, ra * 0.6, 10, 8), material, 0, 0, 0, false);
    out.push({ p, rest: i === 0 ? pitch : bend, sway });
    if (i < n - 1) {
      p = pivot(p, 0, 0, len);
      p.rotation.x = bend;
    } else out.end = pivot(p, 0, 0, len);
  }
  return out;
}

function addEyes(head, x, y, z, r, d) {
  for (const s of [-1, 1]) {
    part(head, ell(r * 1.2, r * 1.2, r), mat(0xf1e6b8, { roughness: 0.3 }), s * x, y, z, false);
    part(head, ell(r * 0.55, r * 0.9, r * 0.5, 8, 6), mat(0x120c06, { roughness: 0.2 }), s * (x + r * 0.55), y, z + r * 0.2, false);
    if (d) part(head, ell(r * 1.6, r * 0.5, r * 1.4, 8, 6), d.skin, s * x * 0.95, y + r * 1.0, z, false); // sobrancelha
  }
}

function addTeeth(parent, halfW, y, z0, z1, size, down = true) {
  const g = [];
  const n = Math.max(3, Math.round((z1 - z0) / (size * 1.6)));
  for (const s of [-1, 1])
    for (let i = 0; i <= n; i++) {
      const z = THREE.MathUtils.lerp(z0, z1, i / n);
      const w = halfW * (1 - 0.35 * (i / n));
      g.push(new THREE.ConeGeometry(size * 0.45, size * 1.3, 5).rotateX(down ? Math.PI : 0).translate(s * w, y, z));
    }
  part(parent, mergeGeometries(g), mat(0xf4efe0, { roughness: 0.4 }), 0, 0, 0, false);
}

/** capacete de mineiro (com lanterna) — todo dinossauro do canteiro usa EPI */
function addHelmet(head, r, x, y, z, color) {
  const hm = mat(color, { roughness: 0.35 });
  const g = pivot(head, x, y, z);
  part(g, new THREE.SphereGeometry(r, 20, 10, 0, TAU, 0, Math.PI / 2).scale(1, 0.9, 1.1), hm);
  part(g, new THREE.CylinderGeometry(r * 1.18, r * 1.18, r * 0.08, 22).scale(1, 1, 1.15).translate(0, 0, r * 0.08), hm);
  part(g, new THREE.CylinderGeometry(r * 0.18, r * 0.2, r * 0.32, 10).rotateX(Math.PI / 2).translate(0, r * 0.45, r * 1.05), mat(0x222222), 0, 0, 0, false);
  part(g, new THREE.CircleGeometry(r * 0.15, 10).translate(0, r * 0.45, r * 1.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.7, 3) }), 0, 0, 0, false);
  return g;
}

/** colete refletivo em volta do peito */
function addVest(parent, rx, ry, rz, x, y, z, color) {
  const g = pivot(parent, x, y, z);
  part(g, ell(rx * 1.04, ry * 1.04, rz * 0.55, 18, 10), mat(color, { roughness: 0.6 }), 0, 0, 0, false);
  const refl = mat(0xd8d8c0, { emissive: 0x6a6a50, roughness: 0.3 });
  for (const zz of [-0.25, 0.25]) part(g, new THREE.TorusGeometry(1, 0.05, 6, 24).scale(rx * 1.06, ry * 1.06, 1).translate(0, 0, zz * rz), refl, 0, 0, 0, false);
}

function newDino(species, o, defaults) {
  const skin = mat(o.color ?? defaults.color);
  const belly = mat(o.belly ?? defaults.belly);
  const accent = mat(o.accent ?? defaults.accent ?? defaults.belly);
  const group = new THREE.Group();
  const d = {
    species,
    group,
    skin,
    belly,
    accent,
    claw: mat(0x2a2420, { roughness: 0.5 }),
    legs: [],
    tail: [],
    neck: [],
    wings: [],
    P: { pose: o.pose ?? 'idle', phase: Math.random() * TAU, seed: Math.random() * 100, talking: false, lookAt: null, roarT: 0, roarDur: 1, speed: null },
  };
  return d;
}

function finish(d, o) {
  if (o.scale) d.group.scale.setScalar(o.scale);
  d.group.userData.dino = d;
  return d;
}

// ------------------------------------------------------------------ espécies
// Terópodes: T-rex e raptor (mesmo esqueleto, proporções diferentes)
function theropod(species, o, k) {
  const d = newDino(species, o, k);
  d.hipH = k.hip;
  d.walkSpeed = k.walkSpeed;
  d.cycle = k.hip * 2.6;
  d.bob = k.hip * 0.03;
  const hips = pivot(d.group, 0, d.hipH, 0);
  d.hips = hips;
  const [bx, by, bz] = k.body;
  part(hips, ell(bx, by, bz), d.skin, 0, by * 0.25, bz * 0.35).rotation.x = -0.1;
  part(hips, ell(bx * 0.86, by * 0.7, bz * 0.7), d.belly, 0, -by * 0.18, bz * 0.45).rotation.x = -0.1;
  part(hips, ell(bx * 0.9, by * 0.85, bz * 0.55), d.skin, 0, by * 0.5, bz * 1.0);
  if (o.vest) addVest(hips, bx, by * 0.9, bz * 0.6, 0, by * 0.4, bz * 0.85, o.vest);
  if (k.feathers) {
    const f = [];
    for (let i = 0; i < 9; i++) f.push(new THREE.ConeGeometry(bx * 0.18, bx * 0.9, 4).rotateX(-1.2 - i * 0.04).translate(0, by * (0.95 - i * 0.02), bz * (1.2 - i * 0.28)));
    part(hips, mergeGeometries(f), d.accent, 0, 0, 0, false);
  }

  // pescoço e cabeça
  const neckBase = pivot(hips, 0, by * 0.75, bz * 1.35);
  neckBase.rotation.x = k.neckPitch;
  d.neckBase = neckBase;
  d.neckRest = k.neckPitch;
  part(neckBase, seg(k.neckR, k.neckR * 0.8, k.neckLen), d.skin);
  part(neckBase, seg(k.neckR * 0.7, k.neckR * 0.55, k.neckLen), d.belly, 0, -k.neckR * 0.35, 0);
  const head = pivot(neckBase, 0, 0, k.neckLen);
  head.rotation.x = -k.neckPitch * 0.9;
  d.head = head;
  d.headRest = -k.neckPitch * 0.9;
  const [hx, hy, hz] = k.head;
  part(head, ell(hx, hy, hz * 0.6), d.skin, 0, hy * 0.25, hz * 0.45);
  part(head, ell(hx * 0.78, hy * 0.62, hz * 0.7), d.skin, 0, hy * 0.05, hz * 1.05);
  const jaw = pivot(head, 0, -hy * 0.25, hz * 0.3);
  d.jaw = jaw;
  part(jaw, ell(hx * 0.7, hy * 0.3, hz * 0.78), d.belly, 0, -hy * 0.12, hz * 0.62);
  part(jaw, ell(hx * 0.5, hy * 0.18, hz * 0.6), mat(0x8a2f2a, { roughness: 0.5 }), 0, 0.01, hz * 0.6, false); // língua
  addTeeth(head, hx * 0.6, -hy * 0.42, hz * 0.55, hz * 1.55, hz * k.tooth);
  addTeeth(jaw, hx * 0.55, hy * 0.1, hz * 0.4, hz * 1.2, hz * k.tooth * 0.8, false);
  addEyes(head, hx * 0.82, hy * 0.55, hz * 0.62, hy * 0.16, d);
  if (k.feathers) {
    const f = [];
    for (let i = 0; i < 5; i++) f.push(new THREE.ConeGeometry(hx * 0.12, hy * 1.2, 4).rotateX(-0.9).translate(0, hy * 0.95, hz * (0.4 - i * 0.15)));
    part(head, mergeGeometries(f), d.accent, 0, 0, 0, false);
  }
  if (o.helmet) addHelmet(head, hx * 1.05, 0, hy * 0.75, hz * 0.4, o.helmet);

  // bracinhos
  d.arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(hips, s * bx * 0.8, by * 0.15, bz * 1.25);
    sh.rotation.x = -0.9;
    part(sh, hang(k.armR, k.armR * 0.75, k.arm), d.skin);
    const claws = [];
    for (let i = 0; i < k.fingers; i++) claws.push(new THREE.ConeGeometry(k.armR * 0.35, k.armR * 2.2, 5).rotateX(Math.PI + 0.5).translate((i - (k.fingers - 1) / 2) * k.armR * 0.6, -k.arm - k.armR, k.armR * 0.4));
    part(sh, mergeGeometries(claws), d.claw, 0, 0, 0, false);
    if (k.feathers) part(sh, new THREE.BoxGeometry(0.02, k.arm * 0.9, k.arm * 0.7).translate(s * k.armR, -k.arm * 0.55, -k.arm * 0.3), d.accent, 0, 0, 0, false);
    d.arms.push({ sh, side: s });
  }

  // cauda
  d.tail = addChain(hips, [0, by * 0.3, -bz * 0.55], { n: k.tailN, len: k.tailLen, r0: k.tailR, r1: k.tailR * 0.08, bend: 0.03, material: d.skin, rotY: Math.PI, pitch: -0.08 });
  d.tailStiff = k.tailStiff ?? 1;
  if (k.feathers) {
    for (const s of d.tail.slice(-3)) part(s.p, new THREE.BoxGeometry(k.tailR * 2.4, 0.015, k.tailLen).translate(0, 0, k.tailLen * 0.5), d.accent, 0, 0, 0, false);
  }

  // pernas
  addLeg(d, hips, -bx * 0.75, 0, 0, { ...k.leg, offset: 0 });
  addLeg(d, hips, bx * 0.75, 0, 0, { ...k.leg, offset: Math.PI });
  d.height = d.hipH + by * 1.6 + k.neckLen;
  return finish(d, o);
}

const SPECIES = {
  rex: (o) =>
    theropod('rex', o, {
      color: 0x6f7b3e,
      belly: 0xc9b58a,
      hip: 3.3,
      walkSpeed: 3,
      body: [1.05, 1.25, 2.3],
      neckLen: 1.25,
      neckR: 0.72,
      neckPitch: -0.55,
      head: [0.62, 0.68, 1.15],
      tooth: 0.07,
      arm: 0.55,
      armR: 0.12,
      fingers: 2,
      tailN: 8,
      tailLen: 0.8,
      tailR: 0.85,
      leg: { L1: 1.75, r0: 0.62, foot: 0.95, rest1: -0.28, rest2: 0.6, amp: 0.42 },
    }),
  raptor: (o) =>
    theropod('raptor', o, {
      color: 0x8a5a34,
      belly: 0xe2c9a0,
      accent: 0x2f6d8c,
      hip: 0.95,
      walkSpeed: 2.2,
      body: [0.24, 0.3, 0.62],
      neckLen: 0.45,
      neckR: 0.13,
      neckPitch: -0.95,
      head: [0.13, 0.13, 0.3],
      tooth: 0.06,
      arm: 0.42,
      armR: 0.05,
      fingers: 3,
      tailN: 8,
      tailLen: 0.22,
      tailR: 0.16,
      tailStiff: 0.4,
      feathers: true,
      leg: { L1: 0.42, r0: 0.13, foot: 0.32, rest1: -0.35, rest2: 0.75, amp: 0.55, sickle: true },
    }),

  // titanossauro (saurópode, os "pescoçudos" que viviam em Minas)
  titan(o) {
    const d = newDino('titan', o, { color: 0x7d7468, belly: 0xb4a894 });
    d.hipH = 4.2;
    d.walkSpeed = 2;
    d.cycle = 9;
    d.bob = 0.06;
    const hips = pivot(d.group, 0, d.hipH, 0);
    d.hips = hips;
    part(hips, ell(1.8, 1.9, 3.6), d.skin, 0, 0.35, 1.2);
    part(hips, ell(1.55, 1.3, 3.1), d.belly, 0, -0.6, 1.3);
    d.neck = addChain(hips, [0, 1.0, 4.2], { n: 7, len: 1.25, r0: 0.95, r1: 0.32, bend: 0.06, material: d.skin, pitch: -0.95 });
    d.neckBase = d.neck[0].p;
    d.neckRest = -0.95;
    const head = pivot(d.neck.end, 0, 0, 0);
    head.rotation.x = 0.55;
    d.head = head;
    d.headRest = 0.55;
    part(head, ell(0.36, 0.34, 0.62), d.skin, 0, 0.1, 0.35);
    const jaw = pivot(head, 0, -0.08, 0.2);
    d.jaw = jaw;
    part(jaw, ell(0.3, 0.12, 0.5), d.belly, 0, -0.06, 0.35);
    addEyes(head, 0.26, 0.24, 0.45, 0.07);
    if (o.helmet) addHelmet(head, 0.4, 0, 0.32, 0.3, o.helmet);
    d.tail = addChain(hips, [0, 0.6, -2.0], { n: 10, len: 1.05, r0: 1.05, r1: 0.08, bend: 0.05, material: d.skin, rotY: Math.PI, pitch: 0.1 });
    const leg = { L1: 2.0, r0: 0.62, r1: 0.52, foot: 0.75, toes: 3, amp: 0.3 };
    addLeg(d, hips, -1.2, 0.1, 3.0, { ...leg, front: true, offset: 0 });
    addLeg(d, hips, 1.2, 0.1, 3.0, { ...leg, front: true, offset: Math.PI });
    addLeg(d, hips, -1.25, 0, -0.9, { ...leg, offset: Math.PI });
    addLeg(d, hips, 1.25, 0, -0.9, { ...leg, offset: 0 });
    d.height = 13;
    return finish(d, o);
  },

  trice(o) {
    const d = newDino('trice', o, { color: 0x9a6a3c, belly: 0xd8c39a, accent: 0xb5482c });
    d.hipH = 1.9;
    d.walkSpeed = 1.6;
    d.cycle = 4.2;
    d.bob = 0.05;
    const hips = pivot(d.group, 0, d.hipH, 0);
    d.hips = hips;
    part(hips, ell(1.25, 1.15, 2.4), d.skin, 0, 0.3, 0.4);
    part(hips, ell(1.05, 0.8, 2.0), d.belly, 0, -0.35, 0.5);
    const neckBase = pivot(hips, 0, 0.1, 2.5);
    neckBase.rotation.x = 0.15;
    d.neckBase = neckBase;
    d.neckRest = 0.15;
    part(neckBase, seg(0.75, 0.62, 0.6), d.skin);
    const head = pivot(neckBase, 0, 0, 0.55);
    d.head = head;
    d.headRest = 0;
    part(head, ell(0.7, 0.68, 0.95), d.skin, 0, 0, 0.6);
    part(head, spike(0.3, 0.55), d.claw, 0, -0.18, 1.4).rotation.x = 0.35; // bico
    // babado (frill) e chifres
    const frill = new THREE.Mesh(new THREE.CircleGeometry(1.35, 28, Math.PI * 0.05, Math.PI * 0.9).scale(1, 0.85, 1), mat(o.accent ?? 0xb5482c, { side: THREE.DoubleSide, roughness: 0.7 }));
    frill.position.set(0, 0.35, 0.2);
    frill.rotation.x = -0.55;
    frill.castShadow = true;
    head.add(frill);
    const rim = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (0.05 + (0.9 * i) / 12);
      rim.push(new THREE.ConeGeometry(0.09, 0.28, 5).rotateZ(a - Math.PI / 2).translate(Math.cos(a) * 1.38, Math.sin(a) * 1.15, 0));
    }
    const rimM = part(head, mergeGeometries(rim), mat(0xe8d9b8), 0, 0.35, 0.2, false);
    rimM.rotation.x = -0.55;
    const horn = mat(0xeee2c4, { roughness: 0.45 });
    for (const s of [-1, 1]) part(head, spike(0.13, 1.05), horn, s * 0.32, 0.45, 0.8).rotation.set(-0.55, s * 0.12, 0);
    part(head, spike(0.1, 0.38), horn, 0, 0.12, 1.3).rotation.x = -0.9;
    const jaw = pivot(head, 0, -0.3, 0.6);
    d.jaw = jaw;
    part(jaw, ell(0.45, 0.18, 0.6), d.belly, 0, -0.05, 0.35);
    addEyes(head, 0.5, 0.22, 0.75, 0.09, d);
    if (o.helmet) addHelmet(head, 0.5, 0, 0.62, 0.55, o.helmet);
    d.tail = addChain(hips, [0, 0.35, -1.8], { n: 6, len: 0.65, r0: 0.7, r1: 0.06, bend: 0.06, material: d.skin, rotY: Math.PI, pitch: 0.12 });
    addLeg(d, hips, -0.85, -0.25, 1.9, { L1: 0.75, r0: 0.34, foot: 0.45, toes: 3, front: true, rest1: 0.1, rest2: -0.2, offset: 0, amp: 0.35 });
    addLeg(d, hips, 0.85, -0.25, 1.9, { L1: 0.75, r0: 0.34, foot: 0.45, toes: 3, front: true, rest1: 0.1, rest2: -0.2, offset: Math.PI, amp: 0.35 });
    addLeg(d, hips, -0.95, 0, -0.6, { L1: 0.95, r0: 0.45, foot: 0.55, toes: 3, rest1: -0.15, rest2: 0.25, offset: Math.PI, amp: 0.35 });
    addLeg(d, hips, 0.95, 0, -0.6, { L1: 0.95, r0: 0.45, foot: 0.55, toes: 3, rest1: -0.15, rest2: 0.25, offset: 0, amp: 0.35 });
    d.height = 3.2;
    return finish(d, o);
  },

  stego(o) {
    const d = newDino('stego', o, { color: 0x6f7f4a, belly: 0xc6c09a, accent: 0xc0562e });
    d.hipH = 2.3;
    d.walkSpeed = 1.4;
    d.cycle = 4.6;
    d.bob = 0.05;
    const hips = pivot(d.group, 0, d.hipH, 0);
    d.hips = hips;
    const torso = part(hips, ell(1.05, 1.3, 2.5), d.skin, 0, 0.35, 0.3);
    torso.rotation.x = 0.18;
    part(hips, ell(0.9, 0.85, 2.1), d.belly, 0, -0.3, 0.45).rotation.x = 0.18;
    const neckBase = pivot(hips, 0, -0.35, 2.55);
    neckBase.rotation.x = 0.35;
    d.neckBase = neckBase;
    d.neckRest = 0.35;
    part(neckBase, seg(0.5, 0.32, 1.0), d.skin);
    const head = pivot(neckBase, 0, 0, 1.0);
    head.rotation.x = -0.2;
    d.head = head;
    d.headRest = -0.2;
    part(head, ell(0.3, 0.27, 0.55), d.skin, 0, 0, 0.3);
    const jaw = pivot(head, 0, -0.12, 0.15);
    d.jaw = jaw;
    part(jaw, ell(0.22, 0.09, 0.4), d.belly, 0, -0.03, 0.25);
    addEyes(head, 0.2, 0.1, 0.42, 0.06);
    if (o.helmet) addHelmet(head, 0.32, 0, 0.22, 0.25, o.helmet);
    // placas nas costas (duas fileiras alternadas)
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0);
    shape.quadraticCurveTo(-0.55, 0.65, 0, 1);
    shape.quadraticCurveTo(0.55, 0.65, 0.5, 0);
    shape.lineTo(-0.5, 0);
    const plateGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-0.035, 0, 0);
    const plates = [];
    for (let i = 0; i < 9; i++) {
      const z = 2.0 - i * 0.5;
      const s = 0.55 + 0.6 * Math.sin((i / 8) * Math.PI);
      const yTop = 0.35 + 1.3 * Math.sqrt(Math.max(0, 1 - ((z - 0.3) / 2.5) ** 2)) * 0.97;
      const side = i % 2 ? 1 : -1;
      plates.push(plateGeo.clone().scale(1, s, s).rotateZ(side * 0.12).translate(side * 0.12, yTop - 0.15, z));
    }
    part(hips, mergeGeometries(plates), d.accent);
    d.tail = addChain(hips, [0, 0.55, -1.9], { n: 6, len: 0.7, r0: 0.62, r1: 0.06, bend: 0.03, material: d.skin, rotY: Math.PI, pitch: -0.05 });
    const tailPlates = [];
    for (let i = 0; i < 3; i++) tailPlates.push(plateGeo.clone().scale(1, 0.45 - i * 0.1, 0.45 - i * 0.1).translate(0, 0.3 - i * 0.06, 0.2));
    d.tail.slice(0, 3).forEach((s, i) => part(s.p, tailPlates[i], d.accent, 0, 0, 0, false));
    const spikes = [];
    for (const s of [-1, 1]) for (const z of [0.15, 0.5]) spikes.push(spike(0.06, 0.8).rotateY(s * 1.1).rotateX(-0.5).translate(s * 0.06, 0.08, z));
    part(d.tail.at(-2).p, mergeGeometries(spikes), mat(0xeee2c4), 0, 0, 0, false);
    addLeg(d, hips, -0.7, -0.55, 1.7, { L1: 0.65, r0: 0.28, foot: 0.4, front: true, rest1: 0.15, rest2: -0.25, offset: 0, amp: 0.35 });
    addLeg(d, hips, 0.7, -0.55, 1.7, { L1: 0.65, r0: 0.28, foot: 0.4, front: true, rest1: 0.15, rest2: -0.25, offset: Math.PI, amp: 0.35 });
    addLeg(d, hips, -0.8, 0, -0.7, { L1: 1.1, r0: 0.42, foot: 0.55, rest1: -0.15, rest2: 0.3, offset: Math.PI, amp: 0.35 });
    addLeg(d, hips, 0.8, 0, -0.7, { L1: 1.1, r0: 0.42, foot: 0.55, rest1: -0.15, rest2: 0.3, offset: 0, amp: 0.35 });
    d.height = 4;
    return finish(d, o);
  },

  // pterossauro (não é dinossauro, é primo — mas voa junto)
  ptero(o) {
    const d = newDino('ptero', o, { color: 0x7a6a8a, belly: 0xe0d2c0, accent: 0xd0602c });
    d.hipH = 0;
    d.cycle = 1;
    d.bob = 0;
    d.P.pose = o.pose ?? 'fly';
    const body = pivot(d.group, 0, 0, 0);
    d.hips = body;
    part(body, ell(0.24, 0.24, 0.62), d.skin);
    part(body, ell(0.18, 0.15, 0.5), d.belly, 0, -0.08, 0);
    const neckBase = pivot(body, 0, 0.08, 0.5);
    neckBase.rotation.x = -0.25;
    d.neckBase = neckBase;
    d.neckRest = -0.25;
    part(neckBase, seg(0.1, 0.08, 0.45), d.skin);
    const head = pivot(neckBase, 0, 0, 0.45);
    head.rotation.x = 0.25;
    d.head = head;
    d.headRest = 0.25;
    part(head, ell(0.13, 0.13, 0.2), d.skin);
    part(head, spike(0.07, 0.8).scale(1, 0.8, 1), mat(0xe8c27a, { roughness: 0.5 }), 0, -0.02, 0.1);
    part(head, spike(0.05, 0.7).scale(0.3, 1, 1), d.accent, 0, 0.1, -0.05).rotation.x = Math.PI + 0.35; // crista
    const jaw = pivot(head, 0, -0.06, 0.1);
    d.jaw = jaw;
    part(jaw, spike(0.045, 0.7).scale(1, 0.5, 1), mat(0xd8b06a), 0, 0, 0);
    addEyes(head, 0.09, 0.05, 0.05, 0.03);
    if (o.helmet) addHelmet(head, 0.16, 0, 0.1, -0.02, o.helmet);
    const membrane = mat(o.accent ?? 0xb9a07a, { side: THREE.DoubleSide, roughness: 0.85, transparent: true, opacity: 0.95 });
    for (const s of [-1, 1]) {
      const w = pivot(body, s * 0.18, 0.08, 0.2);
      const pts = [0, 0, 0.15, s * 1.3, 0.05, 0.25, s * 2.9, 0.0, -0.05, 0, 0, -0.55, s * 1.2, 0.03, -0.45];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      geo.setIndex([0, 1, 4, 1, 2, 4, 0, 4, 3]);
      geo.computeVertexNormals();
      part(w, geo, membrane);
      part(w, mergeGeometries([bone(V(0, 0, 0.15), V(s * 1.3, 0.05, 0.25), 0.05, 0.035), bone(V(s * 1.3, 0.05, 0.25), V(s * 2.9, 0, -0.05), 0.035, 0.01)]), d.skin, 0, 0, 0, false);
      d.wings.push({ p: w, side: s });
    }
    d.tail = addChain(body, [0, 0, -0.55], { n: 2, len: 0.2, r0: 0.08, r1: 0.02, material: d.skin, rotY: Math.PI });
    for (const s of [-1, 1]) part(body, bone(V(s * 0.12, -0.1, -0.4), V(s * 0.18, -0.15, -0.95), 0.04, 0.025), d.skin, 0, 0, 0, false);
    d.height = 0.6;
    return finish(d, o);
  },
};

export const SPECIES_NAMES = {
  rex: 'Tiranossauro rex',
  raptor: 'Raptor',
  titan: 'Titanossauro',
  trice: 'Tricerátops',
  stego: 'Estegossauro',
  ptero: 'Pterossauro',
};

export function makeDino(species = 'rex', o = {}) {
  const build = SPECIES[species];
  if (!build) throw new Error(`dinossauro desconhecido: ${species}`);
  return build(o);
}

// ------------------------------------------------------------------ animação
const _l = new THREE.Vector3();
export function poseDino(d, t, dt) {
  const P = d.P;
  const moving = P.pose === 'walk' || P.pose === 'run';
  const speed = P.speed ?? (d.walkSpeed ?? 1) * (P.pose === 'run' ? 2.4 : 1);
  if (moving) P.phase += (dt * TAU * speed) / d.cycle;

  // pernas: balanço da coxa + joelho dobrando na volta
  for (const L of d.legs) {
    const ph = P.phase + L.offset;
    const amp = moving ? L.amp * (P.pose === 'run' ? 1.25 : 1) : 0;
    const a1 = L.rest1 + Math.sin(ph) * amp;
    const a2 = L.rest2 + Math.max(0, Math.cos(ph)) * amp * 1.3;
    L.hip.rotation.x = damp(L.hip.rotation.x, a1, 12, dt);
    L.knee.rotation.x = damp(L.knee.rotation.x, a2, 12, dt);
    L.ankle.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x) + (moving ? Math.max(0, Math.cos(ph)) * 0.3 : 0);
  }
  if (d.hips && d.species !== 'ptero') {
    d.hips.position.y = d.hipH + (moving ? Math.abs(Math.cos(P.phase)) * d.bob : Math.sin(t * 1.3 + P.seed) * d.bob * 0.25);
    d.hips.rotation.z = moving ? Math.sin(P.phase) * 0.025 : 0;
  }

  // cauda balançando (atrasada ao longo dos segmentos)
  const tailAmp = (moving ? 0.09 : 0.05) * (d.tailStiff ?? 1);
  d.tail.forEach((s, i) => {
    s.p.rotation.y = (i === 0 ? Math.PI : 0) + Math.sin(t * 1.4 + P.phase * 0.5 + P.seed - i * 0.55) * tailAmp;
  });
  d.neck.forEach((s, i) => {
    if (i > 0) s.p.rotation.y = Math.sin(t * 0.6 + P.seed - i * 0.4) * 0.04;
  });

  // braços (raptor/T-rex) balançam um pouco
  for (const a of d.arms ?? []) a.sh.rotation.x = -0.9 + Math.sin(t * 2 + P.phase + a.side) * (moving ? 0.15 : 0.05);

  // olhar
  let yaw = 0;
  if (P.lookAt && d.neckBase) {
    _l.copy(P.lookAt);
    d.group.worldToLocal(_l);
    yaw = THREE.MathUtils.clamp(Math.atan2(_l.x, _l.z), -0.8, 0.8);
  } else yaw = Math.sin(t * 0.35 + P.seed) * 0.25;
  if (d.neckBase) d.neckBase.rotation.y = damp(d.neckBase.rotation.y, yaw * 0.5, 3, dt);
  if (d.head) d.head.rotation.y = damp(d.head.rotation.y, yaw * 0.5, 3, dt);

  // pastar: abaixa o pescoço de tempos em tempos
  let neckX = d.neckRest ?? 0;
  if (P.pose === 'graze') neckX += Math.max(0, Math.sin(t * 0.35 + P.seed)) * (d.species === 'titan' ? 0.9 : 0.6);

  // rugido: cabeça para cima, bocarra aberta, tremendo
  let jaw = 0;
  let headX = d.headRest ?? 0;
  if (P.roarT > 0) {
    P.roarT = Math.max(0, P.roarT - dt);
    const u = 1 - P.roarT / P.roarDur;
    const k = Math.min(1, u * 5) * Math.min(1, (1 - u) * 3);
    jaw = k * (0.75 + Math.sin(t * 40) * 0.06);
    neckX -= k * 0.35;
    headX -= k * 0.35;
  } else if (P.talking) jaw = 0.12 + Math.abs(Math.sin(t * 9)) * 0.2;
  else jaw = Math.max(0, Math.sin(t * 0.5 + P.seed) - 0.9) * 0.8; // respira de boca aberta às vezes
  if (d.neckBase) d.neckBase.rotation.x = damp(d.neckBase.rotation.x, neckX, 4, dt);
  if (d.head) d.head.rotation.x = damp(d.head.rotation.x, headX, 5, dt);
  if (d.jaw) d.jaw.rotation.x = damp(d.jaw.rotation.x, jaw, 14, dt);

  // asas
  for (const w of d.wings) {
    const flap = P.pose === 'fly' ? Math.sin(t * 5 + P.seed) * 0.55 : -1.1;
    w.p.rotation.z = w.side * (0.1 + flap);
  }
  if (d.species === 'ptero' && P.pose === 'fly') d.hips.position.y = -Math.sin(t * 5 + P.seed) * 0.12;
}

export function roar(d, dur = 2.2) {
  d.P.roarT = dur;
  d.P.roarDur = dur;
}

/** anda (ou voa) numa elipse; `ground(x, z)` dá a altura do chão */
export function orbit(d, t, { cx = 0, cz = 0, rx = 10, rz = rx, speed = d.walkSpeed ?? 2, phase = 0, dir = 1, y = 0, ground = null, bank = 0, bob = 0 }) {
  const Rm = (rx + rz) / 2;
  const a = phase + (dir * t * speed) / Rm;
  const x = cx + Math.cos(a) * rx;
  const z = cz + Math.sin(a) * rz;
  const vx = -Math.sin(a) * rx * dir;
  const vz = Math.cos(a) * rz * dir;
  d.group.position.set(x, (ground ? ground(x, z) : y) + (bob ? Math.sin(t * 0.7 + phase) * bob : 0), z);
  d.group.rotation.set(0, Math.atan2(vx, vz), bank ? dir * bank : 0);
  d.P.speed = speed;
}

// ------------------------------------------------------------------ fóssil
/** Esqueleto de terópode deitado de lado, no plano XY (olhando para +Z). ~`len` metros. */
export function makeFossil(len = 6, color = 0xe6dcc2) {
  const s = len / 6;
  const g = [];
  // coluna: cauda → quadril → pescoço → crânio
  const spine = [V(-3.0, -0.35, 0), V(-2.2, 0.05, 0), V(-1.2, 0.35, 0), V(-0.2, 0.45, 0), V(0.8, 0.4, 0), V(1.5, 0.6, 0), V(2.0, 1.1, 0), V(2.3, 1.45, 0)];
  const curve = new THREE.CatmullRomCurve3(spine);
  const N = 34;
  for (let i = 0; i <= N; i++) {
    const p = curve.getPoint(i / N);
    const tan = curve.getTangent(i / N);
    const sz = 0.05 + 0.1 * Math.sin(Math.min(1, (i / N) * 1.4) * Math.PI * 0.5);
    const box = new THREE.BoxGeometry(sz * 1.3, sz * 1.8, sz * 1.2);
    box.rotateZ(Math.atan2(tan.y, tan.x));
    box.translate(p.x, p.y, p.z);
    g.push(box);
    if (i % 2 === 0 && i > 4) g.push(bone(p, p.clone().add(V(-0.05, sz * 2.4, 0)), 0.025, 0.012)); // espinhos neurais
  }
  // costelas
  for (let i = 0; i < 9; i++) {
    const p = curve.getPoint(0.42 + i * 0.035);
    const r = 0.55 - Math.abs(i - 4) * 0.06;
    const rib = new THREE.TorusGeometry(r, 0.025, 5, 14, 2.1).rotateZ(Math.PI + 0.6);
    rib.translate(p.x + r * 0.25, p.y - r * 0.75, 0);
    g.push(rib);
  }
  // crânio (contorno, órbita do olho e dentes)
  const skull = V(2.75, 1.45, 0);
  g.push(new THREE.TorusGeometry(0.5, 0.05, 6, 22).scale(1.2, 0.55, 1).translate(skull.x, skull.y, 0));
  g.push(new THREE.TorusGeometry(0.13, 0.03, 6, 14).translate(skull.x - 0.25, skull.y + 0.08, 0));
  g.push(new THREE.TorusGeometry(0.1, 0.025, 6, 12).translate(skull.x + 0.2, skull.y + 0.02, 0));
  g.push(bone(V(skull.x - 0.5, skull.y - 0.25, 0), V(skull.x + 0.55, skull.y - 0.38, 0), 0.04, 0.03)); // mandíbula
  for (let i = 0; i < 7; i++) g.push(new THREE.ConeGeometry(0.03, 0.11, 4).rotateZ(Math.PI).translate(skull.x - 0.25 + i * 0.12, skull.y - 0.3, 0));
  // pernas e bacia
  const hip = curve.getPoint(0.3);
  g.push(new THREE.TorusGeometry(0.28, 0.06, 5, 14).scale(1.3, 0.8, 1).translate(hip.x, hip.y - 0.2, 0));
  for (const [dx, k1, k2] of [
    [0, V(0.35, -1.1, 0), V(-0.1, -2.0, 0)],
    [0.15, V(0.6, -1.0, 0), V(0.4, -1.95, 0)],
  ]) {
    const a = V(hip.x + dx, hip.y - 0.25, 0);
    const b = a.clone().add(k1);
    const c = a.clone().add(k2);
    g.push(bone(a, b, 0.08, 0.06), bone(b, c, 0.06, 0.045), bone(c, c.clone().add(V(0.45, -0.05, 0)), 0.04, 0.02));
  }
  // bracinhos
  const sh = curve.getPoint(0.72);
  g.push(bone(sh.clone().add(V(0, -0.2, 0)), sh.clone().add(V(0.25, -0.55, 0)), 0.03, 0.02));
  const geo = mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)));
  geo.scale(s, s, s * 0.5);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(color, { roughness: 0.9 }));
  m.receiveShadow = true;
  return m;
}
