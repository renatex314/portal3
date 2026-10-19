// Peças da luta final da campanha importada, com desenho PRÓPRIO deste jogo:
// núcleos (esferas com faixas acesas), torreta de foguetes (lançador de teto
// com mira laser) e a máquina central (tambor suspenso com anéis girando).
// A lógica da fase (quando cada coisa acontece) vem do mapa, pelo sistema de I/O.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PORTAL_A, PORTAL_B } from '../portals.js';

const CORE_TINT = [0x8fe3ff, 0xff5a3a, 0xffc233, 0xb07cff];

/** núcleo: esfera metálica com duas faixas acesas (a cor indica o tipo) */
export function coreModel(type = 0) {
  const g = new THREE.Group();
  const tint = new THREE.Color(CORE_TINT[type % CORE_TINT.length]);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 20), new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 0.6, roughness: 0.35 }));
  g.add(shell);
  const glow = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(2.2), toneMapped: false });
  for (const rx of [0, Math.PI / 2]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.022, 8, 48), glow);
    band.rotation.x = rx;
    g.add(band);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.4 }));
  cap.position.y = 0.29;
  g.add(cap);
  g.userData.glow = glow;
  return g;
}

/** máquina central: tambor escuro suspenso, anéis girando e faixa de luzes âmbar */
export function bossMachine() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.75, roughness: 0.45 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c939c, metalness: 0.85, roughness: 0.3 });
  const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb347).multiplyScalar(2.4), toneMapped: false });
  // suporte de teto (treliça)
  for (const a of [0, Math.PI / 2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(6, 0.35, 0.35), steel);
    beam.rotation.y = a;
    g.add(beam);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 20), dark);
  neck.position.y = -0.9;
  g.add(neck);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.2, 3.2, 40), dark);
  drum.position.y = -3.3;
  g.add(drum);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.52, 0.18, 40, 1, true), amber);
  band.position.y = -2.6;
  g.add(band);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.9 + i * 0.35, 0.07, 10, 64), steel);
    r.position.y = -3.3 + (i - 1) * 0.9;
    r.rotation.x = Math.PI / 2 + (i - 1) * 0.25;
    g.add(r);
    rings.push(r);
  }
  // aletas e pistões embaixo
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.7), steel);
    fin.position.set(Math.cos(a) * 1.0, -5.2, Math.sin(a) * 1.0);
    fin.rotation.y = -a;
    g.add(fin);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 24), dark);
  tip.position.y = -5.5;
  tip.rotation.x = Math.PI;
  g.add(tip);
  g.userData = { rings, amber, stress: 0 };
  return g;
}

export function animateBoss(g, t, dt) {
  const u = g.userData;
  u.rings.forEach((r, i) => (r.rotation.z += dt * (0.4 + i * 0.25) * (1 + u.stress * 1.5) * (i % 2 ? -1 : 1)));
  const flicker = u.stress > 0 ? 0.6 + 0.4 * Math.abs(Math.sin(t * (6 + u.stress * 10))) : 1;
  u.amber.color.setRGB(2.4 * flicker, 1.68 * flicker, 0.67 * flicker);
}

/** cabine de elevador (desenho próprio): tubo de vidro com anéis de metal */
export function elevatorShell() {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xa8dcff, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.35 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 3.2, 40, 1, true), glass);
  tube.position.y = 1.6;
  tube.renderOrder = 5;
  g.add(tube);
  for (const y of [0.05, 1.6, 3.15]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.47, 0.06, 8, 48).rotateX(Math.PI / 2), metal);
    ring.position.y = y;
    g.add(ring);
  }
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 40), metal);
  roof.position.y = 3.25;
  g.add(roof);
  return g;
}

// ---------------------------------------------------------------- torreta de foguetes

