// Jogador em primeira pessoa e cubos: colisão de caixas alinhadas aos eixos,
// gravidade (que pode mudar de direção — fase final!) e passagem pelos portais
// conservando o momento ("o que entra rápido, sai rápido").

import * as THREE from 'three';
import { aabbOverlap } from './world.js';

const EYE = 0.7; // altura do olho acima do centro do corpo
const WALK = 4.6;
const JUMP = 4.6;
const MAX_FALL = 32;

const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

const _before = new Set();
const _ID = new THREE.Quaternion();

function pushOut(body, b, contact) {
  let best = null;
  for (const axis of ['x', 'y', 'z']) {
    const lo = body.pos[axis] - body.half[axis];
    const hi = body.pos[axis] + body.half[axis];
    const up = b.max[axis] - lo; // empurrar no sentido +
    const down = hi - b.min[axis]; // empurrar no sentido −
    if (!best || up < best.d) best = { axis, d: up, s: 1 };
    if (down < best.d) best = { axis, d: down, s: -1 };
  }
  body.pos[best.axis] += best.s * (best.d + 1e-4);
  if (Math.sign(body.vel[best.axis]) === -best.s) body.vel[best.axis] = 0;
  contact[best.axis] = -best.s;
}

/** move um corpo AABB, eixo por eixo, resolvendo colisões; devolve contatos */
export function moveBody(body, delta, world, portals, isPlayer) {
  const steps = Math.max(1, Math.ceil(delta.length() / 0.18));
  const d = delta.clone().divideScalar(steps);
  const contact = { x: 0, y: 0, z: 0 };
  for (let s = 0; s < steps; s++) {
    for (const axis of ['y', 'x', 'z']) {
      const dv = d[axis];
      if (dv === 0) continue;
      // caixas em que o corpo já estava enfiado antes deste passo (ex.: atravessando um portal)
      _min.copy(body.pos).sub(body.half);
      _max.copy(body.pos).add(body.half);
      _before.clear();
      for (const b of world.solids) if (aabbOverlap(_min, _max, b.min, b.max)) _before.add(b);
      body.pos[axis] += dv;
      _min.copy(body.pos).sub(body.half);
      _max.copy(body.pos).add(body.half);
      const ignore = portals.ignoreFor(_min, _max, body.pos, isPlayer);
      for (const b of world.solids) {
        if (ignore.has(b) || b === body.box) continue;
        if (!aabbOverlap(_min, _max, b.min, b.max)) continue;
        if (_before.has(b)) {
          // já estava dentro: sai pelo lado de menor penetração (nunca é jogado para trás da parede)
          pushOut(body, b, contact);
          _min.copy(body.pos).sub(body.half);
          _max.copy(body.pos).add(body.half);
          continue;
        }
        if (dv > 0) body.pos[axis] = b.min[axis] - body.half[axis] - 1e-4;
        else body.pos[axis] = b.max[axis] + body.half[axis] + 1e-4;
        contact[axis] = Math.sign(dv);
        body.vel[axis] = 0;
        _min.copy(body.pos).sub(body.half);
        _max.copy(body.pos).add(body.half);
      }
    }
  }
  return contact;
}

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.half = new THREE.Vector3(0.3, 0.9, 0.3);
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.upSign = 1; // −1 = de cabeça para baixo (do outro lado do mundo)
    this.flip = 0; // 0..1, animação da câmera virando
    this.cooldown = 0;
    this.groundTime = 0;
    this.bob = 0;
    // depois de um portal, a câmera começa exatamente onde a vista do portal
    // estava e volta suavemente para a postura de pé (posição e giro)
    this.viewOffset = new THREE.Vector3();
    this.viewRot = new THREE.Quaternion();
  }

  spawn(x, y, z, yaw = 0) {
    this.pos.set(x, y + this.half.y + 0.05, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.upSign = 1;
    this.flip = 0;
    this.viewOffset.set(0, 0, 0);
    this.viewRot.identity();
  }

  eye(target = new THREE.Vector3()) {
    return target.copy(this.pos).add(new THREE.Vector3(0, EYE * this.upSign, 0));
  }

  quaternion() {
    const qF = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * this.flipEase());
    const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const qP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    return qF.multiply(qY).multiply(qP);
  }

  flipEase() {
    const f = this.flip;
    return f * f * (3 - 2 * f);
  }

  forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.viewQuaternion());
  }

  /** orientação que a câmera mostra (inclui o giro residual da passagem pelo portal) */
  viewQuaternion() {
    return this.viewRot.clone().multiply(this.quaternion());
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.55, 1.55);
  }

  update(dt, input, world, portals, gravityAt, onTeleport) {
    const g = gravityAt(this.pos).clone();
    // de cabeça para baixo quando a gravidade aponta para cima
    if (g.y > 0.5 && this.upSign > 0) this.upSign = -1;
    else if (g.y < -0.5 && this.upSign < 0) this.upSign = 1;
    const targetFlip = this.upSign < 0 ? 1 : 0;
    this.flip += Math.sign(targetFlip - this.flip) * Math.min(Math.abs(targetFlip - this.flip), dt / 1.3);

    // direções de movimento no plano do "chão" atual
    const q = this.quaternion();
    const up = new THREE.Vector3(0, this.upSign, 0);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q).projectOnPlane(up).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q).projectOnPlane(up).normalize();
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, (input.f ? 1 : 0) - (input.b ? 1 : 0))
      .addScaledVector(right, (input.r ? 1 : 0) - (input.l ? 1 : 0));
    if (wish.lengthSq() > 0) wish.normalize();

    const horiz = this.vel.clone().projectOnPlane(up);
    const vert = this.vel.clone().sub(horiz);
    if (this.grounded) {
      // no chão: responde rápido, mas não "mata" velocidade de lançamento de uma vez
      const target = wish.clone().multiplyScalar(WALK);
      const k = horiz.length() > WALK * 1.5 ? 4 : 14;
      horiz.lerp(target, 1 - Math.exp(-k * dt));
      if (input.jump) {
        vert.copy(up).multiplyScalar(JUMP);
        this.grounded = false;
        input.jump = false;
      }
    } else {
      // no ar: controle limitado; nunca freia um lançamento
      const add = wish.clone().multiplyScalar(9 * dt);
      const next = horiz.clone().add(add);
      if (next.length() < Math.max(WALK, horiz.length())) horiz.copy(next);
      else horiz.copy(next.setLength(Math.max(WALK, horiz.length())));
    }
    this.vel.copy(horiz).add(vert).addScaledVector(g, dt);
    if (this.vel.length() > MAX_FALL) this.vel.setLength(MAX_FALL);

    const prevCenter = this.pos.clone();
    const contact = moveBody(this, this.vel.clone().multiplyScalar(dt), world, portals, true);
    this.grounded = contact.y === Math.sign(g.y) && g.lengthSq() > 0.01;
    if (this.grounded && horiz.lengthSq() < 0.01) this.groundTime += dt;
    else this.groundTime = 0;

    // o giro e o deslocamento da câmera herdados do portal se desfazem aos poucos
    this.viewOffset.multiplyScalar(Math.exp(-dt * 9));
    this.viewRot.slerp(_ID, 1 - Math.exp(-dt * 6));

    // atravessou um portal? Conta o CENTRO DE MASSA: assim a gravidade age
    // sempre do lado certo e a energia se conserva. A câmera pode ficar um
    // instante atrás da boca do portal — aí ela é desenhada do outro lado
    // (veja applyCamera), então a imagem continua contínua.
    this.portals = portals;
    this.cooldown -= dt;
    let P = null;
    if (this.cooldown <= 0) {
      P = portals.crossing(prevCenter, this.pos);
      if (!P) {
        const mn = this.pos.clone().sub(this.half);
        const mx = this.pos.clone().add(this.half);
        P = portals.stuckIn(this.pos, mn, mx);
      }
    }
    if (P) {
      this.teleport(portals, P, g);
      onTeleport?.(P);
    }
    if (input.f || input.b || input.l || input.r) this.bob += dt * (this.grounded ? 9 : 0);
  }

  teleport(portals, P, g = new THREE.Vector3(0, -9.8, 0)) {
    // vista atual (com o que sobrou da última passagem) levada para o outro lado
    const view = this.eye().add(this.viewOffset);
    const viewQ = this.viewQuaternion();
    const { Q, M, rot } = portals.carry(P, this.pos, this.vel);
    view.applyMatrix4(M);
    viewQ.premultiply(rot);
    // saída numa parede: o corpo (de pé) sai inteiro da boca — deslocamento
    // horizontal, não muda a energia; a câmera não pula (viewOffset absorve)
    const n = Q.normal;
    if (Math.abs(n.y) < 0.5) {
      const need = Math.abs(n.x) * this.half.x + Math.abs(n.z) * this.half.z + 0.03;
      const d = this.pos.clone().sub(Q.center).dot(n);
      if (d < need) this.pos.addScaledVector(n, need - d);
    }

    // nova direção do olhar sem inclinação lateral (o giro fica em viewRot)
    const unflip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI * this.flipEase());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(viewQ).applyQuaternion(unflip);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(viewQ).applyQuaternion(unflip);
    const sp = THREE.MathUtils.clamp(f.y, -0.999, 0.999);
    const cp = Math.sqrt(1 - sp * sp);
    // direção horizontal "para a frente" estável mesmo olhando reto para cima/baixo
    const hx = f.x * cp - u.x * sp;
    const hz = f.z * cp - u.z * sp;
    this.pitch = THREE.MathUtils.clamp(Math.asin(sp), -1.55, 1.55);
    if (hx * hx + hz * hz > 1e-8) this.yaw = Math.atan2(-hx, -hz);
    this.viewRot.copy(viewQ).multiply(this.quaternion().invert());
    this.viewOffset.copy(view).sub(this.eye());

    // portal no chão com pouca velocidade: sai inteiro e para a frente
    const side = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    portals.exitAssist(Q, this.pos, this.vel, this.half, g, side);
    this.cooldown = 0.12;
    this.grounded = false;
  }

  applyCamera(dt, shakeAmt = 0) {
    const b = Math.sin(this.bob) * 0.035 * (this.grounded ? 1 : 0);
    const pos = this.eye().add(this.viewOffset).add(new THREE.Vector3(0, b * this.upSign, 0));
    if (shakeAmt > 0) pos.add(new THREE.Vector3((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt));
    const quat = this.viewQuaternion();
    // câmera atrás da boca de um portal (cabeça entrou antes do corpo, ou logo
    // depois da passagem): desenha do ponto equivalente do outro lado
    const P = this.portals?.behind(pos);
    this.inTransit = !!P || this.viewOffset.lengthSq() > 0.02;
    if (P) {
      const M = this.portals.transform(P, P.partner);
      pos.applyMatrix4(M);
      quat.premultiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(M)));
    }
    this.camera.position.copy(pos);
    this.camera.quaternion.copy(quat);
  }
}

