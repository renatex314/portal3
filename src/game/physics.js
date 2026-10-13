// Física de corpos rígidos (Rapier): cubos e torretas tombam, giram, empilham
// e são empurrados; o jogador é um "character controller" que colide com
// tudo isso. A regra dos portais vira um filtro de contato: enquanto o centro
// de um corpo está na boca de um portal ligado, o que estiver ATRÁS do plano
// do portal (a parede dele e o que houver atrás) deixa de colidir com ele.
//
// A gravidade não é a do motor: cada corpo recebe a gravidade do ponto em que
// está (a fase final tem gravidade que muda com a posição).

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

let READY = false;
/** carrega o motor (WebAssembly); chamar uma vez antes da primeira fase */
export async function initPhysics() {
  if (READY) return;
  await RAPIER.init();
  READY = true;
}

const STEP = 1 / 60;
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

export class Physics {
  constructor(portals) {
    this.portals = portals;
    this.world = null;
    this.ents = new Map(); // handle do colisor → { kind: 'static' | 'dyn' | 'player', box?, prop? }
    this.props = [];
    this.playerCol = null;
    this.hooks = {
      filterContactPair: (h1, h2) => (this._blocked(h1, h2) ? null : RAPIER.SolverFlags.COMPUTE_IMPULSE),
      filterIntersectionPair: () => true,
    };
  }

  get ready() {
    return READY && !!this.world;
  }

  reset() {
    if (!READY) return;
    this.world?.free();
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = STEP;
    // o Rapier só consulta os "hooks" (filtro dos portais) quando recebe uma fila de eventos
    this.events ??= new RAPIER.EventQueue(true);
    this.ents.clear();
    this.props = [];
    const cc = this.world.createCharacterController(0.02);
    cc.setApplyImpulsesToDynamicBodies(true);
    cc.setCharacterMass(75);
    cc.setSlideEnabled(true);
    cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    cc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.cc = cc;
    this.playerCol = null;
  }

