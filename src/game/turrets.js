// Torretas de segurança (mapa livre). Cada torreta é um corpo físico: cai
// pela gravidade, atravessa portais e, se cair de mau jeito, desliga.
// Também desliga se você chegar por trás e apertar E, ou se for atingida por
// uma amostra arremessada.

import * as THREE from 'three';
import { moveBody } from './player.js';
import { turretModel } from './models.js';

const RANGE = 26;
const FOV = THREE.MathUtils.degToRad(55);

function turretMesh() {
  return turretModel();
}

export class Turret {
  constructor(scene, x, y, z, yaw) {
    this.mesh = turretMesh();
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(x, y + 0.6, z);
    this.home = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.half = new THREE.Vector3(0.28, 0.6, 0.28);
    this.yaw = yaw;
    this.aimYaw = yaw;
    this.active = true;
    this.tip = 0;
    this.lock = 0; // 0..1: tempo mirando antes de atirar
    this.fireAcc = 0;
    this.prev = this.pos.clone();
    this.cooldown = 0;
    this.airTime = 0;
    this.spotted = false;
    this.deploy = 0; // 0..1: metades abertas mostrando os canos
    const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85 }));
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
  }

  get eye() {
    return this.pos.clone().add(new THREE.Vector3(0, 0.35, 0));
  }

  forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  disable(reason) {
    if (!this.active) return false;
    this.active = false;
    this.laser.visible = false;
    this.mesh.userData.lensMat.color.setRGB(0.15, 0.02, 0.02);
    this.mesh.userData.eyeGlow.visible = false;
    this.downReason = reason;
    return true;
  }

  /** atualiza física e mira; `target` = olho do jogador local. Devolve tiros disparados neste quadro. */
  update(dt, world, portals, gravityAt, target, cubes) {
    // física (cai, atravessa portais)
    this.vel.addScaledVector(gravityAt(this.pos), dt);
    this.prev.copy(this.pos);
    const vy = this.vel.y;
    const c = moveBody(this, this.vel.clone().multiplyScalar(dt), world, portals, false);
    if (c.y) {
      if (vy < -6.5 && this.active) this.disable('queda');
      this.vel.x *= 0.7;
      this.vel.z *= 0.7;
    }
    this.cooldown -= dt;
    let P = this.cooldown <= 0 ? portals.crossing(this.prev, this.pos) : null;
    if (P) {
      const { Q } = portals.carry(P, this.pos, this.vel);
      portals.exitAssist(Q, this.pos, this.vel, this.half, gravityAt(this.pos), Q.up);
      this.cooldown = 0.2;
      if (this.active) this.disable('portal');
    }
    // amostra arremessada derruba
    for (const cube of cubes ?? [])
      if (cube.vel.length() > 4 && cube.pos.distanceTo(this.pos) < 0.75) {
        if (this.disable('amostra')) this.vel.addScaledVector(cube.vel, 0.4);
      }

    // visual
    this.tip = Math.min(1, this.tip + (this.active ? 0 : dt * 3));
    this.mesh.position.copy(this.pos).add(new THREE.Vector3(0, -0.6, 0));
    this.mesh.rotation.set(0, this.aimYaw, 0);
    this.mesh.rotateX(this.tip * 1.45);

    // abre as metades quando está mirando em alguém
    this.deploy += ((this.active && this.lock > 0 ? 1 : 0) - this.deploy) * Math.min(1, dt * 8);
    const { halves, guns } = this.mesh.userData;
    halves.forEach((h, i) => {
      const s = i ? 1 : -1;
      h.position.x = s * (0.006 + this.deploy * 0.07);
      guns[i].position.x = -s * (0.02 - this.deploy * 0.06);
    });

    let shots = 0;
    this.laser.visible = false;
    if (!this.active || !target) {
      this.lock = 0;
      return 0;
    }
    // vê o jogador?
    const eye = this.eye;
    const to = target.clone().sub(eye);
    const dist = to.length();
    const flat = new THREE.Vector3(to.x, 0, to.z).normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(flat.dot(this.forward()), -1, 1));
    let sees = dist < RANGE && ang < FOV;
    if (sees) {
      const hit = world.raycast(eye, to.clone().normalize(), dist - 0.3);
      if (hit) sees = false;
    }
    const want = sees ? Math.atan2(to.x, to.z) : this.yaw + Math.sin(performance.now() / 1400) * 0.5;
    let dy = want - this.aimYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.aimYaw += dy * Math.min(1, dt * (sees ? 6 : 1.2));
    if (sees) {
      this.lock = Math.min(1, this.lock + dt / 0.7);
      this.laser.visible = true;
      this.laser.geometry.setFromPoints([eye, target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.05, -0.15, 0))]);
      this.laser.material.opacity = 0.4 + this.lock * 0.5;
      if (this.lock >= 1) {
        this.fireAcc += dt;
        while (this.fireAcc > 0.1) {
          this.fireAcc -= 0.1;
          shots++;
        }
      }
    } else {
      this.lock = Math.max(0, this.lock - dt);
      // laser varrendo
      const sweep = new THREE.Vector3(Math.sin(this.aimYaw), -0.05, Math.cos(this.aimYaw));
      const hit = world.raycast(eye, sweep, RANGE);
      this.laser.visible = true;
      this.laser.material.opacity = 0.35;
      this.laser.geometry.setFromPoints([eye, hit ? hit.point : eye.clone().addScaledVector(sweep, RANGE)]);
    }
    this.spottedNow = sees;
    return shots;
  }

  /** o jogador está atrás da torreta e perto o bastante para desligá-la? */
  canDisableFrom(p) {
    if (!this.active) return false;
    const to = p.clone().sub(this.pos);
    if (to.length() > 1.9) return false;
    const flat = new THREE.Vector3(to.x, 0, to.z).normalize();
    return flat.dot(new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw))) < 0.2;
  }

  dispose(scene) {
    scene.remove(this.mesh, this.laser);
  }
}

/** Cristal de quartzo rosa colecionável */
export function crystalMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xff8fc8, emissive: 0xff3a9a, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
  for (const [s, x, z, r] of [
    [1, 0, 0, 0],
    [0.65, 0.18, 0.1, 0.4],
    [0.55, -0.15, -0.08, -0.5],
  ]) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0).scale(0.7, 1.6, 0.7), mat);
    m.scale.setScalar(s);
    m.position.set(x, 0.35 * s, z);
    m.rotation.z = r;
    g.add(m);
  }
  // brilho (sprite, mais barato que luz)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,140,200,0.9)');
  gr.addColorStop(1, 'rgba(255,90,170,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(1.6);
  glow.position.y = 0.35;
  g.add(glow);
  return g;
}
