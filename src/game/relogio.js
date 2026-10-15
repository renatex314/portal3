// Relógio do tempo (série Experimento) — inspirado no jogo Flash "Time Experiment"
// (RodKis) e no mod "Thinking with Time Machine".
//
//  • Tecla 2: PAUSA o tempo do mundo (portas, plataformas, bolas de energia, cubos,
//    torretas…). Você anda, pega e atira à vontade.
//  • Na pausa aparece o holograma do passado: a roda do mouse escolhe Δ (quantos
//    segundos voltar) e o tiro LARANJA cai nas paredes daquele instante. O azul
//    cai no presente. Fora da pausa, o laranja é um portal normal (Δ = 0).
//  • Entrar no azul leva você ao laranja Δ segundos antes (LOOP FECHADO: uma só
//    linha do tempo). O mundo volta ao instante de destino e o seu eu que saltou
//    vira um CLONE que repete o que você fez — pisa em botões — até o momento do
//    salto, quando mergulha no azul "eco" e some.
//  • PARADOXO: se o clone não puder repetir o passado (bola de energia no caminho
//    dele, porta/cubo na rota, chão que sumiu, destino ocupado…) o loop colapsa e
//    você volta ao instante do salto, com os portais como estavam.

import * as THREE from 'three';
import { PORTAL_A, PORTAL_B } from './portals.js';

const RATE = 1 / 30; // intervalo entre os quadros guardados (tempo do mundo)
const KEEP = 120; // segundos de história
const MAX_DELTA = 30;
const STEP = 0.5; // passo da roda do mouse (s)
const ECHO = 0.8; // o azul "eco" abre para o mergulho do clone nesse tempo final

const V3 = THREE.Vector3;
const _path = new V3();

/** deslocamento de uma porta/plataforma com `open` (0..1) */
function doorOffset(d, open, out) {
  if (d.path) out.copy(d.path);
  else out.set(0, 0, 0).setComponent('xyz'.indexOf(d.axis), d.dist);
  return out.multiplyScalar(open);
}

const overlap = (aMin, aMax, bMin, bMax, eps = 0) =>
  aMin.x < bMax.x - eps && aMax.x > bMin.x + eps && aMin.y < bMax.y - eps && aMax.y > bMin.y + eps && aMin.z < bMax.z - eps && aMax.z > bMin.z + eps;

export class Chronos {
  /**
   * ctx: { world, energy, player, portals, scene, cubes(), turrets(), held(), makeGhost(),
   *        t(), dtReal(), fx: { pause, jump, paradox, scrub, echo, toast } }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.holoMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.25, 0.85, 1.0) }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha; uniform vec3 uColor;
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main(){
          float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 1.7);
          float sc = 0.62 + 0.38 * sin(vW.y * 16.0 - uTime * 3.5) * sin(vW.x * 3.0 + vW.z * 3.0 + uTime);
          vec3 col = uColor * (0.45 + 1.6 * f) * sc;
          gl_FragColor = vec4(col * 1.4, (0.20 + 0.55 * f) * uAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.holo = null;
    this.eco = null;
    this.vt = 0; // tempo "visual" do mundo (só anda quando o mundo anda)
    this.paradoxes = 0;
    this.delta = 5;
    this.clear();
  }

  // ------------------------------------------------------------------ estado
  clear() {
    if (this.frozenProps) this.setFreeze(false);
    for (const c of this.clones ?? []) this.dropClone(c);
    this.paused = false;
    this.tw = 0;
    this.samples = [];
    this.clones = [];
    this.cloneSeq ??= 0;
    this.arrival = -Infinity; // instante de chegada do último salto (não dá para saltar para antes dele)
    this.sweep = null;
    this.frozenProps = false;
    this.next = 0;
    this.pre = null;
    this.blocked = false;
    this.record(0);
    this.next = RATE;
    this.setHolo(false);
    this.updateEco();
  }

  props() {
    return [...this.ctx.cubes(), ...(this.ctx.turrets?.() ?? [])];
  }

  /** foto do mundo agora */
  snapshot() {
    const { world, energy } = this.ctx;
    return {
      doors: world.doors.map((d) => [d.open, d.target, d.wait ?? 0]),
      buttons: world.buttons.map((b) => [b.pressed, b.count ?? 0]),
      catchers: world.catchers.map((c) => c.active),
      incin: world.incinerators.map((i) => i.active),
      launchers: world.launchers.map((L) => [L.wait, L.done]),
      pellets: energy.pellets.map((p) => ({ li: world.launchers.indexOf(p.from), pos: p.pos.clone(), vel: p.vel.clone(), life: p.life, cd: p.cooldown })),
      props: this.props().map((c) => {
        const v = c.body?.linvel?.();
        const a = c.body?.angvel?.();
        return { p: c.pos.clone(), q: c.quat.clone(), v: v ? [v.x, v.y, v.z] : null, a: a ? [a.x, a.y, a.z] : null, gone: !!c.gone };
      }),
    };
  }