  // ------------------------------------------------------------------ cenário
  /** caixa do cenário. `kinematic`: porta/plataforma que se move (empurra o que estiver em cima) */
  addBox(box, kinematic = false) {
    if (!this.world) return;
    const c = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
    const h = new THREE.Vector3().subVectors(box.max, box.min).multiplyScalar(0.5);
    const desc = RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setFriction(0.8);
    let col;
    if (kinematic) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z));
      col = this.world.createCollider(desc, body);
      box.kbody = body;
    } else col = this.world.createCollider(desc.setTranslation(c.x, c.y, c.z));
    box.collider = col;
    this.ents.set(col.handle, { kind: 'static', box });
  }

  /** acompanha uma caixa que mudou de lugar (porta) */
  moveBox(box) {
    if (!box.kbody) return;
    _p.addVectors(box.min, box.max).multiplyScalar(0.5);
    box.kbody.setNextKinematicTranslation(_p);
  }

  // ------------------------------------------------------------------ objetos
  /**
   * Corpo dinâmico. `shapes`: [{ half: [x, y, z], at: [x, y, z] }] relativos ao
   * centro do objeto; `mass` total em kg.
   */
  addProp(prop, { shapes, mass, friction = 0.7, restitution = 0.05, pos, quat }) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setCcdEnabled(true)
      .setLinearDamping(0.05)
      .setAngularDamping(0.4);
    if (quat) desc.setRotation(quat);
    const body = this.world.createRigidBody(desc);
    prop.body = body;
    prop.colliders = shapes.map(({ half, at = [0, 0, 0] }) => {
      const cd = RAPIER.ColliderDesc.cuboid(...half)
        .setTranslation(...at)
        .setMass(mass / shapes.length)
        .setFriction(friction)
        .setRestitution(restitution)
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const col = this.world.createCollider(cd, body);
      this.ents.set(col.handle, { kind: 'dyn', prop });
      return col;
    });
    // raio que cobre o objeto em qualquer orientação (para o teste dos portais)
    prop.radius = Math.max(...shapes.map(({ half, at = [0, 0, 0] }) => Math.hypot(...half) + Math.hypot(...at)));
    prop.mouths = [];
    prop.prevCenter = new THREE.Vector3().copy(pos);
    this.props.push(prop);
    return body;
  }

  removeProp(prop) {
    if (!prop.body || !this.world) return;
    for (const c of prop.colliders) this.ents.delete(c.handle);
    this.world.removeRigidBody(prop.body);
    prop.body = null;
    this.props = this.props.filter((p) => p !== prop);
  }

  /** acorda tudo (ex.: um portal abriu embaixo de um cubo parado) */
  wakeAll() {
    for (const p of this.props) p.body?.wakeUp();
  }

  // ------------------------------------------------------------------ jogador
  setPlayer(half) {
    if (!this.world) return;
    const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0));
    this.ents.set(col.handle, { kind: 'player' });
    this.playerCol = col;
  }

  /**
   * Move o jogador o quanto der na direção `delta`, colidindo com o cenário e
   * com os objetos (e empurrando-os). Devolve as normais das superfícies tocadas.
   */
  movePlayer(player, delta, up) {
    const col = this.playerCol;
    if (!col) {
      player.pos.add(delta);
      return { grounded: false, normals: [] };
    }
    col.setTranslation(player.pos);
    // o controlador varre o movimento inteiro do quadro: o teste dos portais também
    const reach = delta.length();
    const mouths = this.portals.mouths(player.pos, true, reach);
    _p.copy(player.pos).add(delta);
    _min.copy(player.pos).min(_p).sub(player.half).subScalar(0.05);
    _max.copy(player.pos).max(_p).add(player.half).addScalar(0.05);
    this.cc.setUp(up);
    this.cc.computeColliderMovement(col, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (c) => {
      const e = this.ents.get(c.handle);
      if (!e) return true;
      if (e.kind === 'static') return !(mouths.length && this.portals.passes(e.box, mouths, _min, _max));
      if (e.kind === 'dyn') return !e.prop.held && !e.prop.gone;
      return false;
    });
    const m = this.cc.computedMovement();
    player.pos.x += m.x;
    player.pos.y += m.y;
    player.pos.z += m.z;
    col.setTranslation(player.pos);
    const normals = [];
    let ground = null;
    for (let i = 0; i < this.cc.numComputedCollisions(); i++) {
      const hit = this.cc.computedCollision(i);
      if (!hit) continue;
      const n = new THREE.Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z);
      normals.push(n);
      // apoiado em quê? (para andar junto com plataformas e portas)
      if (n.dot(up) > 0.7 && hit.collider) ground = this.ents.get(hit.collider.handle)?.box ?? ground;
    }
    return { grounded: this.cc.computedGrounded(), normals, ground };
  }

  // ------------------------------------------------------------------ passo
  _blocked(h1, h2) {
    const a = this.ents.get(h1);
    const b = this.ents.get(h2);
    if (!a || !b) return false;
    return (a.kind === 'dyn' && this._skip(a.prop, b)) || (b.kind === 'dyn' && this._skip(b.prop, a));
  }

  _skip(prop, other) {
    if (prop.gone) return true;
    if (other.kind === 'player') return prop.held;
    if (other.kind === 'static') return prop.mouths.length > 0 && this.portals.passes(other.box, prop.mouths, prop.min, prop.max);
    if (other.kind === 'dyn') return other.prop.gone;
    return false;
  }

  /**
   * Avança a simulação `dt` segundos (em passos de até 1/60 s). Antes de cada
   * passo, `pre(prop, h)` aplica gravidade/controle; depois, `post(prop)` trata
   * a passagem pelos portais.
   */
  step(dt, pre, post) {
    if (!this.world || dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    const h = dt / n;
    this.world.timestep = h;
    for (let i = 0; i < n; i++) {
      for (const p of this.props) {
        if (!p.body || p.gone) continue;
        const t = p.body.translation();
        p.prevCenter.set(t.x, t.y, t.z);
        // caixa que cobre o objeto agora e onde ele estará no fim do passo
        const lv = p.body.linvel();
        _v.set(lv.x, lv.y, lv.z).multiplyScalar(h);
        _p.copy(p.prevCenter).add(_v);
        p.min = (p.min ?? new THREE.Vector3()).copy(p.prevCenter).min(_p).subScalar(p.radius);
        p.max = (p.max ?? new THREE.Vector3()).copy(p.prevCenter).max(_p).addScalar(p.radius);
        p.mouths = this.portals.mouths(p.prevCenter, false, _v.length());
        // corpo "dormindo" não reavalia contatos: na boca de um portal, acorda
        if (p.mouths.length && p.body.isSleeping()) p.body.wakeUp();
        pre(p, h);
      }
      this.world.step(this.events, this.hooks);
      for (const p of this.props) if (p.body && !p.gone) post(p);
    }
  }

  /** leva um objeto pelo portal P conservando posição, giro e velocidades */
  carry(prop, P) {
    const b = prop.body;
    const t = b.translation();
    const v = b.linvel();
    _p.set(t.x, t.y, t.z);
    _v.set(v.x, v.y, v.z);
    const { Q, rot } = this.portals.carry(P, _p, _v);
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w).premultiply(rot);
    const w = b.angvel();
    _w.set(w.x, w.y, w.z).applyQuaternion(rot);
    b.setTranslation(_p, true);
    b.setRotation(_q, true);
    b.setLinvel(_v, true);
    b.setAngvel(_w, true);
    return { Q, rot };
  }

  /** primeiro objeto (ou cenário) que o raio acerta; `skip(prop)` ignora objetos */
  castRay(origin, dir, maxDist, skip) {
    if (!this.world) return null;
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => {
      const e = this.ents.get(c.handle);
      if (!e || e.kind === 'player') return false;
      if (e.kind === 'dyn') return !e.prop.gone && !skip?.(e.prop);
      return true;
    });
    if (!hit) return null;
    const e = this.ents.get(hit.collider.handle);
    return { dist: hit.timeOfImpact, prop: e?.kind === 'dyn' ? e.prop : null };
  }
}