/** Cubo de amostra (pode ser carregado e atravessar portais) */
export class Cube {
  constructor(mesh, x, y, z) {
    this.mesh = mesh;
    this.pos = new THREE.Vector3(x, y + 0.31, z);
    this.home = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.half = new THREE.Vector3(0.3, 0.3, 0.3);
    this.held = false;
    this.cooldown = 0;
    this.prev = this.pos.clone();
  }

  respawn() {
    this.pos.copy(this.home);
    this.vel.set(0, 0, 0);
    this.held = false;
  }

  update(dt, world, portals, gravityAt, holdTarget) {
    if (this.held && holdTarget) {
      this.vel.copy(holdTarget).sub(this.pos).multiplyScalar(16);
      if (this.vel.length() > 25) this.vel.setLength(25);
    } else {
      this.vel.addScaledVector(gravityAt(this.pos), dt);
      if (this.vel.length() > MAX_FALL) this.vel.setLength(MAX_FALL);
    }
    this.prev.copy(this.pos);
    const c = moveBody(this, this.vel.clone().multiplyScalar(dt), world, portals, false);
    if (c.y && !this.held) {
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
    }
    this.cooldown -= dt;
    let P = this.cooldown <= 0 ? portals.crossing(this.prev, this.pos) : null;
    if (!P && this.cooldown <= 0) P = portals.stuckIn(this.pos, this.pos.clone().sub(this.half), this.pos.clone().add(this.half));
    if (P) {
      const { Q, rot } = portals.carry(P, this.pos, this.vel);
      if (!this.held) portals.exitAssist(Q, this.pos, this.vel, this.half, gravityAt(this.pos), Q.up);
      this.cooldown = 0.15;
      this.mesh.quaternion.premultiply(rot);
    }
    this.mesh.position.copy(this.pos);
  }
}
