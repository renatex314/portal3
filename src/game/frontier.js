// Série Fronteira: o comportamento das mecânicas novas durante o jogo.
//
//  - lasers: o feixe atravessa portais, é desviado por cubos refletores,
//    queima o jogador, derruba torretas e liga receptores;
//  - funis de excursão: feixe largo (também atravessa portais) que carrega
//    o que estiver dentro sem gravidade, nos dois sentidos;
//  - placas de lançamento: arremessam quem pisa nelas;
//  - zonas de gravidade e buracos negros: mudam a gravidade de cada ponto;
//  - viagem no tempo: alterna a sala entre o passado e o futuro;
//  - portal para a Lua: um tiro na Lua abre o portal lá, e o vácuo puxa tudo.
//
// Os construtores (o que aparece no cenário) ficam em world.js.

import * as THREE from 'three';
import { PORTAL_A, PORTAL_B } from './portals.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FUNNEL_R = 1.3;
const _rq = new THREE.Quaternion();
const _ro = new THREE.Vector3();
const _rd = new THREE.Vector3();
/** raio × cubo de meia-aresta `h` em `p` com giro `q`: distância ou null */
function rayBox(o, d, p, q, h) {
  _rq.copy(q).invert();
  _ro.copy(o).sub(p).applyQuaternion(_rq);
  _rd.copy(d).applyQuaternion(_rq);
  let t0 = 0;
  let t1 = Infinity;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(_rd[a]) < 1e-9) {
      if (Math.abs(_ro[a]) > h) return null;
      continue;
    }
    let ta = (-h - _ro[a]) / _rd[a];
    let tb = (h - _ro[a]) / _rd[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t0 <= t1 ? t0 : null;
}

// cilindro de raio 1 indo de y = 0 a y = 1 (é esticado de ponta a ponta de cada trecho)
const UNIT = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);

const beamVS = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec2 vUv;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - w.xyz);
    vAlong = position.y * length(modelMatrix[1].xyz);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const laserGlowFS = /* glsl */ `
  uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vAlong;
  void main(){
    float face = abs(dot(vN, vV));
    float flick = 0.85 + 0.15 * sin(vAlong * 30.0 - uTime * 40.0);
    gl_FragColor = vec4(vec3(2.6, 0.25, 0.12) * flick, pow(face, 3.0) * 0.8);
  }`;

const funnelFS = /* glsl */ `
  uniform float uTime, uSign; uniform vec3 uColor;
  varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec2 vUv;
  void main(){
    float ang = vUv.x * 6.2831853;
    float s1 = pow(0.5 + 0.5 * sin(vAlong * 2.4 - uTime * 5.0 * uSign + ang * 2.0), 6.0);
    float s2 = pow(0.5 + 0.5 * sin(vAlong * 0.9 - uTime * 2.6 * uSign - ang * 3.0), 12.0);
    float rings = pow(0.5 + 0.5 * sin(vAlong * 6.0 - uTime * 9.0 * uSign), 30.0);
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    float a = 0.05 + 0.22 * s1 + 0.2 * s2 + 0.25 * rings + rim * 0.3;
    gl_FragColor = vec4(uColor * (1.0 + s1 + rings), clamp(a, 0.0, 0.9));
  }`;

let SPARK_TEX = null;
function sparkTexture() {
  if (SPARK_TEX) return SPARK_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,240,220,1)');
  gr.addColorStop(0.3, 'rgba(255,90,40,0.7)');
  gr.addColorStop(1, 'rgba(255,40,10,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  SPARK_TEX = new THREE.CanvasTexture(cv);
  return SPARK_TEX;
}