  /** os seus portais normais agora (o par temporal não entra: ele é o salto); reaproveita o objeto se nada mudou */
  portalState() {
    const { portals } = this.ctx;
    const { blue, orange } = portals;
    const temporal = orange.placed && orange.delta > 0;
    const fr = (P, on, old) => {
      if (!on || !P.placed) return null;
      if (old && old.box === P.box && old.c.equals(P.center) && old.n.equals(P.normal)) return old;
      return { c: P.center.clone(), n: P.normal.clone(), u: P.up.clone(), box: P.box };
    };
    const old = this.samples[this.samples.length - 1]?.pt;
    const b = fr(blue, !temporal, old?.b);
    const o = fr(orange, !temporal, old?.o);
    return old && old.b === b && old.o === o ? old : { b, o };
  }

  /** os portais que o clone disparou, no instante t do script dele */
  syncClonePortals(c, t, alive) {
    const { portals } = this.ctx;
    const s = c.script[Math.max(0, Math.min(c.script.length - 1, Math.floor((t - c.script[0].t) / RATE + 1e-6)))];
    const want = alive ? s.pt : null;
    for (const which of ['b', 'o']) {
      const f = want?.[which] ?? null;
      if (!f && !c.pair) continue;
      c.pair ??= portals.clonePair(c.id);
      const P = which === 'b' ? c.pair.blue : c.pair.orange;
      if (!f) {
        if (P.placed) P.remove();
      } else if (!P.placed || c.shown?.[which] !== f) {
        P.setFrame(f.c, f.n, f.u, f.box);
        (c.shown ??= {})[which] = f;
      }
    }
  }

  record(t) {
    const { player } = this.ctx;
    this.samples.push({
      t,
      p: player.pos.clone(),
      up: player.upSign,
      yaw: player.yaw,
      pitch: player.pitch,
      grounded: !!player.grounded,
      mv: !!player.grounded && player.vel.clone().setY(0).lengthSq() > 0.4,
      pt: this.portalState(),
      w: this.snapshot(),
    });
    while (this.samples.length > 2 && t - this.samples[0].t > KEEP) this.samples.shift();
  }

  indexAt(t) {
    const s = this.samples;
    const i = Math.floor((t - s[0].t) / RATE + 1e-6);
    return Math.max(0, Math.min(s.length - 1, i));
  }

  /** limite do Δ: história guardada, 30 s e a chegada do salto anterior */
  maxDelta() {
    const hist = this.tw - this.samples[0].t;
    const sinceArrival = this.tw - this.arrival;
    return Math.max(0, Math.min(MAX_DELTA, hist, sinceArrival));
  }

  /** põe o mundo exatamente como estava na foto (o jogador não é mexido) */
  restore(snap) {
    const { world, energy, player } = this.ctx;
    const moved = [];
    world.doors.forEach((d, k) => {
      const s = snap.doors[k];
      if (!s) return;
      if (Math.abs(d.open - s[0]) > 1e-5) moved.push(d);
      d.open = s[0];
      d.target = s[1];
      if (d.wait !== undefined) d.wait = s[2];
    });
    world.buttons.forEach((b, k) => {
      b.pressed = !!snap.buttons[k]?.[0];
      b.count = snap.buttons[k]?.[1] ?? 0;
    });
    world.catchers.forEach((c, k) => (c.active = !!snap.catchers[k]));
    world.incinerators.forEach((f, k) => (f.active = !!snap.incin[k]));
    // bolas de energia: reaproveita as que existem, cria as que faltam, tira as que sobram
    const want = new Map(snap.pellets.map((p) => [p.li, p]));
    for (const p of [...energy.pellets]) {
      const w = want.get(world.launchers.indexOf(p.from));
      if (!w) {
        energy.kill(p);
        continue;
      }
      this.setPellet(p, w);
      want.delete(world.launchers.indexOf(p.from));
    }
    for (const [li, w] of want) {
      const L = world.launchers[li];
      if (!L || L.pellet) continue;
      this.setPellet(energy.spawn(L), w);
    }
    world.launchers.forEach((L, k) => {
      if (!snap.launchers[k]) return;
      L.wait = snap.launchers[k][0];
      L.done = snap.launchers[k][1];
    });
    this.props().forEach((c, k) => {
      const s = snap.props[k];
      if (!s) return;
      if (s.gone) {
        if (!c.gone) c.vanish();
        return;
      }
      if (c.gone) {
        c.gone = false;
        c.body?.setEnabled(true);
        c.mesh.visible = true;
      }
      c.place(s.p, s.q, s.v ? { x: s.v[0], y: s.v[1], z: s.v[2] } : null);
      if (s.a) c.body?.setAngvel({ x: s.a[0], y: s.a[1], z: s.a[2] }, true);
    });
    // portas e plataformas andam para onde estavam (e não esmagam quem está no caminho)
    world.update(this.ctx.t(), 0);
    for (const d of moved) this.pushOut(player, d.box);
  }

