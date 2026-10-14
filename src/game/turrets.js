// Torretas de segurança. Cada torreta é um corpo rígido (tripé largo, centro
// de massa baixo): cai, tomba quando empurrada ou atingida, atravessa portais
// e pode ser carregada. Se ficar caída, desliga. Também desliga se você chegar
// por trás e apertar E, ou se for atingida por uma amostra arremessada.
// Como nos jogos do gênero, ela não gira para te seguir: enxerga num cone à
// frente do corpo, e cubos no caminho bloqueiam a mira e os tiros.

import * as THREE from 'three';
import { Prop } from './props.js';
import { turretModel } from './models.js';

const RANGE = 26;
const FOV = THREE.MathUtils.degToRad(55);
const UP = new THREE.Vector3(0, 1, 0);

export class Turret extends Prop {
  constructor(scene, physics, portals, x, y, z, yaw) {
    super(physics, portals, turretModel());
    this.kind = 'turret';
    scene.add(this.mesh);
    this.half = new THREE.Vector3(0.28, 0.6, 0.28);
    this.meshOffset.set(0, -0.6, 0);
    this.home = new THREE.Vector3(x, y + 0.62, z);
    this.homeQuat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    physics.addProp(this, {
      shapes: [
        { half: [0.21, 0.4, 0.17], at: [0, 0.2, 0] }, // corpo
        { half: [0.34, 0.05, 0.34], at: [0, -0.55, -0.06] }, // pés do tripé
      ],
      mass: 35,
      friction: 0.9,
      restitution: 0.02,
      pos: this.home,
      quat: this.homeQuat,
    });
    this.sync();
    this.active = true;
    this.lock = 0; // 0..1: tempo mirando antes de atirar
    this.fireAcc = 0;
    this.spotted = false;
    this.deploy = 0; // 0..1: metades abertas mostrando os canos
    this.fallen = 0;
    const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85 }));
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
    // rastros das balas (riscos curtos que somem rápido)
    this.tracers = Array.from({ length: 3 }, () => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false }),
      );
      l.frustumCulled = false;
      scene.add(l);
      return l;
    });
    this.tracerI = 0;
    this.flashT = 0;
    this.barrelI = 0;
    this.eyeK = 1;
  }

  /** clarão no cano da vez, recuo e um rastro até perto do alvo */
  muzzle(target) {
    const { flashes, barrels } = this.mesh.userData;
    this.barrelI = (this.barrelI + 1) % barrels.length;
    this.flashT = 0.05;
    barrels[this.barrelI].userData.kick = 1;
    const from = flashes[this.barrelI].getWorldPosition(new THREE.Vector3());
    const to = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.5 - 0.1, (Math.random() - 0.5) * 0.6));
    const tr = this.tracers[this.tracerI++ % this.tracers.length];
    // só um pedaço do caminho (risco de bala, não um laser)
    const d = to.clone().sub(from);
    const a = from.clone().addScaledVector(d, Math.random() * 0.4);
    const b = a.clone().addScaledVector(d.normalize(), 1.6);
    tr.geometry.setFromPoints([a, b]);
    tr.material.opacity = 0.9;
    tr.userData.vel = d.multiplyScalar(60);
  }

  /** animação que não depende de estar ligada: clarões, recuo, rastros, olho */
  animate(dt) {
    const u = this.mesh.userData;
    this.flashT -= dt;
    u.flashes.forEach((f, i) => {
      f.visible = this.flashT > 0 && i === this.barrelI;
      if (f.visible) {
        f.material.rotation = Math.random() * Math.PI * 2;
        f.scale.setScalar(0.16 + Math.random() * 0.1);
      }
    });
    u.flashLight.intensity = this.flashT > 0 ? 6 : 0;
    for (const b of u.barrels) {
      b.userData.kick = Math.max(0, (b.userData.kick ?? 0) - dt * 25);
      b.position.z = 0.07 - b.userData.kick * 0.025;
    }
    for (const tr of this.tracers) {
      if (tr.material.opacity <= 0) continue;
      tr.material.opacity = Math.max(0, tr.material.opacity - dt * 12);
      const p = tr.geometry.attributes.position;
      const v = tr.userData.vel;
      for (let i = 0; i < 2; i++) p.setXYZ(i, p.getX(i) + v.x * dt, p.getY(i) + v.y * dt, p.getZ(i) + v.z * dt);
      p.needsUpdate = true;
    }
    // olho: respira devagar procurando, acende forte mirando, apaga desligada
    const target = !this.active ? 0 : this.lock > 0 ? 1.4 + this.lock * 0.6 : 0.85 + Math.sin(performance.now() / 300) * 0.15;
    this.eyeK += (target - this.eyeK) * Math.min(1, dt * (this.active ? 10 : 2.5));
    u.lensMat.color.setRGB(3 * this.eyeK + 0.12, 0.15 * this.eyeK + 0.02, 0.1 * this.eyeK + 0.02);
    u.eyeGlow.visible = this.eyeK > 0.05;
    u.eyeGlow.material.opacity = Math.min(1, this.eyeK);
    u.eyeGlow.scale.setScalar(0.22 + this.eyeK * 0.1);
  }

  get eye() {
    return new THREE.Vector3(0, 0.35, 0.2).applyQuaternion(this.quat).add(this.pos);
  }

  forward() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
  }

  get upright() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
  }

  disable(reason, push = 0) {
    if (!this.active) return false;
    this.active = false;
    this.laser.visible = false;
    this.downReason = reason;
    // desligada à mão: dá um tranco para ela tombar para a frente
    if (push && this.body) {
      const f = this.forward().multiplyScalar(push);
      const top = new THREE.Vector3(0, 0.55, 0).applyQuaternion(this.quat).add(this.pos);
      this.body.applyImpulseAtPoint({ x: f.x, y: 0, z: f.z }, top, true);
    }
    return true;
  }

  /**
   * mira e tiros; `target` = olho do jogador local. A física já foi feita pelo
   * motor. Devolve os tiros disparados neste quadro.
   */
  update(dt, world, portals, gravityAt, target, cubes) {
    this.animate(dt);
    // caída (deitada) por um tempinho: desliga
    const gUp = gravityAt(this.pos).clone().normalize().negate();
    this.fallen = this.upright.dot(gUp) < 0.6 ? this.fallen + dt : 0;
    if (this.fallen > 0.3) this.disable('queda');
    // amostra arremessada derruba
    for (const cube of cubes ?? [])
      if (!cube.held && cube.vel.length() > 4 && cube.pos.distanceTo(this.pos) < 0.8) this.disable('amostra');

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
    this.spottedNow = false;
    if (!this.active || !target || this.held || this.gone) {
      this.lock = 0;
      return 0;
    }
    // vê o jogador? (cone à frente do corpo; cubos e paredes bloqueiam)
    const eye = this.eye;
    const fwd = this.forward();
    const to = target.clone().sub(eye);
    const dist = to.length();
    const dir = to.clone().divideScalar(dist);
    let sees = dist < RANGE && Math.acos(THREE.MathUtils.clamp(dir.dot(fwd), -1, 1)) < FOV;
    if (sees) {
      const hit = this.physics.castRay(eye, dir, dist - 0.4, (p) => p === this);
      if (hit) sees = false;
    }
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
          this.muzzle(target);
        }
      }
    } else {
      this.lock = Math.max(0, this.lock - dt);
      // laser varrendo devagar à frente
      const sweep = fwd.clone().applyAxisAngle(this.upright, Math.sin(performance.now() / 1400) * 0.45);
      const hit = this.physics.castRay(eye, sweep, RANGE, (p) => p === this);
      this.laser.visible = true;
      this.laser.material.opacity = 0.35;
      this.laser.geometry.setFromPoints([eye, eye.clone().addScaledVector(sweep, hit ? hit.dist : RANGE)]);
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
    const f = this.forward().setY(0).normalize();
    return flat.dot(f) < 0.2;
  }

  respawn() {
    this.held = false;
    this.gone = false;
    this.body.setEnabled(true);
    this.place(this.home, this.homeQuat);
  }

  vanish() {
    super.vanish();
    this.disable('destruída');
    this.laser.visible = false;
  }

  dispose(scene) {
    scene.remove(this.mesh, this.laser, ...this.tracers);
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