const TAU = Math.PI * 2;
let turretMats = null;
function turretMaterials() {
  if (turretMats) return turretMats;
  // faixa de alerta (amarelo/preto) da base
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#f2c21b';
  x.fillRect(0, 0, 128, 16);
  x.fillStyle = '#16171a';
  for (let i = -16; i < 128; i += 16) {
    x.beginPath();
    x.moveTo(i, 16);
    x.lineTo(i + 8, 0);
    x.lineTo(i + 16, 0);
    x.lineTo(i + 8, 16);
    x.fill();
  }
  const stripes = new THREE.CanvasTexture(c);
  stripes.wrapS = THREE.RepeatWrapping;
  stripes.repeat.x = 4;
  stripes.colorSpace = THREE.SRGBColorSpace;
  turretMats = {
    white: new THREE.MeshStandardMaterial({ color: 0xe4e6e8, metalness: 0.15, roughness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.42 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa1aa, metalness: 0.92, roughness: 0.26 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141517, metalness: 0.1, roughness: 0.85 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    stripes: new THREE.MeshStandardMaterial({ map: stripes, metalness: 0.3, roughness: 0.5 }),
  };
  return turretMats;
}

/** brilho redondo (sprite aditivo) para a lente, a boca e a chama */
let glowTex = null;
function glowSprite(color, size) {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  s.scale.setScalar(size);
  return s;
}

const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};

/** torreta de foguetes: base giratória, braço hidráulico, garfo e cabeça com tubo lançador e sensor; mira com laser, trava, dispara */
export class RocketTurret {
  constructor(scene, pos, enabled) {
    this.pos = pos.clone();
    this.enabled = enabled;
    this.lock = 0;
    this.cool = 1.5;
    this.lockTime = 1.6; // tempo de mira antes do tiro
    this.coolTime = 3.5; // intervalo entre tiros
    this.yaw = 0;
    this.pitch = -0.45;
    this.kick = 0; // recuo do tubo depois do tiro (1 → 0)
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    const M = turretMaterials();

    // base no chão (o original sobe de um alçapão): placa oitavada, parafusos e faixa de alerta
    const plate = mesh(new THREE.CylinderGeometry(0.56, 0.64, 0.12, 8), M.dark, 0, 0.06);
    plate.rotation.y = Math.PI / 8;
    const band = mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.07, 48, 1, true), M.stripes, 0, 0.155);
    const rim = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 48), M.dark, 0, 0.19);
    this.group.add(plate, band, rim);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      this.group.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), M.steel, Math.cos(a) * 0.55, 0.13, Math.sin(a) * 0.55));
    }

    // parte que gira (yaw): mesa, braço, mangueiras e garfo
    this.turn = new THREE.Group();
    this.group.add(this.turn);
    this.turn.add(
      mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.14, 40), M.steel, 0, 0.26),
      mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.1, 40), M.white, 0, 0.38),
      mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.55, 24), M.white, 0, 0.7),
      mesh(new THREE.TorusGeometry(0.18, 0.03, 10, 32).rotateX(Math.PI / 2), M.dark, 0, 0.98),
      mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 20), M.steel, 0, 1.15),
      mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.08, 24), M.dark, 0, 1.33),
    );
    for (const sx of [-1, 1]) {
      const hose = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 0.2, 0.5, 0.12), new THREE.Vector3(sx * 0.34, 0.85, 0.2), new THREE.Vector3(sx * 0.32, 1.25, 0.12), new THREE.Vector3(sx * 0.42, 1.45, 0.05)]);
      this.turn.add(mesh(new THREE.TubeGeometry(hose, 20, 0.022, 8), M.rubber));
    }
    // garfo: travessa e dois braços com os eixos da cabeça
    this.turn.add(mesh(new RoundedBoxGeometry(1.02, 0.1, 0.26, 2, 0.03), M.dark, 0, 1.38));
    for (const sx of [-1, 1]) {
      this.turn.add(mesh(new RoundedBoxGeometry(0.08, 0.36, 0.26, 2, 0.03), M.dark, sx * 0.47, 1.55));
      this.turn.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24).rotateZ(Math.PI / 2), M.steel, sx * 0.52, 1.55));
      this.turn.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 12).rotateZ(Math.PI / 2), M.dark, sx * 0.56, 1.55));
    }

    // cabeça (pitch): corpo branco com emenda escura, tubo lançador, sensor e aletas atrás
    this.head = new THREE.Group();
    this.head.position.y = 1.55;
    this.turn.add(this.head);
    this.head.add(
      mesh(new RoundedBoxGeometry(0.74, 0.5, 0.78, 4, 0.1), M.white, 0, 0, 0.06),
      mesh(new RoundedBoxGeometry(0.77, 0.05, 0.8, 2, 0.02), M.dark, 0, 0.02, 0.06),
      mesh(new RoundedBoxGeometry(0.5, 0.06, 0.4, 2, 0.02), M.dark, 0, 0.26, 0.14), // tampa de cima
    );
    for (let k = 0; k < 4; k++) this.head.add(mesh(new THREE.BoxGeometry(0.42, 0.015, 0.03), M.rubber, 0, 0.295, 0.02 + k * 0.08)); // grade de ventilação
    // aletas de refrigeração atrás
    for (let k = 0; k < 5; k++) this.head.add(mesh(new THREE.BoxGeometry(0.03, 0.34, 0.12), M.dark, -0.2 + k * 0.1, 0, 0.5));
    // tubo lançador (recua no tiro)
    this.tube = new THREE.Group();
    this.tube.position.set(0, 0.03, 0);
    this.head.add(this.tube);
    this.tube.add(
      mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.95, 32).rotateX(Math.PI / 2), M.dark, 0, 0, -0.62),
      mesh(new THREE.CylinderGeometry(0.21, 0.16, 0.16, 32, 1, true).rotateX(Math.PI / 2), M.steel, 0, 0, -1.14), // boca alargada
      mesh(new THREE.CircleGeometry(0.15, 24).rotateY(Math.PI), M.hole, 0, 0, -1.08),
    );
    for (const z of [-0.36, -0.68, -0.98]) this.tube.add(mesh(new THREE.TorusGeometry(0.155, 0.022, 10, 32), M.steel, 0, 0, z));
    // trilho de cima do tubo
    this.tube.add(mesh(new THREE.BoxGeometry(0.06, 0.05, 0.7), M.steel, 0, 0.17, -0.6));
    // o foguete carregado aparece na boca do tubo (some no tiro e volta recarregado)
    this.loaded = mesh(new THREE.ConeGeometry(0.1, 0.18, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9302a, metalness: 0.4, roughness: 0.4 }), 0, 0, -1.02);
    this.tube.add(this.loaded);
    // sensor (olho) abaixo do tubo, de lado
    this.head.add(
      mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.24, 24).rotateX(Math.PI / 2), M.dark, 0.24, -0.15, -0.38),
      mesh(new THREE.TorusGeometry(0.09, 0.015, 8, 24), M.steel, 0.24, -0.15, -0.5),
    );
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.06), toneMapped: false });
    this.head.add(mesh(new THREE.CircleGeometry(0.07, 24).rotateY(Math.PI), this.lensMat, 0.24, -0.15, -0.505));
    this.lensGlow = glowSprite(0xff2a1a, 0.35);
    this.lensGlow.position.set(0.24, -0.15, -0.53);
    this.head.add(this.lensGlow);

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.z = -1.35;
    this.head.add(this.muzzle);
    // clarão do tiro na boca
    this.flash = glowSprite(0xffb050, 1.4);
    this.flash.position.z = -1.25;
    this.flash.visible = false;
    this.head.add(this.flash);

    const lm = new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85 });
    this.laser = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), lm); // dois pedaços: até o portal e depois dele
    this.laser.frustumCulled = false;
    scene.add(this.group, this.laser);
  }

  /** gira a base e inclina a cabeça na direção de `eye` (suave), ou abaixa a cabeça desligada */
  aim(dt, eye) {
    let yaw = this.yaw;
    let pitch = -0.45;
    if (eye) {
      this.group.updateWorldMatrix(true, false);
      const d = this.group.worldToLocal(eye.clone());
      d.y -= this.head.position.y;
      yaw = Math.atan2(-d.x, -d.z);
      pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    const k = 1 - Math.exp(-dt * (eye ? 12 : 3));
    let dy = yaw - this.yaw;
    dy = ((((dy + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    this.yaw += dy * k;
    this.pitch += (THREE.MathUtils.clamp(pitch, -1.2, 1.2) - this.pitch) * k;
    this.turn.rotation.y = this.yaw;
    this.head.rotation.x = this.pitch;
  }

  /**
   * linha de visão da boca até `eye`: direta ou por um par de portais (ela mira no
   * "você" visto dentro do portal). Devolve { aim, pts } (aim: para onde apontar;
   * pts: os pedaços do laser) ou null se nada enxerga você
   */
  sight(from, eye, world, portals) {
    // vê através de vidro (como no original: ela mira em você e o foguete quebra o vidro)
    const solid = (b) => b.mat !== 'glass' && !b.breakable;
    const clear = (a, b) => {
      const d = b.clone().sub(a);
      const len = d.length();
      return len < 1e-4 || !world.raycast(a, d.divideScalar(len), len, solid);
    };
    if (clear(from, eye)) return { aim: eye, pts: [from, eye, eye, eye], dist: from.distanceTo(eye) };
    let best = null;
    for (const P of portals?.list ?? []) {
      if (!portals.isLinked(P) || P.delta > 0 || P.partner.delta > 0) continue;
      // você, visto pelo portal P (o mundo do outro lado trazido para cá)
      const ghost = eye.clone().applyMatrix4(portals.transform(P.partner, P));
      const n = P.normal;
      const sa = from.clone().sub(P.center).dot(n);
      const sb = ghost.clone().sub(P.center).dot(n);
      if (!(sa > 0 && sb < 0)) continue;
      const hit = from.clone().lerp(ghost, sa / (sa - sb));
      const l = P.local(hit.clone());
      if (Math.abs(l.x) > PORTAL_A * 0.95 || Math.abs(l.y) > PORTAL_B * 0.95) continue;
      const dir = ghost.clone().sub(from).normalize();
      const out = hit.clone().applyMatrix4(portals.transform(P, P.partner));
      if (!clear(from, hit.clone().addScaledVector(dir, -0.05))) continue;
      const dirOut = eye.clone().sub(out).normalize();
      if (!clear(out.clone().addScaledVector(dirOut, 0.05), eye)) continue;
      const dist = from.distanceTo(ghost);
      if (!best || dist < best.dist) best = { aim: ghost, pts: [from, hit, out, eye], dist };
    }
    return best;
  }

  /** devolve { pos, dir } quando dispara; `portals` (opcional): também enxerga através deles */
  update(dt, eye, world, portals = null) {
    this.laser.visible = false;
    this.kick = Math.max(0, this.kick - dt * 2.5);
    this.tube.position.z = 0.16 * this.kick * this.kick;
    this.flash.visible = this.kick > 0.82;
    if (this.flash.visible) this.flash.material.opacity = (this.kick - 0.82) / 0.18;
    this.loaded.visible = this.cool < this.coolTime - 0.8;
    const glow = (v) => {
      this.lensMat.color.setRGB(0.3 + 2.2 * v, 0.03 + 0.15 * v, 0.02 + 0.1 * v);
      this.lensGlow.material.opacity = v;
      this.lensGlow.scale.setScalar(0.25 + 0.3 * v);
    };
    if (!this.enabled) {
      this.lock = 0;
      this.aim(dt, null);
      glow(0.05);
      return null;
    }
    this.cool -= dt;
    const see = this.sight(this.muzzle.getWorldPosition(new THREE.Vector3()), eye, world, portals);
    if (!see) {
      this.aim(dt, this.lastAim ?? eye); // fica olhando para onde viu você por último
      this.lock = Math.max(0, this.lock - dt);
      glow(0.35);
      return null;
    }
    this.lastAim = see.aim.clone();
    this.aim(dt, see.aim);
    const from = this.muzzle.getWorldPosition(new THREE.Vector3());
    const to = see.aim.clone().sub(from).normalize();
    const p = Math.min(1, this.lock / this.lockTime);
    // travando: a lente pisca cada vez mais rápido
    glow(0.5 + 0.5 * p * (0.6 + 0.4 * Math.sin(performance.now() * 0.001 * (8 + 30 * p))));
    this.laser.visible = true;
    see.pts[0] = from;
    this.laser.geometry.setFromPoints(see.pts);
    this.laser.material.opacity = 0.4 + 0.5 * p;
    this.lock += dt;
    if (this.lock > this.lockTime && this.cool <= 0) {
      this.lock = 0;
      this.cool = this.coolTime;
      this.kick = 1;
      return { pos: from, dir: to };
    }
    return null;
  }
}

// ---------------------------------------------------------------- foguete

let rocketParts = null;
function rocketGeometry() {
  if (rocketParts) return rocketParts;
  // corpo + ogiva num só torno (eixo y; vira −z = frente)
  const prof = [
    [0, -0.27],
    [0.055, -0.27],
    [0.068, -0.24],
    [0.068, 0.1],
  ];
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    prof.push([0.068 * Math.cos((t * Math.PI) / 2) ** 0.8, 0.1 + 0.24 * Math.sin((t * Math.PI) / 2)]);
  }
  const body = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    24,
  ).rotateX(-Math.PI / 2);
  const fin = new THREE.BufferGeometry();
  // aleta em trapézio (plano yz), espessura fina
  const shape = new THREE.Shape([new THREE.Vector2(0, -0.27), new THREE.Vector2(0.15, -0.3), new THREE.Vector2(0.15, -0.22), new THREE.Vector2(0, -0.1)]);
  fin.copy(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }).translate(0, 0, -0.006).rotateX(-Math.PI / 2));
  rocketParts = {
    body,
    fin,
    white: new THREE.MeshStandardMaterial({ color: 0xe8e9ea, metalness: 0.25, roughness: 0.35 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc9302a, metalness: 0.3, roughness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x26282c, metalness: 0.8, roughness: 0.35 }),
    flameOut: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.42, 0.1).multiplyScalar(1.3), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    flameIn: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.6).multiplyScalar(3), toneMapped: false }),
  };
  return rocketParts;
}