  setPellet(p, w) {
    p.pos.copy(w.pos);
    p.vel.copy(w.vel);
    p.life = w.life;
    p.cooldown = w.cd;
    p.group.position.copy(p.pos);
    p.light?.position.copy(p.pos);
    for (const h of p.hist) h.copy(p.pos);
  }

  pushOut(player, b) {
    const pen = ['x', 'y', 'z'].map((a) => Math.min(player.pos[a] + player.half[a] - b.min[a], b.max[a] - (player.pos[a] - player.half[a])));
    if (pen.some((v) => v <= 0.02)) return;
    const i = pen.indexOf(Math.min(...pen));
    const a = 'xyz'[i];
    player.pos[a] += (player.pos[a] > (b.min[a] + b.max[a]) / 2 ? 1 : -1) * (pen[i] + 0.01);
  }

  // ------------------------------------------------------------------ pausa
  pause(on = !this.paused) {
    if (on === this.paused || this.sweep) return;
    this.paused = on;
    if (on) this.delta = THREE.MathUtils.clamp(this.delta, STEP, Math.max(STEP, this.maxDelta()));
    this.setFreeze(on);
    this.setHolo(on);
    this.ctx.fx.pause?.(on);
  }

  /** na pausa os cubos/torretas ficam fixos no lugar (ainda colidem); o que você segura continua solto */
  setFreeze(on) {
    this.frozenProps = on;
    for (const c of this.props()) {
      if (!c.body || c.gone) continue;
      if (on) {
        const v = c.body.linvel();
        const a = c.body.angvel();
        c._tv = [v.x, v.y, v.z, a.x, a.y, a.z];
      } else if (c._bt === 1) {
        c.body.setBodyType(0, true);
        if (c._tv) {
          c.body.setLinvel({ x: c._tv[0], y: c._tv[1], z: c._tv[2] }, true);
          c.body.setAngvel({ x: c._tv[3], y: c._tv[4], z: c._tv[5] }, true);
        }
        c._bt = 0;
      }
    }
  }