export class Frontier {
  constructor(scene, world, portals, physics) {
    this.scene = scene;
    this.world = world;
    this.portals = portals;
    this.physics = physics;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = { value: 0 };
    this.laserCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.22, 0.12), toneMapped: false });
    this.laserGlow = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time },
      vertexShader: beamVS,
      fragmentShader: laserGlowFS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beams = []; // { core, glow }
    this.sparks = [];
    this.used = 0;
    this.usedSparks = 0;
    this.burnT = 0;
    this.moonDone = false;
    this.funnelMeshes = [];
    // modelos invisíveis só para os shaders serem compilados ao carregar a fase
    const tmpl = this.beamMesh();
    tmpl.core.visible = tmpl.glow.visible = false;
    const f = this.funnelMesh(this.funnelMaterial(new THREE.Color(), 1));
    f.visible = false;
    this.group.add(f);
  }

  reset() {
    for (const b of this.beams) b.core.visible = b.glow.visible = false;
    for (const s of this.sparks) s.visible = false;
    for (const m of this.funnelMeshes) this.group.remove(m);
    this.funnelMeshes = [];
    this.moonDone = false;
    this.inFunnel = false;
  }

  // ------------------------------------------------------------------ feixes
  beamMesh(pool = this.beams) {
    const core = new THREE.Mesh(UNIT, this.laserCore);
    const glow = new THREE.Mesh(UNIT, this.laserGlow);
    core.frustumCulled = glow.frustumCulled = false;
    glow.renderOrder = 8;
    this.group.add(core, glow);
    const b = { core, glow };
    pool.push(b);
    return b;
  }

  /**
   * Laser mandado para o passado: depois de um salto, as versões passadas guardam os
   * instantes em que um feixe entrava num azul temporal; Δ segundos antes deles, o feixe
   * sai de verdade do laranja (liga receptores, queima). O laço tem de fechar: no instante
   * gravado o feixe precisa entrar de novo no azul — senão, paradoxo.
   */
  pastEmissions(ctx) {
    const R = ctx.relogio;
    if (!R?.clones?.length || R.paused || R.sweep) return [];
    const out = [];
    const tol = 1 / 30 * 0.6;
    for (const c of R.clones) {
      for (const e of c.laserEmits ?? []) {
        if (Math.abs(e.t - R.tw) > tol) continue;
        if (out.some((x) => x.o.distanceTo(e.exit) < 0.2 && x.d.dot(e.dir) > 0.98)) continue;
        out.push({ o: e.exit.clone(), d: e.dir.clone(), fromPast: true, frame: e.frame });
      }
    }
    return out;
  }

  /** o feixe que veio do passado acertaria a sua versão passada? (paradoxo) */
  checkPastSelf(ctx, a, b) {
    const R = ctx.relogio;
    if (!R) return;
    for (const c of R.clones) {
      const pose = R.clonePose(c);
      if (!pose || pose.jumped) continue;
      const q = closest(a, b, pose.p);
      if (Math.hypot(q.x - pose.p.x, q.z - pose.p.z) < 0.4 && Math.abs(q.y - pose.p.y) < 0.95) {
        R.rollback(c.cp, 'o laser mandado ao passado acertaria a sua versão passada', q);
        return;
      }
    }
  }

  /** depois dos feixes do quadro: o laço de cada laser mandado ao passado fechou? */
  checkLaserLoops(ctx, dt) {
    const R = ctx.relogio;
    if (!R?.clones?.length || R.paused || R.sweep) return;
    const tol = 1 / 30 * 0.6;
    for (const c of R.clones) {
      let need = null;
      for (const e of c.laserEmits ?? []) if (Math.abs(e.entryT - R.tw) <= tol) need = e;
      if (!need) {
        c.laserMiss = 0;
        continue;
      }
      const ok = (this.liveEntries ?? []).some((x) => x.at.distanceTo(need.at) < 0.5);
      c.laserMiss = ok ? 0 : (c.laserMiss ?? 0) + dt;
      if (c.laserMiss > 0.2) {
        R.rollback(c.cp, 'o laser não voltou a entrar no azul (era ele que saía do laranja)', need.at.clone());
        return;
      }
    }
  }

  /**
   * O laser do passado: com o laranja temporal aberto, o feixe é refeito como era Δ segundos antes
   * (cubos e portas nas posições da foto). O que entra no laranja sai no azul do presente: devolve
   * essas saídas [{ o, d }]. Os trechos do passado ficam guardados para a vista do azul.
   */
  updatePast(ctx) {
    const R = ctx.relogio;
    // o seu laranja temporal e os das suas versões passadas (cada um com o seu Δ)
    const oranges = R && this.world.lasers.length ? this.portals.list.filter((P) => P.placed && P.delta > 0 && this.portals.isLinked(P)) : [];
    if (!oranges.length) {
      this.pastKey = null;
      this.pastN = 0;
      this.pastExtra = [];
      return this.pastExtra;
    }
    const keyParts = oranges.map((O) => [R.samples[R.indexAt(R.tw - O.delta)], O.delta, O.center.x, O.center.y, O.center.z, O.normal.x, O.normal.z]);
    const k = this.pastKey;
    const entering = (this.prevEntries ?? []).length > 0; // laser indo para o passado: refaz sempre
    if (!entering && k && k.length === keyParts.length && k.every((a, i) => a.every((v, j) => v === keyParts[i][j]))) return this.pastExtra;
    this.pastKey = keyParts;
    const segs = [];
    const extra = [];
    for (const O of oranges) {
      const snap = R.samples[R.indexAt(R.tw - O.delta)].w;
      const props = [];
      R.props().forEach((c, i) => {
        const e = snap.props[i];
        if (c.kind === 'cube' && e && !e.gone) props.push({ c, p: e.p, q: e.q });
      });
      // o feixe que entra no azul agora sai deste laranja no passado (para a vista do azul)
      const fromBlue = (this.prevEntries ?? []).filter((e) => e.B.partner === O).map((e) => ({ pos: e.exit, dir: e.dir, mine: true }));
      R.inPast(O.delta, () => {
        for (const L of [...this.world.lasers, ...fromBlue]) {
          let o = L.pos;
          let d = L.dir;
          let ignore = null;
          for (let hop = 0; hop < 6; hop++) {
            const res = this.trace(o, d, { ignore, glass: true, past: props, temporal: O });
            for (const [a, b] of res.segs) segs.push([a, b]);
            if (res.temporal) {
              const pos = res.point.clone();
              const vel = res.temporal.dir.clone();
              this.portals.carry(res.temporal.P, pos, vel);
              vel.normalize();
              extra.push({ o: pos.addScaledVector(vel, 0.03), d: vel });
              break;
            }
            if (!res.point) break;
            if (res.prop?.redirect) {
              const f = new THREE.Vector3(0, 0, 1).applyQuaternion(res.snap.q).normalize();
              o = res.snap.p.clone().addScaledVector(f, 0.36);
              d = f;
              ignore = res.prop;
              continue;
            }
            break;
          }
        }
      });
    }
    this.pastBeams ??= [];
    segs.forEach(([a, b], i) => {
      const beam = this.pastBeams[i] ?? this.beamMesh(this.pastBeams);
      const dir = _v.subVectors(b, a);
      const len = dir.length();
      dir.divideScalar(Math.max(len, 1e-6));
      for (const [m, r] of [
        [beam.core, 0.022],
        [beam.glow, 0.11],
      ]) {
        m.visible = false;
        m.position.copy(a);
        m.quaternion.setFromUnitVectors(UP, dir);
        m.scale.set(r, len, r);
      }
    });
    for (let i = segs.length; i < this.pastBeams.length; i++) this.pastBeams[i].core.visible = this.pastBeams[i].glow.visible = false;
    this.pastN = segs.length;
    this.pastExtra = extra;
    return extra;
  }

  /** vista do azul temporal: os feixes de agora saem e entram os do passado */
  pastView(on) {
    if (on) {
      this._pv = this.beams.map((b) => b.core.visible);
      for (const b of this.beams) b.core.visible = b.glow.visible = false;
      for (let i = 0; i < (this.pastN ?? 0); i++) this.pastBeams[i].core.visible = this.pastBeams[i].glow.visible = true;
    } else if (this._pv) {
      this.beams.forEach((b, i) => (b.core.visible = b.glow.visible = !!this._pv[i]));
      for (const b of this.pastBeams ?? []) b.core.visible = b.glow.visible = false;
      this._pv = null;
    }
  }

  drawBeam(a, b) {
    const beam = this.beams[this.used] ?? this.beamMesh();
    this.used++;
    const d = _v.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    d.divideScalar(len);
    for (const [m, r] of [
      [beam.core, 0.022],
      [beam.glow, 0.11],
    ]) {
      m.visible = true;
      m.position.copy(a);
      m.quaternion.setFromUnitVectors(UP, d);
      m.scale.set(r, len, r);
    }
  }

  spark(p, t) {
    let s = this.sparks[this.usedSparks];
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      this.group.add(s);
      this.sparks.push(s);
    }
    this.usedSparks++;
    s.visible = true;
    s.position.copy(p);
    s.scale.setScalar(0.35 + Math.sin(t * 50 + p.x * 9) * 0.08 + Math.random() * 0.1);
    s.material.rotation = Math.random() * 6.28;
  }

  /**
   * Segue um feixe a partir de `o` na direção `d`: bate no cenário, num
   * objeto ou entra num portal ligado e continua do outro lado. Devolve os
   * trechos [a, b] e o que encerrou o feixe.
   */
  trace(o, d, { props = true, ignore = null, maxSeg = 8, maxDist = 400, glass = false, past = null, temporal = false, extra = null } = {}) {
    const segs = [];
    o = o.clone();
    d = d.clone().normalize();
    // o laser atravessa vidro (`glass`); o funil não
    const filter = glass ? (b) => b.mat !== 'glass' : null;
    for (let i = 0; i < maxSeg; i++) {
      const hit = this.world.raycast(o, d, maxDist, filter);
      let ph = null;
      let snapHit = null;
      if (props && past) {
        // o passado: os cubos nas posições da foto (caixas orientadas)
        for (const e of past) {
          if (e.c === ignore) continue;
          const t = rayBox(o, d, e.p, e.q, 0.3);
          if (t !== null && t < (hit ? hit.dist : maxDist) && (!snapHit || t < snapHit.dist)) snapHit = { dist: t, e };
        }
        if (snapHit) {
          const end = o.clone().addScaledVector(d, snapHit.dist);
          segs.push([o, end, d]);
          return { segs, prop: snapHit.e.c, snap: snapHit.e, point: end };
        }
      } else if (props) ph = this.physics.castRay(o, d, hit ? hit.dist : maxDist, (p) => p === ignore || p.gone, true);
      // cópias do tempo (o eco do objeto que viajou com você, o duplo do mandado ao passado)
      if (props && extra?.length) {
        let best = null;
        const lim = Math.min(hit ? hit.dist : maxDist, ph ? ph.dist : Infinity);
        for (const e of extra) {
          if (e === ignore) continue;
          const t = rayBox(o, d, e.p, e.q, 0.3);
          if (t !== null && t < lim && (!best || t < best.dist)) best = { dist: t, e };
        }
        if (best) {
          const end = o.clone().addScaledVector(d, best.dist);
          segs.push([o, end, d]);
          return { segs, prop: best.e.c, snap: best.e, point: end };
        }
      }
      if (ph && (!hit || ph.dist < hit.dist)) {
        const end = o.clone().addScaledVector(d, ph.dist);
        segs.push([o, end, d]);
        return { segs, prop: ph.prop, point: end };
      }
      if (!hit) {
        segs.push([o, o.clone().addScaledVector(d, maxDist), d]);
        return { segs };
      }
      segs.push([o, hit.point.clone(), d]);
      const P = this.portals.list.find((Q) => {
        if (!this.portals.isLinked(Q) || Q.partner.delta > 0 || Q.box !== hit.box) return false;
        // o laranja do passado só vale para o feixe do passado (veja updatePast); com vários
        // (os seus e os das suas versões passadas), cada um no Δ dele
        if (Q.delta > 0 && !(temporal === true || temporal === Q)) return false;
        const l = Q.local(hit.point);
        return (l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 <= 1 && Math.abs(l.z) < 0.05;
      });
      if (!P) {
        // azul temporal (o par com o laranja no passado): o feixe vai para o passado
        const TB = this.portals.list.find((Q) => {
          if (!this.portals.isLinked(Q) || Q.delta > 0 || !(Q.partner.delta > 0) || Q.box !== hit.box) return false;
          const l = Q.local(hit.point);
          return (l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 <= 1 && Math.abs(l.z) < 0.05;
        });
        if (TB) return { segs, point: hit.point, intoPast: { B: TB, dir: d.clone() } };
        return { segs, point: hit.point, normal: hit.normal, box: hit.box };
      }
      if (P.delta > 0) return { segs, point: hit.point, temporal: { P, dir: d.clone() } };
      const pos = hit.point.clone();
      const vel = d.clone();
      this.portals.carry(P, pos, vel);
      d = vel.normalize();
      o = pos.addScaledVector(d, 0.03);
      ignore = null;
    }
    return { segs };
  }

  // ------------------------------------------------------------------ funis
  funnelMaterial(color, sign) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uSign: { value: sign }, uColor: { value: color } },
      vertexShader: beamVS,
      fragmentShader: funnelFS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }

  funnelMesh(mat) {
    const m = new THREE.Mesh(UNIT, mat);
    m.frustumCulled = false;
    m.renderOrder = 7;
    return m;
  }

  /** velocidade que o funil impõe em `p` (ou null fora de qualquer funil) */
  flowAt(p, out = new THREE.Vector3()) {
    // trecho cujo eixo está mais perto (onde dois trechos se cruzam, vale o mais central)
    let best = null;
    let bestR = FUNNEL_R;
    for (const F of this.world.funnels)
      for (const [a, b, d] of F.segs) {
        const len = _w.subVectors(b, a).length();
        _v.subVectors(p, a);
        const t = _v.dot(d);
        if (t < -0.3 || t > len + 0.3) continue;
        _v.addScaledVector(d, -t); // do eixo até o ponto
        const r = _v.length();
        if (r > bestR) continue;
        bestR = r;
        best = { F, d, radial: _v.clone() };
      }
    if (!best) return null;
    this.axis = best.d; // eixo do trecho (para o controle do jogador dentro do funil)
    return out.copy(best.d).multiplyScalar(best.F.speed * (best.F.reversed ? -1 : 1)).addScaledVector(best.radial, -2.2);
  }

  // ------------------------------------------------------------------ gravidade
  /** gravidade no ponto `p` (parte da gravidade da fase em `g`) */
  gravity(p, g) {
    for (const Z of this.world.gravZones)
      if (p.x > Z.min.x && p.x < Z.max.x && p.y > Z.min.y && p.y < Z.max.y && p.z > Z.min.z && p.z < Z.max.z) {
        g.copy(Z.g);
        break;
      }
    for (const B of this.world.blackHoles) {
      _v.subVectors(B.pos, p);
      const r = _v.length();
      if (r > B.reach || r < 1e-3) continue;
      const fall = 1 - THREE.MathUtils.smoothstep(r, B.reach * 0.6, B.reach);
      const a = Math.min(B.strength / Math.max(r * r, (B.horizon * 2) ** 2), 60) * fall;
      g.addScaledVector(_v, a / r);
    }
    if (this.world.funnels.length && this.flowAt(p, _w)) g.set(0, 0, 0);
    return g;
  }

  // ------------------------------------------------------------------ viagem no tempo
  /** troca de época; devolve false se o jogador ficaria dentro de algo */
  toggleEra(player) {
    const target = this.world.era === 'past' ? 'future' : 'past';
    const mn = player.pos.clone().sub(player.half);
    const mx = player.pos.clone().add(player.half);
    for (const it of this.world.eraItems) {
      const b = it.obj;
      if (it.era !== target || !b.min || !b.solid) continue;
      if (mn.x < b.max.x && mx.x > b.min.x && mn.y < b.max.y && mx.y > b.min.y && mn.z < b.max.z && mx.z > b.min.z) return false;
    }
    this.world.setEra(target);
    return true;
  }

  // ------------------------------------------------------------------ Lua
  /** o tiro (origem, direção) acerta a Lua sem bater em nada antes? */
  hitsMoon(o, d) {
    const m = this.world.moonInfo;
    if (!m) return false;
    _v.subVectors(o, m.pos);
    const b = _v.dot(d);
    const c = _v.lengthSq() - m.r * m.r;
    const disc = b * b - c;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return false;
    return !this.world.raycast(o, d, t);
  }

  /** portal da Lua aberto e ligado: devolve { moon, lab } */
  moonLink() {
    for (const P of this.portals.list) if (P.moon && P.placed && P.partner.placed) return { moon: P, lab: P.partner };
    return null;
  }

  // ------------------------------------------------------------------ quadro
  /**
   * ctx: { player, props, held, sfx, hurt(dps, dt, dir), killTurret(t),
   *        lose(prop), die(why), t }
   */
  update(dt, ctx) {
    const { player, sfx } = ctx;
    this.time.value = ctx.t;
    this.used = 0;
    this.usedSparks = 0;
    const W = this.world;

    // ---- funis: refaz o caminho de cada um (portais mudam)
    for (const F of W.funnels) {
      const res = F.off ? { segs: [] } : this.trace(F.pos, F.dir, { props: false, maxSeg: 6 });
      F.segs = res.segs;
      F.meshes ??= [];
      const color = F.reversed ? new THREE.Color(2.4, 0.9, 0.2) : new THREE.Color(0.3, 1.0, 2.4);
      F.mat ??= this.funnelMaterial(color, 1);
      F.mat.uniforms.uColor.value.copy(color);
      F.mat.uniforms.uSign.value = F.reversed ? -1 : 1;
      F.ringMat.color.copy(color).multiplyScalar(1.2);
      F.segs.forEach(([a, b, d], i) => {
        let m = F.meshes[i];
        if (!m) {
          m = this.funnelMesh(F.mat);
          this.group.add(m);
          F.meshes.push(m);
          this.funnelMeshes.push(m);
        }
        m.visible = true;
        m.position.copy(a);
        m.quaternion.setFromUnitVectors(UP, d);
        m.scale.set(FUNNEL_R, a.distanceTo(b), FUNNEL_R);
      });
      for (let i = F.segs.length; i < F.meshes.length; i++) F.meshes[i].visible = false;
    }
    const flow = W.funnels.length ? this.flowAt(player.pos) : null;
    if (!!flow !== this.inFunnel) sfx.funnelIn();
    this.inFunnel = !!flow;
    let funnelNear = flow ? 1 : 0;
    if (!flow && W.funnels.length) {
      // perto de um funil: zumbido mais baixo
      for (const F of W.funnels)
        for (const [a, b] of F.segs) {
          const c = closest(a, b, player.pos);
          funnelNear = Math.max(funnelNear, 1 - THREE.MathUtils.clamp((c.distanceTo(player.pos) - FUNNEL_R) / 8, 0, 1));
        }
    }
    sfx.funnelHum(funnelNear * 0.8, W.funnels.find((F) => F.reversed) ? -1 : 1);

    // ---- placas de lançamento
    for (const P of W.plates) {
      P.cool -= dt;
      if (P.cool > 0) continue;
      const top = P.pos.y + 0.2;
      const feetY = player.pos.y - player.half.y;
      if (Math.abs(player.pos.x - P.pos.x) < 1.05 && Math.abs(player.pos.z - P.pos.z) < 1.05 && feetY > top - 0.25 && feetY < top + 0.45 && player.vel.y <= 0.5) {
        player.vel.copy(P.vel);
        player.pos.y = Math.max(player.pos.y, top + player.half.y + 0.05);
        player.grounded = false;
        P.kick = 1;
        P.cool = 0.9;
        sfx.plate();
        continue;
      }
      for (const c of ctx.props) {
        if (c.held || c.gone || !c.body) continue;
        if (Math.abs(c.pos.x - P.pos.x) < 1.05 && Math.abs(c.pos.z - P.pos.z) < 1.05 && c.pos.y - top > -0.1 && c.pos.y - top < 0.9) {
          c.body.setLinvel(P.vel, true);
          c.body.setTranslation({ x: c.pos.x, y: Math.max(c.pos.y, top + 0.35), z: c.pos.z }, true);
          P.kick = 1;
          P.cool = 0.9;
          sfx.plate();
          break;
        }
      }
    }

    // ---- lasers
    for (const C of W.laserCatchers) {
      C.wasActive = C.active;
      C.active = false;
    }
    for (const c of ctx.props) if (c.redirect) c.lit = false;
    let burn = 0;
    let nearest = Infinity;
    // os feixes de agora, os que saem do azul vindos do laranja do passado e os que saem
    // do laranja de uma versão passada sua (laser que você mandou para o passado)
    const extra = ctx.relogio?.virtualProps?.() ?? null;
    this.prevEntries = this.liveEntries ?? [];
    this.liveEntries = [];
    const emitted = this.pastEmissions(ctx);
    for (const L of [...W.lasers, ...this.updatePast(ctx), ...emitted]) {
      let o = L.pos ?? L.o;
      let d = L.dir ?? L.d;
      let ignore = null;
      for (let hop = 0; hop < 6; hop++) {
        const res = this.trace(o, d, { ignore, glass: true, extra });
        if (L.fromPast) for (const [a, b] of res.segs) this.checkPastSelf(ctx, a, b);
        if (res.intoPast) {
          // entrou no azul temporal: some aqui e sai do laranja Δ s atrás (gravado no relógio)
          const pos = res.point.clone();
          const vel = res.intoPast.dir.clone();
          this.portals.carry(res.intoPast.B, pos, vel);
          vel.normalize();
          const O = res.intoPast.B.partner;
          this.liveEntries.push({ B: res.intoPast.B, delta: O.delta, at: res.point.clone(), exit: pos.addScaledVector(vel, 0.03), dir: vel, frame: { c: O.center.clone(), n: O.normal.clone(), u: O.up.clone(), box: O.box } });
          for (const [a, b] of res.segs) this.drawBeam(a, b);
          break;
        }
        for (const [a, b] of res.segs) {
          this.drawBeam(a, b);
          // o jogador encostou no feixe?
          const c = closest(a, b, player.pos);
          const dist = c.distanceTo(player.pos);
          nearest = Math.min(nearest, dist);
          const dy = Math.abs(c.y - player.pos.y);
          if (Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 0.42 && dy < player.half.y + 0.05) {
            burn = Math.max(burn, 1);
            const push = player.pos.clone().sub(c).setY(0);
            if (push.lengthSq() < 1e-6) push.set(-d.z, 0, d.x);
            ctx.hurt(70, dt, push.normalize());
          }
        }
        // torretas no caminho do feixe (o corpo é mais alto que o colisor das pernas)
        for (const tu of ctx.props) {
          if (tu.kind !== 'turret' || !tu.active || tu.gone) continue;
          for (const [a, b] of res.segs) {
            const c = closest(a, b, tu.pos);
            if (Math.hypot(c.x - tu.pos.x, c.z - tu.pos.z) < 0.35 && Math.abs(c.y - tu.pos.y) < 0.7) ctx.killTurret(tu);
          }
        }
        if (!res.point) break;
        this.spark(res.point, ctx.t);
        // receptor
        for (const C of W.laserCatchers) if (C.pos.distanceTo(res.point) < 0.75) C.active = true;
        const p = res.prop;
        if (p?.redirect) {
          // cubo refletor: sai pela lente da frente
          if (res.snap) {
            // cópia do tempo (eco/duplo): a pose dela, não a do cubo de verdade
            const f = new THREE.Vector3(0, 0, 1).applyQuaternion(res.snap.q).normalize();
            o = res.snap.p.clone().addScaledVector(f, 0.36);
            d = f;
            ignore = res.snap;
            continue;
          }
          p.lit = true;
          // segurado: vale a mira de quem segura (o cubo encostado em algo gira com atraso)
          const f = new THREE.Vector3(0, 0, 1).applyQuaternion(p.held && p.holdQuat ? p.holdQuat : p.quat).normalize();
          o = p.pos.clone().addScaledVector(f, 0.36);
          d = f;
          ignore = p;
          continue;
        }
        if (p?.kind === 'turret' && p.active) ctx.killTurret(p);
        break;
      }
    }
    this.checkLaserLoops(ctx, dt);
    // laranja temporal de fundo preto: só onde sai de fato um laser (vindo do futuro)
    this.portals.setStatics?.(emitted.map((e) => e.frame).filter(Boolean));
    for (const C of W.laserCatchers) {
      if (C.active && !C.wasActive) sfx.laserOn();
      const k = C.active ? 2.4 : 0.6 + Math.sin(ctx.t * 3) * 0.15;
      C.group.userData.glow.color.setRGB(2.4 * k, 0.4 * k, 0.25 * k);
      C.group.userData.spin.rotation.y += dt * (C.active ? 7 : 0.6);
    }
    for (const c of ctx.props) if (c.redirect) c.mesh.userData.lens?.color.setRGB(c.lit ? 4 : 0.6, c.lit ? 0.6 : 0.08, c.lit ? 0.4 : 0.05);
    for (const L of W.lasers) L.lensMat.color.setRGB(3 + Math.sin(ctx.t * 20) * 0.4, 0.3, 0.2);
    for (let i = this.used; i < this.beams.length; i++) this.beams[i].core.visible = this.beams[i].glow.visible = false;
    for (let i = this.usedSparks; i < this.sparks.length; i++) this.sparks[i].visible = false;
    sfx.laserHum(W.lasers.length ? 1 - THREE.MathUtils.clamp((nearest - 0.5) / 6, 0, 1) : 0);
    this.burnT -= dt;
    if (burn && this.burnT <= 0) {
      sfx.sizzle();
      this.burnT = 0.15;
    }

    // ---- buracos negros: o horizonte engole tudo
    let bhLoud = 0;
    for (const B of W.blackHoles) {
      const r = B.pos.distanceTo(player.pos);
      bhLoud = Math.max(bhLoud, 1 - THREE.MathUtils.clamp((r - B.horizon) / B.reach, 0, 1));
      if (r < B.horizon * 1.25) ctx.die('engolido pelo buraco negro');
      for (const c of ctx.props) if (!c.gone && c.pos.distanceTo(B.pos) < B.horizon * 1.3) ctx.lose(c);
    }
    sfx.blackHole(bhLoud * bhLoud);

    // ---- vácuo do portal para a Lua
    const link = this.moonLink();
    let gale = 0;
    if (link) {
      const Q = link.lab;
      const pull = (pos) => {
        _v.subVectors(Q.center, pos);
        const r = _v.length();
        if (r > 18 || _v.dot(Q.normal) > 0.5) return null;
        return { dir: _v.clone().divideScalar(r), a: Math.min(40, 6 + 1500 / Math.max(r * r, 2)), r };
      };
      const pp = pull(player.pos);
      if (pp) {
        // o vácuo arranca do chão (senão o atrito dos pés segura) e puxa para a boca
        if (player.grounded) player.vel.y = Math.max(player.vel.y, 1.6);
        player.vel.addScaledVector(pp.dir, pp.a * dt);
        gale = Math.max(gale, 1 - pp.r / 18);
      }
      for (const c of ctx.props) {
        if (c.held || c.gone || !c.body) continue;
        const pc = pull(c.pos);
        if (!pc) continue;
        const v = c.body.linvel();
        c.body.setLinvel({ x: v.x + pc.dir.x * pc.a * dt, y: v.y + pc.dir.y * pc.a * dt, z: v.z + pc.dir.z * pc.a * dt }, true);
      }
    }
    sfx.gale(gale);
  }
}

/** ponto do segmento a–b mais perto de p */
function closest(a, b, p) {
  const ab = _w.subVectors(b, a);
  const l2 = ab.lengthSq();
  const t = l2 > 0 ? THREE.MathUtils.clamp(_v.subVectors(p, a).dot(ab) / l2, 0, 1) : 0;
  return a.clone().addScaledVector(ab, t);
}
