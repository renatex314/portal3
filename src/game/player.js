// Jogador em primeira pessoa: anda com o "character controller" do motor de
// física (colide com o cenário e com cubos/torretas, empurrando-os), gravidade
// que pode mudar de direção (fase final!) e passagem pelos portais conservando
// o momento ("o que entra rápido, sai rápido").

import * as THREE from 'three';

const EYE = 0.7; // altura do olho acima do centro do corpo
const STAND = 0.9; // meia altura de pé (1,8 m)
const CROUCH = 0.45; // meia altura agachado (0,9 m, como no Source)
const EYE_CROUCH = 0.25; // olho agachado: 0,7 m acima dos pés
const WALK = 4.6;
const JUMP = 4.6;
const MAX_FALL = 32;
const ROLL_MAX = (1.6 * Math.PI) / 180; // inclinação lateral andando de lado na velocidade normal

const _ID = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _rollQ = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

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
    this.roll = 0; // inclinação lateral da câmera ao andar de lado (rad)
    this.crouched = false;
    this.eyeOff = EYE; // altura do olho acima do centro (anda suave ao agachar)
    // depois de um portal, a câmera começa exatamente onde a vista do portal
    // estava e volta suavemente para a postura de pé (posição e giro)
    this.viewOffset = new THREE.Vector3();
    this.viewRot = new THREE.Quaternion();
  }

  spawn(x, y, z, yaw = 0) {
    if (this.crouched) this.setCrouch(false, this.physics, true);
    this.eyeOff = EYE;
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
    return target.copy(this.pos).add(new THREE.Vector3(0, this.eyeOff * this.upSign, 0));
  }

  /**
   * agacha / levanta. No chão os pés ficam onde estão; no ar a cabeça fica (as pernas
   * sobem, como no Source). Só levanta se couber. `force`: sem testar (renascer).
   */
  setCrouch(on, physics, force = false) {
    if (physics) this.physics = physics;
    if (on === this.crouched) return true;
    const d = (STAND - CROUCH) * this.upSign;
    const shift = this.grounded ? (on ? -d : d) : on ? d : -d;
    const center = this.pos.clone().add(new THREE.Vector3(0, shift, 0));
    const half = new THREE.Vector3(this.half.x, on ? CROUCH : STAND, this.half.z);
    if (!on && !force && physics && !physics.fits(center, half)) return false;
    this.crouched = on;
    this.half.y = half.y;
    // o olho continua no mesmo lugar neste quadro e desliza até a altura nova
    this.eyeOff -= shift;
    this.pos.copy(center);
    physics?.setPlayer(this.half);
    return true;
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

    // agachar (CTRL/C): segurando, fica agachado; ao soltar, levanta quando couber
    if (!!input.crouch !== this.crouched) this.setCrouch(!!input.crouch, world.physics);
    this.eyeOff += ((this.crouched ? EYE_CROUCH : EYE) - this.eyeOff) * (1 - Math.exp(-dt * 12));

    const horiz = this.vel.clone().projectOnPlane(up);
    const vert = this.vel.clone().sub(horiz);
    if (this.grounded) {
      // no chão: responde rápido, mas não "mata" velocidade de lançamento de uma vez
      const target = wish.clone().multiplyScalar(this.crouched ? WALK * 0.5 : WALK);
      // empurrão do mapa (trigger_push): soma à caminhada, como a "velocidade de base" do Source
      if (this.push) target.add(this.push.clone().projectOnPlane(up));
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
    if (this.push) {
      // no ar (ou na vertical): leva a velocidade na direção do empurrão até a dele
      const dir = this.push.clone().normalize();
      const along = this.vel.dot(dir);
      const want = this.push.length();
      if (along < want) this.vel.addScaledVector(dir, Math.min(want - along, want * dt * (this.grounded ? 0 : 6) + (this.push.dot(up) > 0 ? want : 0)));
      this.push = null;
    }
    if (this.vel.length() > MAX_FALL) this.vel.setLength(MAX_FALL);
    this.funnel(dt, portals, g);
    this.flingAssist(dt, portals, g);

    const prevCenter = this.pos.clone();
    const gUp = g.lengthSq() > 0.01 ? g.clone().normalize().negate() : up;
    // em cima de uma plataforma/porta que andou: vai junto com ela (em qualquer
    // direção, até diagonal e rápida) — o colisor dela ainda está no lugar
    // antigo, então ele fica de fora e o jogador é assentado no topo novo
    const plat = this.upSign > 0 ? world.doors.find((d) => d.box === this.ground) : null;
    let onPlat = null;
    // (mesmo parada: o controlador do Rapier trava andando em cima de corpo cinemático)
    if (plat && this.vel.dot(gUp) <= 0.05) {
      this.pos.add(plat.delta);
      onPlat = plat;
    }
    const res = world.physics.movePlayer(this, this.vel.clone().multiplyScalar(dt), gUp, onPlat?.box);
    this.ground = res.ground;
    if (onPlat) {
      const b = onPlat.box;
      const over = this.pos.x > b.min.x - this.half.x + 0.05 && this.pos.x < b.max.x + this.half.x - 0.05 && this.pos.z > b.min.z - this.half.z + 0.05 && this.pos.z < b.max.z + this.half.z - 0.05;
      if (over && this.pos.y - this.half.y > b.max.y - 0.4) {
        this.pos.y = b.max.y + this.half.y + 0.035; // folga maior que a margem do controlador (0,02)
        if (this.vel.y < 0) this.vel.y = 0;
        res.normals.push(gUp.clone());
        this.ground = b;
      }
    }
    // saiu de cima de uma plataforma em movimento: leva a velocidade dela
    if (plat && this.ground !== plat.box && dt > 0) this.vel.addScaledVector(plat.delta, 1 / dt);
    // o que bateu tira a parte da velocidade que ia contra a superfície
    let ground = false;
    for (const n of res.normals) {
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
      if (n.dot(gUp) > 0.7) ground = true;
    }
    this.grounded = g.lengthSq() > 0.01 && (ground || (res.grounded && this.vel.dot(gUp) <= 0.05));
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
      P = portals.crossing(prevCenter, this.pos, true);
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

  /**
   * "Funil": caindo por cima de um portal no chão, a trajetória é puxada de
   * leve para o centro dele (como nos jogos do gênero) — dá para acertar o
   * portal mesmo saindo da beirada andando.
   */
  funnel(dt, portals, g) {
    const gm = g.length();
    if (gm < 0.01) return;
    const down = g.clone().divideScalar(gm);
    const vDown = this.vel.dot(down);
    if (vDown < 1) return;
    // só para quem está caindo quase reto (voando de lado por cima de um portal não conta)
    const sideNow = this.vel.clone().addScaledVector(down, -vDown);
    if (sideNow.length() > 6) return;
    let best = null;
    let bestD = Infinity;
    for (const P of portals.list) {
      if (!portals.isLinked(P) || P.delta > 0 || P.partner.delta > 0 || P.normal.dot(down) > -0.7) continue;
      const rel = this.pos.clone().sub(P.center);
      const h = rel.dot(P.normal);
      if (h < 0.3 || h > 60) continue;
      const lat = rel.addScaledVector(P.normal, -h);
      const d = lat.length();
      // quanto mais alto, mais longe o funil alcança (há tempo para corrigir)
      const reach = Math.min(6, Math.max(2.6, 1.5 + h * 0.1));
      if (d < reach && d < bestD) {
        bestD = d;
        best = { lat, h };
      }
    }
    if (!best) return;
    // velocidade lateral que leva ao centro no tempo que falta para chegar (queda acelerada)
    const t = Math.max((-vDown + Math.sqrt(vDown * vDown + 2 * gm * best.h)) / gm, 0.05);
    const want = best.lat.multiplyScalar(-1 / t);
    // correção suave, com aceleração lateral limitada
    const dv = want.sub(sideNow).multiplyScalar(1 - Math.exp(-dt * 6));
    const maxDv = 12 * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.vel.add(dv);
  }

  /**
   * Ajuda de arremesso: voando rápido de encontro a um portal (painel
   * diagonal, parede…), se a trajetória vai cruzar o plano dele perto da boca,
   * corrige de leve a velocidade lateral para entrar no centro — como nos
   * jogos do gênero. Não muda a velocidade na direção do portal.
   */
  flingAssist(dt, portals, g) {
    const speed = this.vel.length();
    if (speed < 8) return;
    let best = null;
    for (const P of portals.list) {
      if (!portals.isLinked(P) || P.delta > 0 || P.partner.delta > 0) continue;
      const vn = -this.vel.dot(P.normal); // velocidade de encontro à face
      if (vn < speed * 0.35) continue;
      const h = _a.subVectors(this.pos, P.center).dot(P.normal);
      if (h < 0.2 || h > 30) continue;
      // tempo até o plano, com a gravidade: h − vn·t + ½(g·n)t² = 0
      const gn = g.dot(P.normal);
      let t = h / vn;
      if (Math.abs(gn) > 1e-3) {
        const disc = vn * vn - 2 * gn * h;
        if (disc < 0) continue;
        t = (vn - Math.sqrt(disc)) / gn;
        if (!(t > 0)) t = h / vn;
      }
      if (t > 3) continue;
      const hit = _b.copy(this.pos).addScaledVector(this.vel, t).addScaledVector(g, 0.5 * t * t).sub(P.center);
      const off = hit.addScaledVector(P.normal, -hit.dot(P.normal));
      const d = off.length();
      // alcance: o tamanho de um painel pega-voo (o portal fica em algum lugar dele)
      if (d < 4.5 && (!best || t < best.t)) best = { t, off: off.clone() };
    }
    if (!best) return;
    const want = best.off.multiplyScalar(-1 / Math.max(best.t, 0.08));
    const dv = want.multiplyScalar(1 - Math.exp(-dt * 8));
    const maxDv = 14 * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.vel.add(dv);
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
    // andando de lado a câmera inclina levemente para o lado do movimento (como no Half-Life/Black Mesa)
    const right = _right.set(1, 0, 0).applyQuaternion(quat);
    const side = THREE.MathUtils.clamp(this.vel.dot(right) / WALK, -1.5, 1.5);
    if (dt > 0) this.roll += (-side * ROLL_MAX - this.roll) * (1 - Math.exp(-dt * 9));
    if (Math.abs(this.roll) > 1e-5) quat.multiply(_rollQ.setFromAxisAngle(_zAxis, this.roll));
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