  syncFreeze() {
    const held = this.ctx.held?.();
    for (const c of this.props()) {
      if (!c.body || c.gone) continue;
      const want = held === c ? 0 : 1;
      if ((c._bt ?? 0) !== want) {
        if (want === 1) c.body.setBodyType(1, true);
        else {
          c.body.setBodyType(0, true);
          c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        c._bt = want;
      }
    }
  }

  /** o mundo está parado (pausa ou "rebobinar" visual do salto) */
  get frozen() {
    return this.paused || !!this.sweep;
  }

  scrub(steps) {
    if (!this.paused) return false;
    const max = this.maxDelta();
    const d = THREE.MathUtils.clamp(Math.round((this.delta + steps * STEP) / STEP) * STEP, STEP, Math.max(STEP, max));
    const changed = d !== this.delta;
    this.delta = d;
    if (changed) this.ctx.fx.scrub?.(d);
    return changed;
  }

  // ------------------------------------------------------------------ quadro
  /** devolve o quanto o mundo avança neste quadro (0 = parado) */
  frame(dt) {
    const { player } = this.ctx;
    this.pre = { pos: player.pos.clone(), vel: player.vel.clone(), yaw: player.yaw, pitch: player.pitch, up: player.upSign };
    this.holoMat.uniforms.uTime.value = this.ctx.t();
    if (this.sweep) {
      this.syncFreeze();
      this.stepSweep(dt);
      this.syncAll();
      return 0;
    }
    if (this.paused) {
      this.syncFreeze();
      this.holoUpdate();
      this.syncAll();
      return 0;
    }
    this.tw += dt;
    this.vt += dt;
    while (this.tw >= this.next) {
      this.record(this.next);
      this.next += RATE;
    }
    this.syncAll();
    this.checkParadox(dt);
    return dt;
  }

  // ------------------------------------------------------------------ clones e marca do laranja
  clonePose(c, t = this.tw) {
    const s = c.script;
    if (t < c.born - 1e-6 || t > c.end + 1e-6) return null;
    const f = (t - s[0].t) / RATE;
    const i = Math.max(0, Math.min(s.length - 1, Math.floor(f)));
    const a = s[i];
    const b = s[Math.min(s.length - 1, i + 1)];
    // um salto de posição entre dois quadros guardados (o jogador parou o tempo e andou, ou atravessou um portal): sem interpolar
    const jumped = a.p.distanceTo(b.p) > 2.5;
    const k = jumped ? 0 : Math.max(0, Math.min(1, f - i));
    return { p: a.p.clone().lerp(b.p, k), yaw: a.yaw + (b.yaw - a.yaw) * k, up: a.up, mv: a.mv && !jumped, grounded: a.grounded, jumped };
  }

  feetOf(p, up) {
    return p.clone().addScaledVector(new V3(0, -1, 0), 0.9 * up);
  }

  /** pés dos clones agora (eles pisam em botões) */
  feet() {
    const out = [];
    for (const c of this.clones) {
      const pose = this.clonePose(c);
      if (pose) out.push(this.feetOf(pose.p, pose.up));
    }
    return out;
  }

  syncAll() {
    const t = this.ctx.t();
    const dt = this.ctx.dtReal?.() ?? 1 / 60;
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i];
      const pose = this.clonePose(c);
      if (!pose) {
        // ainda não nasceu ou já mergulhou no azul (o loop fechou); ele continua na história: um novo salto
        // para antes do fim dele o traz de volta
        if (c.ghost) c.ghost.group.visible = false;
        if (c.portal) c.portal.visible = false;
        this.syncClonePortals(c, this.tw, false);
        if (c.end < this.samples[0].t - 1) {
          this.dropClone(c);
          this.clones.splice(i, 1);
        }
        continue;
      }
      if (this.tw < c.end - ECHO - 0.02) c.echoed = c.closed = false;
      c.ghost ??= this.ctx.makeGhost();
      c.ghost.set(this.feetOf(pose.p, pose.up), pose.yaw, pose.up, pose.mv, t, dt, 0.55);
      this.cloneBlue(c).visible = true;
      this.syncClonePortals(c, this.tw, true);
      // últimos instantes: o azul "eco" abre para o clone mergulhar
      if (!c.echoed && this.tw > c.end - ECHO) {
        c.echoed = true;
        this.ctx.fx.echo?.(c.exit, true);
      }
      if (!c.closed && this.tw >= c.end - 0.05) {
        c.closed = true;
        this.ctx.fx.echo?.(c.exit, false, c.ghost.group.position);
      }
    }
    this.updateEco();
  }

  /** o azul de saída de um clone (a versão do futuro): um portal em tons de cinza, sempre visível */
  cloneBlue(c) {
    if (c.portal) return c.portal;
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.87, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.08, 0.08), side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.scale.set(PORTAL_A, PORTAL_B, 1);
    disc.scale.set(PORTAL_A, PORTAL_B, 1);
    ring.position.z = 0.03;
    disc.position.z = 0.02;
    g.add(disc, ring);
    const { c: pos, n, u } = c.exit;
    const right = new V3().crossVectors(u, n).normalize();
    g.matrix.makeBasis(right, u, n).setPosition(pos);
    g.matrixWorldNeedsUpdate = true;
    this.ctx.scene.add(g);
    c.portal = g;
    return g;
  }

  dropClone(c) {
    c.ghost?.group.parent?.remove(c.ghost.group);
    if (c.pair) {
      this.ctx.portals.removeRemote(c.id);
      c.pair = null;
      c.shown = null;
    }
    if (c.portal) {
      c.portal.parent?.remove(c.portal);
      c.portal.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      c.portal = null;
    }
  }

  /** marca-holograma do laranja que está no passado ("−N s") */
  updateEco() {
    const { portals, scene } = this.ctx;
    if (!scene) return;
    const O = portals.orange;
    const on = !!(O.placed && O.delta > 0);
    if (!this.eco) {
      if (!on) return;
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), ringMat);
      ring.scale.set(PORTAL_A, PORTAL_B, 1);
      ring.position.z = 0.03;
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.88, 48), this.holoMat);
      inner.scale.set(PORTAL_A, PORTAL_B, 1);
      inner.position.z = 0.02;
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 96;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      label.scale.set(1.5, 0.56, 1);
      label.position.set(0, PORTAL_B + 0.55, 0.1);
      g.add(ring, inner, label);
      scene.add(g);
      this.eco = { g, ring, ringMat, cv, tex, label, shown: -1, blocked: null };
    }
    const e = this.eco;
    e.g.visible = on;
    if (!on) return;
    e.g.matrix.copy(O.matrix);
    e.g.matrixWorldNeedsUpdate = true;
    const pulse = 0.75 + 0.25 * Math.sin(this.ctx.t() * 4);
    e.ringMat.color.setRGB(this.blocked ? 2.4 : 1.6, this.blocked ? 0.25 : 1.0, this.blocked ? 0.2 : 0.4).multiplyScalar(pulse);
    if (e.shown !== O.delta || e.blocked !== this.blocked) {
      e.shown = O.delta;
      e.blocked = this.blocked;
      const g = e.cv.getContext('2d');
      g.clearRect(0, 0, 256, 96);
      g.font = 'bold 54px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = this.blocked ? '#ff6a5a' : '#9fe8ff';
      g.shadowColor = this.blocked ? '#ff3020' : '#20c8ff';
      g.shadowBlur = 12;
      g.fillText(`−${O.delta.toFixed(1).replace('.', ',')} s`, 128, 62);
      e.tex.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ holograma do passado
  setHolo(on) {
    if (on && !this.holo) this.buildHolo();
    if (this.holo) this.holo.group.visible = on;
    if (!on && this.holo) this.holo.self?.group && (this.holo.self.group.visible = false);
  }

  buildHolo() {
    const { scene, world } = this.ctx;
    const group = new THREE.Group();
    scene.add(group);
    this.holo = { group, doors: new Map(), props: new Map(), pellets: [], self: null };
    void world;
  }

  holoMesh(src, mat) {
    const m = src.clone(true);
    m.traverse((o) => {
      if (o.isMesh) o.material = mat;
      if (o.isLight) o.visible = false;
    });
    return m;
  }

  /** mostra no holograma só o que ERA diferente de agora, no instante tw − Δ */
  holoUpdate() {
    const { world } = this.ctx;
    if (!this.holo) return;
    const H = this.holo;
    const s = this.samples[this.indexAt(this.tw - this.delta)];
    const snap = s.w;
    // portas e plataformas
    world.doors.forEach((d, k) => {
      const past = snap.doors[k];
      if (!past) return;
      let g = H.doors.get(d);
      const differs = Math.abs(past[0] - d.open) > 0.02;
      if (!g && differs) {
        g = new THREE.Mesh(d.mesh.geometry, this.holoMat);
        H.group.add(g);
        H.doors.set(d, g);
      }
      if (g) {
        g.visible = differs;
        if (differs) doorOffset(d, past[0], g.position);
      }
    });
    // cubos e torretas
    this.props().forEach((c, k) => {
      const p = snap.props[k];
      if (!p || !c.mesh) return;
      let g = H.props.get(c);
      const differs = p.gone !== !!c.gone || (!p.gone && p.p.distanceTo(c.pos) > 0.15);
      if (!g && differs && !p.gone) {
        g = this.holoMesh(c.mesh, this.holoMat);
        H.group.add(g);
        H.props.set(c, g);
      }
      if (g) {
        g.visible = differs && !p.gone;
        if (g.visible) {
          g.position.copy(p.p);
          g.quaternion.copy(p.q);
        }
      }
    });
    // bolas de energia (sempre mostradas: são o que mais muda)
    snap.pellets.forEach((p, i) => {
      let g = H.pellets[i];
      if (!g) {
        g = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), this.holoMat);
        H.group.add(g);
        H.pellets[i] = g;
      }
      g.visible = true;
      g.position.copy(p.pos);
    });
    for (let i = snap.pellets.length; i < H.pellets.length; i++) H.pellets[i].visible = false;
    // o seu eu do passado
    H.self ??= this.ctx.makeGhost();
    H.self.set(this.feetOf(s.p, s.up), s.yaw, s.up, s.mv, this.ctx.t(), this.ctx.dtReal?.() ?? 1 / 60, 0.85);
    this.blocked = this.destinationBlocked(s);
  }

  // ------------------------------------------------------------------ o passado visto pelo azul e mirado pelo laranja
  /** roda `fn` com as portas/plataformas nas posições do passado (colisores incluídos) */
  inPast(delta, fn) {
    const { world } = this.ctx;
    const snap = this.samples[this.indexAt(this.tw - delta)].w;
    const saved = world.doors.map((d) => [d.open, d.target]);
    world.doors.forEach((d, k) => {
      if (snap.doors[k]) d.open = snap.doors[k][0];
    });
    world.update(this.ctx.t(), 0);
    try {
      return fn();
    } finally {
      world.doors.forEach((d, k) => {
        d.open = saved[k][0];
        d.target = saved[k][1];
      });
      world.update(this.ctx.t(), 0);
    }
  }

  /** poses visuais do passado (para o render do azul e para o "rebobinar" do salto); devolve o desfazer */
  applyVisual(snap) {
    const { world, energy } = this.ctx;
    const undo = [];
    world.doors.forEach((d, k) => {
      if (!snap.doors[k]) return;
      const old = d.mesh.position.clone();
      doorOffset(d, snap.doors[k][0], d.mesh.position);
      undo.push(() => d.mesh.position.copy(old));
    });
    this.props().forEach((c, k) => {
      const p = snap.props[k];
      if (!p || !c.mesh) return;
      const pos = c.mesh.position.clone();
      const quat = c.mesh.quaternion.clone();
      const vis = c.mesh.visible;
      c.mesh.position.copy(p.p);
      c.mesh.quaternion.copy(p.q);
      c.mesh.visible = !p.gone;
      undo.push(() => {
        c.mesh.position.copy(pos);
        c.mesh.quaternion.copy(quat);
        c.mesh.visible = vis;
      });
    });
    // as bolas de agora somem; as de então aparecem como esferas brilhantes
    for (const p of energy.pellets) {
      const g = p.group.visible;
      const tr = p.trail.visible;
      p.group.visible = false;
      p.trail.visible = false;
      undo.push(() => {
        p.group.visible = g;
        p.trail.visible = tr;
      });
    }
    this.pastBalls ??= [];
    snap.pellets.forEach((p, i) => {
      let b = this.pastBalls[i];
      if (!b) {
        b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.6), toneMapped: false }));
        this.ctx.scene.add(b);
        this.pastBalls[i] = b;
      }
      b.visible = true;
      b.position.copy(p.pos);
    });
    for (let i = snap.pellets.length; i < this.pastBalls.length; i++) this.pastBalls[i].visible = false;
    undo.push(() => this.pastBalls.forEach((b) => (b.visible = false)));
    return () => undo.reverse().forEach((f) => f());
  }

  /** usado pelo render do azul temporal: a sala como estava Δ segundos antes */
  beginPast(delta) {
    const T = this.tw - delta;
    const s = this.samples[this.indexAt(T)];
    this._undoPast = this.applyVisual(s.w);
    // o marcador e o holograma da pausa são só para quem está no presente: dentro da vista do azul
    // o marcador fica colado na câmera virtual e cobre tudo de branco
    this._hide = [this.eco?.g, this.holo?.group].filter((g) => g?.visible);
    for (const g of this._hide) g.visible = false;
    // clones: onde estavam então; e você mesmo, onde estava
    this._cloneVis = this.clones.map((c) => c.ghost?.group.visible);
    const t = this.ctx.t();
    const dt = this.ctx.dtReal?.() ?? 1 / 60;
    this.clones.forEach((c) => {
      const pose = this.clonePose(c, T);
      if (!pose) {
        if (c.ghost) c.ghost.group.visible = false;
        return;
      }
      c.ghost ??= this.ctx.makeGhost();
      c.ghost.set(this.feetOf(pose.p, pose.up), pose.yaw, pose.up, pose.mv, t, dt, 0.7);
    });
    this._pastSelf ??= this.ctx.makeGhost();
    this._pastSelf.set(this.feetOf(s.p, s.up), s.yaw, s.up, s.mv, t, dt, 0.9);
  }

  endPast() {
    for (const g of this._hide ?? []) g.visible = true;
    this._hide = null;
    this._undoPast?.();
    this._undoPast = null;
    if (this._pastSelf) this._pastSelf.group.visible = false;
    this.clones.forEach((c, i) => {
      if (c.ghost) c.ghost.group.visible = !!this._cloneVis?.[i];
    });
  }

  // ------------------------------------------------------------------ colocar o laranja no passado
  /**
   * Tiro laranja com Δ: o raio vê as paredes (portas) do instante tw − Δ.
   * Devolve o resultado de `portals.tryPlace` ou `{ ok: false, why }`.
   */
  placeOrange(origin, dir, delta) {
    const { world, portals } = this.ctx;
    return this.inPast(delta, () => {
      const hit = world.raycast(origin, dir, 400);
      if (hit?.box.kinematic) return { ok: false, why: 'Não dá para abrir portal numa porta que se mexe, no passado.' };
      const res = portals.tryPlace('orange', origin, dir);
      if (res.ok) {
        portals.orange.delta = delta;
        portals.orange.fixed = false;
      }
      return res;
    });
  }

  /** o espaço de chegada (no laranja, no instante de destino) está ocupado? */
  destinationBlocked(sample) {
    const { portals, world, player } = this.ctx;
    const O = portals.orange;
    if (!(O.placed && O.delta > 0)) return false;
    const need = Math.abs(O.normal.x) * player.half.x + Math.abs(O.normal.z) * player.half.z + 0.05;
    const pos = O.center.clone().addScaledVector(O.normal, Math.abs(O.normal.y) > 0.5 ? player.half.y + 0.1 : need);
    if (Math.abs(O.normal.y) < 0.5) pos.y = Math.max(pos.y, O.center.y - 0.1);
    const min = pos.clone().sub(player.half);
    const max = pos.clone().add(player.half);
    const snap = (sample ?? this.samples[this.indexAt(this.tw - O.delta)]).w;
    return this.inPast(O.delta, () => {
      for (const b of world.solids) {
        if (b.solid === false) continue;
        if (overlap(min, max, b.min, b.max, 0.1)) return true;
      }
      const T = this.tw - O.delta;
      for (const c of this.clones) {
        const pose = this.clonePose(c, T);
        if (pose && overlap(min, max, pose.p.clone().sub(player.half), pose.p.clone().add(player.half), 0.05)) return true;
      }
      return snap.props.some((p) => !p.gone && overlap(min, max, p.p.clone().addScaledVector(new V3(1, 1, 1), -0.32), p.p.clone().addScaledVector(new V3(1, 1, 1), 0.32), 0.05));
    });
  }

  // ------------------------------------------------------------------ o salto
  /** o jogador atravessou o azul temporal (já levado ao laranja pelo portal) */
  jump(blue) {
    const { player, portals } = this.ctx;
    const orange = blue.partner;
    const delta = orange.delta;
    if (!(delta > 0)) return false;
    const cp = this.makeCheckpoint(blue, orange);
    const Td = this.tw - delta;
    if (Td < this.samples[0].t - 1e-6 || Td < this.arrival - 1e-6) {
      this.rollback(cp, 'não dá para voltar para antes da sua própria chegada');
      return false;
    }
    const i = this.indexAt(Td);
    const tail = this.samples.slice(i);
    // 1) o mundo volta ao instante de destino (tudo é sobrescrito)
    this.restore(this.samples[i].w);
    // 2) o destino não pode estar ocupado
    if (this.playerBlocked()) {
      this.rollback(cp, 'o destino está ocupado');
      return false;
    }
    // 3) o objeto segurado viaja com você
    const held = this.ctx.held?.();
    if (held) {
      const pos = player.eye().addScaledVector(player.forward(), 1.4);
      held.place(pos, held.quat);
    }
    // 4) o seu passado vira um clone
    this.clones = this.clones.filter((c) => c.end >= Td || (this.dropClone(c), false));
    this.clones.push({ id: `clone${++this.cloneSeq}`, born: this.samples[i].t, end: tail[tail.length - 1].t, script: tail, ghost: null, cp, exit: { c: blue.center.clone(), n: blue.normal.clone(), u: blue.up.clone() }, bad: {} });
    this.samples = this.samples.slice(0, i + 1);
    this.tw = this.samples[i].t;
    this.next = this.tw + RATE;
    this.arrival = this.tw;
    // 5) os portais se desfazem; o mundo "rebobina" ao seu redor
    portals.fizzle();
    this.paused = false;
    this.setFreeze(true); // durante o "rebobinar" visual o mundo fica parado
    this.setHolo(false);
    this.sweep = { tail, t: 0, dur: 0.75, undo: null };
    this.ctx.fx.jump?.(delta);
    return true;
  }

  makeCheckpoint(blue, orange) {
    const frame = (P) => ({ c: P.center.clone(), n: P.normal.clone(), u: P.up.clone(), box: P.box });
    return {
      samples: this.samples,
      clones: this.clones.slice(),
      tw: this.tw,
      next: this.next,
      arrival: this.arrival,
      w: this.snapshot(),
      player: this.pre,
      blue: frame(blue),
      orange: { ...frame(orange), delta: orange.delta },
    };
  }

  playerBlocked() {
    const { player, world } = this.ctx;
    const min = player.pos.clone().sub(player.half);
    const max = player.pos.clone().add(player.half);
    for (const b of world.solids) {
      if (b.solid === false) continue;
      if (overlap(min, max, b.min, b.max, 0.12)) return true;
    }
    for (const c of this.props()) {
      if (c.gone) continue;
      if (overlap(min, max, c.pos.clone().addScaledVector(new V3(1, 1, 1), -0.3), c.pos.clone().addScaledVector(new V3(1, 1, 1), 0.3), 0.05)) return true;
    }
    return false;
  }

  /** "rebobina" visualmente o trecho que você viveu (T_j → T_d) enquanto o mundo está parado */
  stepSweep(dt) {
    const S = this.sweep;
    S.t += dt;
    const k = Math.min(1, S.t / S.dur);
    S.undo?.();
    const idx = Math.round((1 - k) * (S.tail.length - 1));
    S.undo = k < 1 ? this.applyVisual(S.tail[idx].w) : null;
    if (k >= 1) {
      this.sweep = null;
      this.restore(this.samples[this.samples.length - 1].w);
      this.setFreeze(false);
    }
  }

  // ------------------------------------------------------------------ paradoxo
  checkParadox(dt) {
    const { world, energy, player } = this.ctx;
    for (const c of this.clones) {
      const pose = this.clonePose(c);
      if (!pose || pose.jumped || this.tw < c.born + 0.25 || this.tw > c.end - 0.05) continue;
      const half = player.half;
      const min = pose.p.clone().sub(half);
      const max = pose.p.clone().add(half);
      const test = (key, bad, limit, why) => {
        c.bad[key] = bad ? (c.bad[key] ?? 0) + dt : 0;
        return c.bad[key] > limit ? why : null;
      };
      let why = null;
      // sólido (porta/parede/plataforma) ou cubo no caminho do seu passado
      let solid = false;
      for (const b of world.solids) {
        if (b.solid === false) continue;
        if (overlap(min, max, b.min, b.max, 0.14)) {
          solid = true;
          break;
        }
      }
      why ??= test('solid', solid, 0.1, 'algo bloqueou o caminho do seu passado');
      let cube = false;
      for (const p of this.props()) {
        if (p.gone || p.held) continue;
        if (overlap(min, max, p.pos.clone().addScaledVector(new V3(1, 1, 1), -0.3), p.pos.clone().addScaledVector(new V3(1, 1, 1), 0.3), 0.08)) cube = true;
      }
      why ??= test('cube', cube, 0.1, 'um objeto ficou no caminho do seu passado');
      // perigos
      let hz = false;
      for (const h of [...world.hazards, ...world.incinerators]) if (overlap(min, max, h.min, h.max, 0.05)) hz = true;
      why ??= test('hazard', hz, 0.05, 'o seu passado caiu num perigo');
      // bola de energia no caminho do clone
      let ball = false;
      for (const p of energy.pellets) {
        const q = p.pos.clone().clamp(min, max);
        if (q.distanceTo(p.pos) < 0.34) ball = true;
      }
      why ??= test('ball', ball, 0.03, 'uma bola de energia atingiu o seu passado');
      // o chão em que você pisava sumiu
      if (pose.grounded && pose.up > 0) {
        const feet = pose.p.clone().add(new V3(0, -half.y + 0.25, 0));
        const hit = world.raycast(feet, new V3(0, -1, 0), 0.75);
        const onProp = this.props().some((p) => !p.gone && Math.abs(p.pos.x - pose.p.x) < 0.5 && Math.abs(p.pos.z - pose.p.z) < 0.5 && Math.abs(p.pos.y + 0.3 - (pose.p.y - half.y)) < 0.5);
        why ??= test('floor', !hit && !onProp, 0.35, 'o chão do seu passado sumiu');
      }
      if (why) {
        this.rollback(c.cp, why, pose.p);
        return;
      }
    }
  }

  /** o loop colapsa: tudo volta ao instante do salto */
  rollback(cp, why, at = null) {
    const { player, portals } = this.ctx;
    this.ctx.fx.paradox?.(why, at);
    for (const c of this.clones) if (!cp.clones.includes(c)) this.dropClone(c);
    this.sweep?.undo?.();
    this.sweep = null;
    this.samples = cp.samples;
    this.clones = cp.clones;
    this.tw = cp.tw;
    this.next = cp.next;
    this.arrival = cp.arrival;
    this.restore(cp.w);
    portals.blue.setFrame(cp.blue.c, cp.blue.n, cp.blue.u, cp.blue.box);
    portals.orange.setFrame(cp.orange.c, cp.orange.n, cp.orange.u, cp.orange.box);
    portals.orange.delta = cp.orange.delta;
    portals.blue.fixed = portals.orange.fixed = false;
    // você volta para onde estava logo antes de entrar no azul (um passo para trás, parado: sem re-entrar sozinho)
    player.pos.copy(cp.player.pos);
    player.vel.set(0, 0, 0);
    const l = portals.blue.local(player.pos);
    if (l.z < 0.8) player.pos.addScaledVector(portals.blue.normal, 0.8 - l.z);
    player.yaw = cp.player.yaw;
    player.pitch = cp.player.pitch;
    player.viewOffset?.set(0, 0, 0);
    player.viewRot?.identity?.();
    player.cooldown = 0.5;
    this.paused = false;
    this.setFreeze(false);
    this.setHolo(false);
    this.paradoxes++;
    this.ctx.fx.toast?.(`Paradoxo: ${why}. O loop se desfez.`);
  }

  /** dados para o HUD */
  hud() {
    return { paused: this.paused, delta: this.delta, max: this.maxDelta(), tw: this.tw, blocked: this.blocked, clones: this.clones.filter((c) => this.clonePose(c)).length, paradoxes: this.paradoxes };
  }
}
