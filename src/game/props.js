// Objetos físicos que o jogador pode pegar: a base comum (corpo rígido que
// atravessa portais e é segurado na frente da câmera) e o cubo de amostra.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _d = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const MAX_FALL = 40;

export class Prop {
  constructor(physics, portals, mesh) {
    this.physics = physics;
    this.portals = portals;
    this.mesh = mesh;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.held = false;
    this.gone = false;
    this.cooldown = 0;
    this.holdLocal = null; // ponto na frente da câmera enquanto segurado (lado do jogador)
    this.holdQuatLocal = null;
    this.holdTarget = new THREE.Vector3(); // o mesmo ponto, do lado em que o objeto está
    this.holdQuat = new THREE.Quaternion();
    this.remote = null; // posição vinda da rede (outra pessoa segurando)
    this.meshOffset = new THREE.Vector3();
    // segurado: leva coordenadas do lado do jogador para o lado em que o objeto
    // está (muda quando um dos dois atravessa um portal sem o outro)
    this.space = new THREE.Matrix4();
  }

  /** chamado pelo motor antes de cada passo */
  pre(h, g) {
    const b = this.body;
    this.cooldown -= h;
    const now = performance.now();
    if (this.remote && now - this.remote.t < 400 && !this.held) {
      // outra pessoa está movendo: segue a posição da rede
      const t = b.translation();
      _v.set(t.x, t.y, t.z).lerp(this.remote.p, Math.min(1, h * 18));
      b.setTranslation(_v, true);
      if (this.remote.q) b.setRotation(_q.slerpQuaternions(this.quat, this.remote.q, Math.min(1, h * 18)), true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }
    if (this.held && this.holdLocal) {
      // segurado: vai até o ponto na frente da câmera e gira para ficar "de frente"
      this.updateHold();
      const t = b.translation();
      _v.set(this.holdTarget.x - t.x, this.holdTarget.y - t.y, this.holdTarget.z - t.z).multiplyScalar(16);
      if (_v.length() > 20) _v.setLength(20);
      b.setLinvel(_v, true);
      {
        const r = b.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        _d.copy(this.holdQuat).multiply(_q.invert());
        if (_d.w < 0) _d.set(-_d.x, -_d.y, -_d.z, -_d.w);
        const ang = 2 * Math.acos(Math.min(1, _d.w));
        const s = Math.sqrt(Math.max(1e-9, 1 - _d.w * _d.w));
        b.setAngvel({ x: (_d.x / s) * ang * 10, y: (_d.y / s) * ang * 10, z: (_d.z / s) * ang * 10 }, true);
      }
      return;
    }
    if (b.isSleeping()) return;
    const v = b.linvel();
    _v.set(v.x + g.x * h, v.y + g.y * h, v.z + g.z * h);
    if (_v.length() > MAX_FALL) _v.setLength(MAX_FALL);
    b.setLinvel(_v, false);
  }

  /** chamado depois de cada passo: passagem pelos portais */
  post(gravityAt) {
    const t = this.body.translation();
    this.pos.set(t.x, t.y, t.z);
    if (this.cooldown > 0) return;
    let P = this.portals.crossing(this.prevCenter, this.pos, 'prop'); // também o azul temporal: o objeto vai para o laranja
    if (!P) P = this.portals.stuckIn(this.pos, _v.copy(this.pos).subScalar(0.3), this.pos.clone().addScalar(0.3));
    if (!P) return;
    const { Q } = this.physics.carry(this, P);
    if (this.held) this.space.premultiply(this.portals.transform(P, P.partner));
    const t2 = this.body.translation();
    this.pos.set(t2.x, t2.y, t2.z);
    if (!this.held) {
      const v = this.body.linvel();
      _v.set(v.x, v.y, v.z);
      this.portals.exitAssist(Q, this.pos, _v, this.half, gravityAt(this.pos), Q.up);
      this.body.setLinvel(_v, true);
    }
    this.cooldown = 0.15;
    this.onPortal?.(P);
  }

  /** alvo de quem segura levado para o lado do portal em que o objeto está */
  updateHold() {
    this.holdTarget.copy(this.holdLocal).applyMatrix4(this.space);
    this.holdQuat.setFromRotationMatrix(_m.extractRotation(this.space)).multiply(this.holdQuatLocal);
  }

  /** copia o estado do corpo para os campos e para o modelo */
  sync() {
    if (!this.body) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(v.x, v.y, v.z);
    this.mesh.visible = !this.gone;
    this.mesh.quaternion.copy(this.quat);
    this.mesh.position.copy(this.meshOffset).applyQuaternion(this.quat).add(this.pos);
  }

  /** teletransporta (respawn, passagem junto com o jogador, rede) */
  place(p, q = null, v = null) {
    const b = this.body;
    b.setTranslation(p, true);
    if (q) b.setRotation(q, true);
    b.setLinvel(v ?? { x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.prevCenter?.copy(p);
    this.cooldown = 0.15;
    this.sync();
  }

  /** desintegrado / queimado: sai da simulação até voltar */
  vanish() {
    this.gone = true;
    this.held = false;
    this.body?.setEnabled(false);
    this.mesh.visible = false;
  }

  /** arremessa (soltar com velocidade) */
  throw(v) {
    this.body.setLinvel(v, true);
  }
}

/** Cubo de amostra (pode ser carregado, empilhado, arremessado e atravessa portais) */
export class Cube extends Prop {
  constructor(physics, portals, mesh, x, y, z, opts = {}) {
    super(physics, portals, mesh);
    this.kind = 'cube';
    this.special = !!opts.special;
    this.redirect = !!opts.laser; // cubo refletor de laser (o feixe sai pela face +z)
    this.half = new THREE.Vector3(0.3, 0.3, 0.3);
    this.home = new THREE.Vector3(x, y + 0.31, z);
    this.homeQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.yaw ?? 0);
    physics.addProp(this, { shapes: [{ half: [0.29, 0.29, 0.29] }], mass: 30, friction: 0.85, restitution: 0.04, pos: this.home, quat: this.homeQuat });
    this.sync();
  }

  respawn() {
    this.held = false;
    this.gone = false;
    this.body.setEnabled(true);
    this.place(this.home, this.homeQuat);
  }
}
