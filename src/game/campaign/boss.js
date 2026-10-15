// Peças da luta final da campanha importada, com desenho PRÓPRIO deste jogo:
// núcleos (esferas com faixas acesas), torreta de foguetes (lançador de teto
// com mira laser) e a máquina central (tambor suspenso com anéis girando).
// A lógica da fase (quando cada coisa acontece) vem do mapa, pelo sistema de I/O.

import * as THREE from 'three';

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

/** torreta de foguetes de teto: mira com laser, trava, dispara */
export class RocketTurret {
  constructor(scene, pos, enabled) {
    this.pos = pos.clone();
    this.enabled = enabled;
    this.lock = 0;
    this.cool = 1.5;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.4 });
    const light = new THREE.MeshStandardMaterial({ color: 0xc4c8d0, metalness: 0.6, roughness: 0.35 });
    // base no chão e coluna: a cabeça fica na altura de uma pessoa (o original sobe de um alçapão)
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 24), dark);
    mount.position.y = 0.15;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 16), light);
    column.position.y = 0.85;
    this.group.add(mount, column);
    this.head = new THREE.Group();
    this.head.position.y = 1.55;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.9), light);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.1, 16).rotateX(Math.PI / 2), dark);
    barrel.position.z = -0.75;
    this.head.add(body, barrel);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.z = -1.35;
    this.head.add(this.muzzle);
    this.group.add(this.head);
    const lm = new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85 });
    this.laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lm);
    this.laser.frustumCulled = false;
    scene.add(this.group, this.laser);
  }

  /** devolve { pos, dir } quando dispara */
  update(dt, eye, world) {
    this.laser.visible = false;
    if (!this.enabled) {
      this.lock = 0;
      return null;
    }
    this.head.lookAt(eye);
    this.head.rotateY(Math.PI); // a frente do modelo é −z
    const from = this.muzzle.getWorldPosition(new THREE.Vector3());
    const to = eye.clone().sub(from);
    const dist = to.length();
    to.normalize();
    const wall = world.raycast(from, to, dist);
    this.cool -= dt;
    if (wall) {
      this.lock = Math.max(0, this.lock - dt);
      return null;
    }
    this.laser.visible = true;
    this.laser.geometry.setFromPoints([from, eye]);
    this.laser.material.opacity = 0.4 + 0.5 * Math.min(1, this.lock / 1.6);
    this.lock += dt;
    if (this.lock > 1.6 && this.cool <= 0) {
      this.lock = 0;
      this.cool = 3.5;
      return { pos: from, dir: to };
    }
    return null;
  }
}

/** foguete: voa reto, atravessa portais, explode no que tocar */
export class Rocket {
  constructor(scene, pos, dir) {
    this.pos = pos.clone();
    this.dir = dir.clone().normalize();
    this.speed = 9;
    this.life = 12;
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdadde2, metalness: 0.6, roughness: 0.4 }));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(2.5), toneMapped: false }));
    flame.position.z = 0.42;
    this.mesh.add(body, flame);
    scene.add(this.mesh);
    this.scene = scene;
    this.sync();
  }

  sync() {
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(this.pos.clone().sub(this.dir));
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