// fumaça: cada bolinha se apaga sozinha (mesmo depois que o foguete explode: quem
// estiver na tela se atualiza ao ser desenhada)
const puffs = new Set();
let agedAt = -1;
function agePuffs(now) {
  if (now === agedAt) return;
  agedAt = now;
  for (const P of puffs) {
    const a = (now - P.born) / P.life;
    if (a >= 1) {
      P.m.visible = false;
      puffs.delete(P);
      queueMicrotask(() => {
        P.m.removeFromParent();
        P.m.material.dispose();
      });
      continue;
    }
    P.m.scale.setScalar(0.12 + 0.55 * Math.sqrt(a));
    P.m.material.opacity = 0.5 * (1 - a) ** 1.5;
    P.m.position.y = P.y0 + 0.3 * a; // sobe devagar
  }
}
const ageOnDraw = () => agePuffs(performance.now() * 0.001);

/** foguete: voa reto, atravessa portais, explode no que tocar */
export class Rocket {
  constructor(scene, pos, dir) {
    this.pos = pos.clone();
    this.dir = dir.clone().normalize();
    this.speed = 9;
    this.life = 12;
    this.scene = scene;
    const R = rocketGeometry();
    this.mesh = new THREE.Group();
    this.spin = new THREE.Group(); // gira em torno do próprio eixo
    this.mesh.add(this.spin);
    this.spin.add(new THREE.Mesh(R.body, R.white));
    // faixa vermelha atrás da ogiva, ponta escura e bocal
    this.spin.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 24).rotateX(Math.PI / 2), R.red, 0, 0, -0.07));
    this.spin.add(mesh(new THREE.CylinderGeometry(0.0695, 0.0695, 0.02, 24).rotateX(Math.PI / 2), R.dark, 0, 0, 0.12));
    this.spin.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.07, 20, 1, true).rotateX(Math.PI / 2), R.dark, 0, 0, 0.3));
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(R.fin, R.red);
      f.rotation.z = (k / 4) * TAU + Math.PI / 4;
      this.spin.add(f);
    }
    // chama: cone externo laranja, núcleo claro e brilho
    this.flame = new THREE.Group();
    this.flame.position.z = 0.33;
    this.flame.add(mesh(new THREE.ConeGeometry(0.075, 0.5, 14, 1, true).rotateX(-Math.PI / 2), R.flameOut, 0, 0, 0.22));
    this.flame.add(mesh(new THREE.ConeGeometry(0.04, 0.22, 12).rotateX(-Math.PI / 2), R.flameIn, 0, 0, 0.09));
    this.flame.add(glowSprite(0xff9a40, 0.9));
    this.mesh.add(this.flame);
    scene.add(this.mesh);
    this.lastPuff = 0;
    this.sync();
  }

  sync() {
    const now = performance.now() * 0.001;
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(this.pos.clone().sub(this.dir));
    this.spin.rotation.z = now * 5;
    const f = 0.85 + 0.3 * Math.random();
    this.flame.scale.set(f, f, 0.8 + 0.5 * Math.random());
    agePuffs(now);
    if (now - this.lastPuff > 0.025) {
      this.lastPuff = now;
      const m = glowSprite(0xbdbdbd, 0.12);
      m.material.blending = THREE.NormalBlending;
      m.material.toneMapped = true;
      m.material.rotation = Math.random() * TAU;
      m.position.copy(this.pos).addScaledVector(this.dir, -0.4);
      m.onBeforeRender = ageOnDraw;
      this.scene.add(m);
      puffs.add({ m, born: now, life: 0.9 + Math.random() * 0.4, y0: m.position.y });
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}

/** clarão da explosão (esfera que cresce e some) */
export function explosion(scene, pos, list) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(2), transparent: true, toneMapped: false, depthWrite: false }));
  m.position.copy(pos);
  scene.add(m);
  list.push({ m, t: 0 });
}

/** botão de pedestal (desenho próprio): base, coluna, cabeça inclinada e botão vermelho */
export function pedestalSwitch() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d32, metalness: 0.7, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe2e2de, metalness: 0.1, roughness: 0.35 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.08, 28), dark);
  base.position.y = 0.04;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 20), white);
  post.position.y = 0.58;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.12, 28), dark);
  head.position.y = 1.14;
  const capMat = new THREE.MeshStandardMaterial({ color: 0xc0140d, emissive: 0x5a0805, roughness: 0.35 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 28), capMat);
  const capY = 1.22;
  cap.position.y = capY;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 8, 32).rotateX(Math.PI / 2), white);
  ring.position.y = 1.2;
  g.add(base, post, head, cap, ring);
  g.userData = { cap, capMat, capY, k: 0 };
  return g;
}
